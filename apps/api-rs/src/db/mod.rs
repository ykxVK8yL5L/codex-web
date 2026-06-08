use std::path::PathBuf;

use anyhow::Context;
use rusqlite::{Connection, OpenFlags};

use crate::config::AppConfig;

#[derive(Clone, Debug)]
pub struct Db {
    pub data_dir: PathBuf,
    pub sqlite_path: PathBuf,
}

impl Db {
    pub fn from_config(config: &AppConfig) -> Self {
        let data_dir = config.data_dir.clone();
        let sqlite_path = data_dir.join("codex-web.sqlite");
        Self {
            data_dir,
            sqlite_path,
        }
    }

    pub fn open_read_only(&self) -> anyhow::Result<Option<Connection>> {
        if !self.sqlite_path.exists() {
            return Ok(None);
        }
        let connection = Connection::open_with_flags(
            &self.sqlite_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .with_context(|| {
            format!(
                "failed to open sqlite database {}",
                self.sqlite_path.display()
            )
        })?;
        Ok(Some(connection))
    }

    pub fn open_read_write(&self) -> anyhow::Result<Connection> {
        std::fs::create_dir_all(&self.data_dir).with_context(|| {
            format!(
                "failed to create data directory {}",
                self.data_dir.display()
            )
        })?;
        let connection = Connection::open_with_flags(
            &self.sqlite_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .with_context(|| {
            format!(
                "failed to open sqlite database {}",
                self.sqlite_path.display()
            )
        })?;
        Ok(connection)
    }
}
