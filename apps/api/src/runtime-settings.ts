import type Database from "better-sqlite3";
import type {
  CodexApprovalPolicy,
  CodexRuntimeSettings,
  CodexSandboxMode,
  PreviewAccessSettings,
  SessionCompactionSettings,
  TokenUsageDisplaySettings,
  TokenUsageRetentionSettings,
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

  function defaultSessionCompactionSettings(): SessionCompactionSettings {
    return {
      enabled: true,
      autoCompactMessages: 80,
      autoCompactChars: 80_000,
      minNewMessages: 20,
      minNewChars: 12_000,
      updatedAt: new Date().toISOString(),
    };
  }

  function sanitizeSessionCompactionSettings(value?: Partial<SessionCompactionSettings>): SessionCompactionSettings {
    const defaults = defaultSessionCompactionSettings();
    const numberValue = (input: unknown, fallback: number, min: number, max: number) => {
      const parsed = Number(input ?? fallback);
      return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
    };
    return {
      enabled: typeof value?.enabled === "boolean" ? value.enabled : defaults.enabled,
      autoCompactMessages: numberValue(value?.autoCompactMessages, defaults.autoCompactMessages, 1, 100_000),
      autoCompactChars: numberValue(value?.autoCompactChars, defaults.autoCompactChars, 1_000, 10_000_000),
      minNewMessages: numberValue(value?.minNewMessages, defaults.minNewMessages, 1, 10_000),
      minNewChars: numberValue(value?.minNewChars, defaults.minNewChars, 1_000, 2_000_000),
      updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : defaults.updatedAt,
    };
  }

  function loadSessionCompactionSettings(): SessionCompactionSettings {
    const row = db.prepare("select value from app_settings where key = 'session_compaction'").get() as { value: string } | undefined;
    if (!row) return defaultSessionCompactionSettings();
    try {
      return sanitizeSessionCompactionSettings(JSON.parse(row.value) as Partial<SessionCompactionSettings>);
    } catch {
      return defaultSessionCompactionSettings();
    }
  }

  function saveSessionCompactionSettings(settings: SessionCompactionSettings) {
    db.prepare(`
      insert into app_settings (key, value, updated_at)
      values ('session_compaction', ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(settings), settings.updatedAt);
  }

  function defaultTokenUsageRetentionSettings(): TokenUsageRetentionSettings {
    return { retentionDays: 0, updatedAt: new Date().toISOString() };
  }

  function sanitizeTokenUsageRetentionSettings(value?: Partial<TokenUsageRetentionSettings>): TokenUsageRetentionSettings {
    const defaults = defaultTokenUsageRetentionSettings();
    const days = Number(value?.retentionDays ?? defaults.retentionDays);
    return {
      retentionDays: Number.isFinite(days) ? Math.min(Math.max(Math.floor(days), 0), 3650) : defaults.retentionDays,
      updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : defaults.updatedAt,
    };
  }

  function loadTokenUsageRetentionSettings(): TokenUsageRetentionSettings {
    const row = db.prepare("select value from app_settings where key = 'token_usage_retention'").get() as { value: string } | undefined;
    if (!row) return defaultTokenUsageRetentionSettings();
    try {
      return sanitizeTokenUsageRetentionSettings(JSON.parse(row.value) as Partial<TokenUsageRetentionSettings>);
    } catch {
      return defaultTokenUsageRetentionSettings();
    }
  }

  function saveTokenUsageRetentionSettings(settings: TokenUsageRetentionSettings) {
    db.prepare(`
      insert into app_settings (key, value, updated_at)
      values ('token_usage_retention', ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(settings), settings.updatedAt);
  }

  function defaultTokenUsageDisplaySettings(): TokenUsageDisplaySettings {
    return { showMessageUsage: false, updatedAt: new Date().toISOString() };
  }

  function sanitizeTokenUsageDisplaySettings(value?: Partial<TokenUsageDisplaySettings>): TokenUsageDisplaySettings {
    const defaults = defaultTokenUsageDisplaySettings();
    return {
      showMessageUsage: typeof value?.showMessageUsage === "boolean" ? value.showMessageUsage : defaults.showMessageUsage,
      updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : defaults.updatedAt,
    };
  }

  function loadTokenUsageDisplaySettings(): TokenUsageDisplaySettings {
    const row = db.prepare("select value from app_settings where key = 'token_usage_display'").get() as { value: string } | undefined;
    if (!row) return defaultTokenUsageDisplaySettings();
    try {
      return sanitizeTokenUsageDisplaySettings(JSON.parse(row.value) as Partial<TokenUsageDisplaySettings>);
    } catch {
      return defaultTokenUsageDisplaySettings();
    }
  }

  function saveTokenUsageDisplaySettings(settings: TokenUsageDisplaySettings) {
    db.prepare(`
      insert into app_settings (key, value, updated_at)
      values ('token_usage_display', ?, ?)
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
    sessionCompaction: {
      load: loadSessionCompactionSettings,
      save: saveSessionCompactionSettings,
      sanitize: sanitizeSessionCompactionSettings,
    },
    tokenUsageRetention: {
      load: loadTokenUsageRetentionSettings,
      save: saveTokenUsageRetentionSettings,
      sanitize: sanitizeTokenUsageRetentionSettings,
    },
    tokenUsageDisplay: {
      load: loadTokenUsageDisplaySettings,
      save: saveTokenUsageDisplaySettings,
      sanitize: sanitizeTokenUsageDisplaySettings,
    },
  };
}
