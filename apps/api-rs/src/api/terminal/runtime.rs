use std::{path::PathBuf, process::Stdio};

use anyhow::{bail, Context};
use rand::RngCore;
use tokio::{
    process::Command,
    sync::{broadcast, mpsc},
};

use crate::state::{TerminalHandle, TerminalRuntimeState};

use super::super::common::timestamp;
use super::models::{CreateTerminalSessionRequest, TerminalSessionSummary};

/// Message sent to the blocking PTY writer thread (which owns the master).
enum PtyMsg {
    Input(String),
    Resize(u16, u16),
}

pub fn default_cwd() -> String {
    std::env::var("HOME").unwrap_or_else(|_| ".".to_string())
}

pub fn resolve_cwd(value: Option<&str>) -> anyhow::Result<PathBuf> {
    let raw = value.filter(|item| !item.trim().is_empty()).unwrap_or("~");
    let expanded = if raw == "~" {
        default_cwd()
    } else if let Some(rest) = raw.strip_prefix("~/") {
        format!("{}/{}", default_cwd(), rest)
    } else {
        raw.to_string()
    };
    let path = PathBuf::from(expanded).canonicalize()?;
    if !path.is_dir() {
        bail!("cwd_not_directory");
    }
    Ok(path)
}

pub async fn create_session(
    state: &TerminalRuntimeState,
    input: CreateTerminalSessionRequest,
    ephemeral: bool,
) -> anyhow::Result<TerminalSessionSummary> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{Read, Write};

    let cwd = resolve_cwd(input.cwd.as_deref())?;
    let shell = resolve_shell();

    // Allocate a real PTY: the shell's controlling terminal is the pty slave, so prompts, colors,
    // cursor control, and shell-integration terminal queries all work — and nothing leaks to the
    // terminal that launched the server (that was the pipe-mode + setsid problem: setsid stopped
    // the leak but also killed the prompt because it relies on a tty).
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("terminal_pty_open_failed")?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&cwd);
    // Explicit env: inherit the server env, then apply managed overrides (PATH augmentation +
    // isolated HISTFILE) and a sane TERM so the prompt renders.
    for (key, value) in std::env::vars() {
        cmd.env(key, value);
    }
    for (key, value) in managed_child_env() {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .context("terminal_spawn_failed")?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .context("terminal_reader_unavailable")?;
    let mut writer = pair
        .master
        .take_writer()
        .context("terminal_writer_unavailable")?;
    let mut killer = child.clone_killer();

    let (sender, _) = broadcast::channel(256);
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<String>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u16, u16)>();
    let (kill_tx, mut kill_rx) = mpsc::unbounded_channel::<()>();
    let summary = TerminalSessionSummary {
        id: random_id(),
        name: input
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "shell".to_string()),
        cwd: cwd.display().to_string(),
        mode: "pty",
        status: "running",
        created_at: timestamp(),
    };
    let handle = TerminalHandle {
        summary: summary.clone(),
        ephemeral,
        sender: sender.clone(),
        input: input_tx,
        resize: resize_tx,
        kill: kill_tx,
    };
    if !ephemeral {
        state.insert(handle.clone());
    }

    // Blocking reader thread: forward raw PTY bytes (incl. partial lines like the prompt) as-is.
    let output_sender = sender.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if output_sender
                        .send(String::from_utf8_lossy(&buffer[..n]).to_string())
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });

    // Blocking writer thread owns the PTY master (keeping it alive) + writer; handles both input
    // bytes and resize requests (the master must resize to match the frontend xterm size, or the
    // prompt's width-based layout — right-aligned segments, fills — wraps incorrectly).
    let (msg_tx, msg_rx) = std::sync::mpsc::channel::<PtyMsg>();
    std::thread::spawn(move || {
        let master = pair.master; // keep the master open for the session lifetime
        while let Ok(msg) = msg_rx.recv() {
            match msg {
                PtyMsg::Input(data) => {
                    if writer.write_all(data.as_bytes()).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                PtyMsg::Resize(cols, rows) => {
                    let _ = master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }
        }
    });

    // Bridge async input → blocking writer thread. The PTY line discipline handles \r, echo, etc.,
    // so forward keystrokes verbatim (no \r→\n rewriting, no local echo needed).
    let input_msg_tx = msg_tx.clone();
    tokio::spawn(async move {
        while let Some(data) = input_rx.recv().await {
            if input_msg_tx.send(PtyMsg::Input(data)).is_err() {
                break;
            }
        }
    });

    // Bridge async resize → blocking writer thread (which owns the master).
    tokio::spawn(async move {
        while let Some((cols, rows)) = resize_rx.recv().await {
            let cols = cols.clamp(1, 1000);
            let rows = rows.clamp(1, 1000);
            if msg_tx.send(PtyMsg::Resize(cols, rows)).is_err() {
                break;
            }
        }
    });

    // Kill signal → kill the child.
    tokio::spawn(async move {
        if kill_rx.recv().await.is_some() {
            let _ = killer.kill();
        }
    });

    // Wait for child exit (blocking) → clean up and notify the client.
    let terminal_state = state.clone();
    let session_id = summary.id.clone();
    let close_sender = sender.clone();
    let wait_handle = tokio::task::spawn_blocking(move || {
        let _ = child.wait();
    });
    tokio::spawn(async move {
        let _ = wait_handle.await;
        terminal_state.remove(&session_id);
        let _ = close_sender.send("\r\n[terminal closed]\r\n".to_string());
    });

    if ephemeral {
        state.insert(handle);
    }
    Ok(summary)
}

fn resolve_shell() -> String {
    [
        std::env::var("SHELL").ok(),
        Some("/bin/zsh".to_string()),
        Some("/bin/bash".to_string()),
        Some("/bin/sh".to_string()),
    ]
    .into_iter()
    .flatten()
    .find(|path| std::path::Path::new(path).exists())
    .unwrap_or_else(|| "/bin/sh".to_string())
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub async fn run_command(command: &str, cwd: &str) -> TerminalSessionCommandResult {
    let started = std::time::Instant::now();
    let mut process = Command::new(resolve_shell());
    process
        .arg("-lc")
        .arg(command)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in managed_child_env() {
        process.env(key, value);
    }

    let child = match process.spawn() {
        Ok(child) => child,
        Err(error) => {
            return TerminalSessionCommandResult {
                exit_code: None,
                stdout: String::new(),
                stderr: error.to_string(),
                duration_ms: started.elapsed().as_millis() as u64,
                timed_out: false,
            };
        }
    };

    let mut timed_out = false;
    let output =
        match tokio::time::timeout(std::time::Duration::from_secs(30), child.wait_with_output())
            .await
        {
            Ok(Ok(output)) => Some(output),
            Ok(Err(_)) => None,
            Err(_) => {
                timed_out = true;
                None
            }
        };

    let (exit_code, stdout, stderr) = match output {
        Some(output) => (
            output.status.code().map(i64::from),
            trim_output(&String::from_utf8_lossy(&output.stdout)),
            trim_output(&String::from_utf8_lossy(&output.stderr)),
        ),
        None => (
            None,
            String::new(),
            if timed_out {
                "command timed out".to_string()
            } else {
                String::new()
            },
        ),
    };

    TerminalSessionCommandResult {
        exit_code,
        stdout,
        stderr,
        duration_ms: started.elapsed().as_millis() as u64,
        timed_out,
    }
}

fn trim_output(value: &str) -> String {
    const LIMIT: usize = 64 * 1024;
    if value.len() <= LIMIT {
        return value.to_string();
    }
    let mut start = value.len() - LIMIT;
    while start < value.len() && !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].to_string()
}

pub struct TerminalSessionCommandResult {
    pub exit_code: Option<i64>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
}

/// Build env overrides for spawned terminal shells: augment PATH with mise/local bins (mirrors
/// the TS managedChildEnv) and redirect HISTFILE to an isolated location so the web terminal's
/// command history does not bleed into the user's real shell history.
fn managed_child_env() -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/root"));
    let mise_data_dir = std::env::var_os("MISE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share/mise"));
    let mise_shims_dir = std::env::var_os("MISE_SHIMS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| mise_data_dir.join("shims"));
    let mise_bin = std::env::var_os("MISE_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/usr/local/bin/mise"));
    let mise_config_dir = std::env::var_os("MISE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config/mise"));
    let mise_cache_dir = std::env::var_os("MISE_CACHE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".cache/mise"));

    env.push(("HOME".to_string(), home.display().to_string()));
    env.push(("MISE_BIN".to_string(), mise_bin.display().to_string()));
    env.push((
        "MISE_DATA_DIR".to_string(),
        mise_data_dir.display().to_string(),
    ));
    env.push((
        "MISE_CONFIG_DIR".to_string(),
        mise_config_dir.display().to_string(),
    ));
    env.push((
        "MISE_CACHE_DIR".to_string(),
        mise_cache_dir.display().to_string(),
    ));
    env.push((
        "MISE_SHIMS_DIR".to_string(),
        mise_shims_dir.display().to_string(),
    ));

    let current = std::env::var("PATH").unwrap_or_default();
    let current_parts: Vec<String> = current
        .split(':')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    let mut additions: Vec<String> = Vec::new();
    additions.push(mise_shims_dir.display().to_string());
    for rel in [
        ".local/share/mise/shims",
        ".mise/shims",
        ".local/bin",
        ".mise/bin",
    ] {
        additions.push(home.join(rel).display().to_string());
    }
    additions.push("/usr/local/bin".to_string());
    let mut next_path: Vec<String> = additions
        .into_iter()
        .filter(|p| !current_parts.contains(p))
        .collect();
    next_path.extend(current_parts);
    if !next_path.is_empty() {
        env.push(("PATH".to_string(), next_path.join(":")));
    }
    let hist = std::env::temp_dir().join("codex-web-terminal-history");
    env.push(("HISTFILE".to_string(), hist.display().to_string()));
    env
}
