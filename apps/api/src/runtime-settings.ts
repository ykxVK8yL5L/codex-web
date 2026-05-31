import type Database from "better-sqlite3";
import type {
  CodexApprovalPolicy,
  CodexRuntimeSettings,
  CodexSandboxMode,
  PreviewAccessSettings,
} from "@codex-web/protocol";

type RuntimeSettingsDefaults = {
  codexSandboxMode: string;
  codexApprovalPolicy: string;
  codexBypassSandbox: boolean;
};

export function createRuntimeSettingsStore(db: Database.Database, defaultsInput: RuntimeSettingsDefaults) {
  function defaultCodexRuntimeSettings(): CodexRuntimeSettings {
    return {
      sandboxMode: defaultsInput.codexSandboxMode as CodexSandboxMode,
      approvalPolicy: defaultsInput.codexApprovalPolicy as CodexApprovalPolicy,
      bypassSandbox: defaultsInput.codexBypassSandbox,
      updatedAt: new Date().toISOString(),
    };
  }

  function sanitizeCodexRuntimeSettings(value: Partial<CodexRuntimeSettings> | null): CodexRuntimeSettings {
    const defaults = defaultCodexRuntimeSettings();
    const sandboxModes: CodexSandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
    const approvalPolicies: CodexApprovalPolicy[] = ["untrusted", "on-failure", "on-request", "never"];
    return {
      sandboxMode: sandboxModes.includes(value?.sandboxMode as CodexSandboxMode) ? value!.sandboxMode as CodexSandboxMode : defaults.sandboxMode,
      approvalPolicy: approvalPolicies.includes(value?.approvalPolicy as CodexApprovalPolicy) ? value!.approvalPolicy as CodexApprovalPolicy : defaults.approvalPolicy,
      bypassSandbox: typeof value?.bypassSandbox === "boolean" ? value.bypassSandbox : defaults.bypassSandbox,
      updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : defaults.updatedAt,
    };
  }

  function loadCodexRuntimeSettings(): CodexRuntimeSettings {
    const row = db.prepare("select value from app_settings where key = 'codex_runtime'").get() as { value: string } | undefined;
    if (!row) return defaultCodexRuntimeSettings();
    try {
      return sanitizeCodexRuntimeSettings(JSON.parse(row.value) as Partial<CodexRuntimeSettings>);
    } catch {
      return defaultCodexRuntimeSettings();
    }
  }

  function saveCodexRuntimeSettings(settings: CodexRuntimeSettings) {
    db.prepare(`
      insert into app_settings (key, value, updated_at)
      values ('codex_runtime', ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(settings), settings.updatedAt);
  }

  function defaultPreviewAccessSettings(): PreviewAccessSettings {
    return { requestTtlMinutes: 30, updatedAt: new Date().toISOString() };
  }

  function sanitizePreviewAccessSettings(value?: Partial<PreviewAccessSettings>): PreviewAccessSettings {
    const defaults = defaultPreviewAccessSettings();
    const ttl = Number(value?.requestTtlMinutes ?? defaults.requestTtlMinutes);
    return {
      requestTtlMinutes: Number.isFinite(ttl) ? Math.min(Math.max(Math.floor(ttl), 1), 24 * 60) : defaults.requestTtlMinutes,
      updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : defaults.updatedAt,
    };
  }

  function loadPreviewAccessSettings(): PreviewAccessSettings {
    const row = db.prepare("select value from app_settings where key = 'preview_access'").get() as { value: string } | undefined;
    if (!row) return defaultPreviewAccessSettings();
    try {
      return sanitizePreviewAccessSettings(JSON.parse(row.value) as Partial<PreviewAccessSettings>);
    } catch {
      return defaultPreviewAccessSettings();
    }
  }

  function savePreviewAccessSettings(settings: PreviewAccessSettings) {
    db.prepare(`
      insert into app_settings (key, value, updated_at)
      values ('preview_access', ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(settings), settings.updatedAt);
  }

  return {
    codexRuntime: {
      load: loadCodexRuntimeSettings,
      save: saveCodexRuntimeSettings,
      sanitize: sanitizeCodexRuntimeSettings,
    },
    previewAccess: {
      load: loadPreviewAccessSettings,
      save: savePreviewAccessSettings,
      sanitize: sanitizePreviewAccessSettings,
    },
  };
}
