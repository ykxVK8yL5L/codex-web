mod api;
mod config;
mod db;
mod http;
mod state;
mod web;

use anyhow::Context;
use config::AppConfig;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = AppConfig::from_env();
    let state = AppState::new(config.clone());
    if let Err(error) = ensure_startup_schemas(&state) {
        tracing::warn!("failed to ensure startup schemas: {error}");
    }
    // Materialize embedded role-templates to disk (no-op when the dir already exists), then seed
    // built-in multi-agent circles/roles. Best-effort.
    api::agents::role_templates::ensure_role_templates_on_disk(&state.db.data_dir);
    if let Err(error) = api::agents::store::seed_multi_agent_defaults(&state.db) {
        tracing::warn!("failed to seed multi-agent defaults: {error}");
    }
    api::notifications::runtime::sync_notification_platform_runtimes(state.clone());
    api::automations::runtime::run_startup_automations_threaded(state.clone());
    spawn_scheduled_work_loop(state.clone());
    let app = http::router(state);
    let listener = tokio::net::TcpListener::bind(config.bind_addr())
        .await
        .with_context(|| format!("failed to bind {}", config.bind_addr()))?;

    tracing::info!(
        "Codex Web Rust API listening on http://{}",
        config.bind_addr()
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server failed")?;

    Ok(())
}

fn ensure_startup_schemas(state: &AppState) -> anyhow::Result<()> {
    let connection = state.db.open_read_write()?;
    api::usage::ensure_schema(&connection)?;
    Ok(())
}

fn spawn_scheduled_work_loop(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        let mut last_usage_cleanup = std::time::Instant::now() - std::time::Duration::from_secs(3600);
        loop {
            interval.tick().await;
            api::automations::runtime::check_scheduled_work_threaded(state.clone());
            if last_usage_cleanup.elapsed() >= std::time::Duration::from_secs(3600) {
                last_usage_cleanup = std::time::Instant::now();
                if let Ok(settings) = api::settings::store::token_usage_retention(&state.db) {
                    match api::usage::cleanup_by_retention(&state.db, settings.retention_days) {
                        Ok(deleted) if deleted > 0 => {
                            tracing::info!("token usage retention cleanup deleted {deleted} records");
                        }
                        Ok(_) => {}
                        Err(error) => tracing::warn!("token usage retention cleanup failed: {error}"),
                    }
                }
            }
            if let Err(error) = api::rooms::trigger_due_room_schedules_runtime(state.clone()).await
            {
                tracing::warn!("room schedule check failed: {error}");
            }
        }
    });
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown requested");
}
