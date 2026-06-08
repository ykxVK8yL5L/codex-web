use std::{env, net::SocketAddr, path::PathBuf};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub codex_home: PathBuf,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(5173);
        let data_dir = env::var("CODEX_WEB_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data"));
        let data_dir = absolutize_path(data_dir);
        let codex_home = env::var("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                env::var("HOME")
                    .map(|home| PathBuf::from(home).join(".codex"))
                    .unwrap_or_else(|_| PathBuf::from(".codex"))
            });
        Self {
            host,
            port,
            data_dir,
            codex_home,
        }
    }

    pub fn bind_addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port)
            .parse()
            .expect("HOST and PORT must form a valid socket address")
    }
}

fn absolutize_path(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}
