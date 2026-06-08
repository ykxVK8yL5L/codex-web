use rusqlite::OptionalExtension;

use crate::db::Db;

use super::models::AuthConfig;

pub fn load_auth_config(db: &Db) -> anyhow::Result<Option<AuthConfig>> {
    let Some(connection) = db.open_read_only()? else {
        return Ok(None);
    };
    let exists = connection
        .query_row(
            "select 1 from sqlite_master where type = 'table' and name = 'auth_config' limit 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !exists {
        return Ok(None);
    }
    let auth_config = connection
        .query_row(
            "select access_token_hash, otp_secret from auth_config where id = 'local-admin'",
            [],
            |row| {
                Ok(AuthConfig {
                    access_token_hash: row.get(0)?,
                    otp_secret: row.get(1)?,
                })
            },
        )
        .optional()?;
    Ok(auth_config)
}

pub fn save_auth_config(db: &Db, config: &AuthConfig) -> anyhow::Result<()> {
    let connection = db.open_read_write()?;
    connection.execute_batch(
        "
        create table if not exists auth_config (
          id text primary key,
          access_token_hash text not null,
          otp_secret text not null,
          updated_at text not null
        );
        ",
    )?;
    connection.execute(
        "
        insert into auth_config (id, access_token_hash, otp_secret, updated_at)
        values ('local-admin', ?, ?, datetime('now'))
        on conflict(id) do update set
          access_token_hash = excluded.access_token_hash,
          otp_secret = excluded.otp_secret,
          updated_at = excluded.updated_at
        ",
        [&config.access_token_hash, &config.otp_secret],
    )?;
    Ok(())
}
