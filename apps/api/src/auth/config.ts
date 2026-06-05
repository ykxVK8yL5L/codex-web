import type Database from "better-sqlite3";
import type { AuthConfig } from "./index.js";

export function createAuthConfigStore(db: Database.Database) {
  function loadAuthConfig(): AuthConfig | null {
    const row = db.prepare("select access_token_hash, otp_secret from auth_config where id = 'local-admin'").get() as
      | { access_token_hash: string; otp_secret: string }
      | undefined;
    return row ? { accessTokenHash: row.access_token_hash, otpSecret: row.otp_secret } : null;
  }

  function saveAuthConfig(config: AuthConfig) {
    db.prepare(`
      insert into auth_config (id, access_token_hash, otp_secret, updated_at)
      values ('local-admin', ?, ?, ?)
      on conflict(id) do update set
        access_token_hash = excluded.access_token_hash,
        otp_secret = excluded.otp_secret,
        updated_at = excluded.updated_at
    `).run(config.accessTokenHash, config.otpSecret, new Date().toISOString());
  }

  return {
    loadAuthConfig,
    saveAuthConfig,
  };
}
