import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Activity, Boxes, Check, Copy, Download, Files, FolderOpen, Info, PackageX, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDialog } from "@/components/AppDialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { NotificationPlatformsPanel } from "@/components/settings/NotificationPlatformsPanel";
import { apiKeyActionLabel, apiKeyGroupLabel, apiKeyModuleLabel, apiKeyPermissionGroupDescription, apiKeyPermissionGroupLabel, apiKeyPermissionGroupTitle, apiKeyPermissionLabel, apiKeyPermissionOptionLabel, apiKeyPermissionOptionTitle, apiKeyPresetLabel } from "@/features/settings/labels";
import { readableBackupManifestText, readableNotificationEvent, readableStorageItemType, readableStorageSessionKind, readableStorageSessionType } from "@/features/settings/utils";
import { clearNotificationDeliveriesRequest, clearNotificationRulesRequest, buildNotificationAccountConfig, buildNotificationRecipientConfig, createNotificationAccountForm, createNotificationChannelForm, createNotificationEphemeralRule, createNotificationRecipientForm, createNotificationRuleForm, createNotificationTestSettingsForm, deleteNotificationAccountRequest, deleteNotificationChannelRequest, deleteNotificationDeliveryRequest, deleteNotificationEphemeralRuleRequest, deleteNotificationRecipientRequest, deleteNotificationRuleRequest, fetchNotificationDeliveriesPage, fetchNotificationEphemeralRulesPage, fetchNotificationPlatformSettings, fetchNotificationRulesPage, fetchNotificationSettings, fetchNotificationTestSettings, NotificationAccountEditorDialog, NotificationAccountList, NotificationChannelManagerDialog, NotificationCustomTestDialog, type NotificationAccountForm, type NotificationCustomTestForm, notificationKindLabel, notificationAccountFormFromAccount, notificationRecipientFormFromRecipient, notificationRuleFormFromRule, notificationAccountKind as resolveNotificationAccountKind, notificationPermissionSummary as notificationPermissionSummaryText, notificationPermissionsFromForm, notificationPermissionsToForm, notificationAccountTestTarget as buildNotificationAccountTestTarget, notificationSenderAccountsForKind as getNotificationSenderAccountsForKind, NotificationRecipientList, NotificationRecipientEditorDialog, NotificationTestSettingsCard, type NotificationChannelForm, type NotificationRecipientForm, type NotificationRuleForm, type NotificationTestSettingsForm, retryNotificationDeliveryRequest, testNotificationAccountRequest, testNotificationRecipientRequest, updateNotificationTestSettings, selectedNotificationChannel as resolveSelectedNotificationChannel, upsertNotificationAccount, upsertNotificationChannel, upsertNotificationRecipient, upsertNotificationRule } from "@/features/notifications";
import { formatBytes, formatShortDate, formatTokens, prettyJson } from "@/lib/format";
import type { Locale, TranslationKey } from "@/lib/i18n";
import { copyText } from "@/lib/utils";
import type { ApprovalSummary, ApiKeyDetailResponse, ApiKeyPermission, ApiKeyPermissionGroup, ApiKeyPermissionsResponse, ApiKeyPreset, ApiKeySummary, AuthState, CodexApprovalPolicy, CodexRuntimeSettings, CodexSandboxMode, ConfirmOtpResetRequest, CreateApiKeyRequest, EnvironmentBulkActionRequest, EnvironmentOverview, EnvironmentPackageDetailResponse, EnvironmentPackageRecord, EnvironmentRestoreMissingRequest, EnvironmentRestorePreviewResponse, EnvironmentRestoreRun, EnvironmentToolProbe, EnvironmentToolRecord, EnvironmentToolRegistryItem, EnvironmentToolVersionItem, InstallEnvironmentToolRequest, LoginResponse, MaintenanceCleanupResponse, NotificationAccountSummary, NotificationChannelDefinition, NotificationDeliverySummary, NotificationEphemeralRuleSummary, NotificationEventType, NotificationRecipientSummary, NotificationRuleSummary, NotificationRuleTarget, NotificationSettingsResponse, NotificationSeverity, NotificationTestSettings, PlatformSettingsResponse, PreviewAccessSettings, RateLimitSettings, ResetOtpResponse, SessionCompactionSettings, StorageItemSummary, StorageScanResponse, SystemBackupPreviewResponse, SystemBackupSettings, SystemRestoreResponse, TaskHealthRepairResponse, TaskHealthResponse, TokenUsageDisplaySettings, TokenUsageResponse, TokenUsageRetentionSettings, UpdateAccessTokenRequest, UpdateApiKeyRequest, UpdateCodexRuntimeSettingsRequest, UpdateSessionCompactionSettingsRequest, UpdateSystemBackupSettingsRequest } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";
const backupFilePageSize = 30;
type CredentialSummary = {
  name: string;
  description: string;
  configured: boolean;
  createdAt: string;
  updatedAt: string;
};

export function SettingsPage({
  sessionToken,
  t,
  locale,
  onOpenSession,
  onOpenMainNav,
  onSessionRefresh,
  onLogout,
  notify,
  onApprovalRequired,
}: {
  sessionToken: string;
  t: TFunction;
  locale: Locale;
  onOpenSession: (sessionId: string) => void;
  onOpenMainNav?: () => void;
  onSessionRefresh: (token: string, auth: AuthState) => void;
  onLogout: () => void;
  notify: (message: string, tone?: ToastTone) => void;
  onApprovalRequired: (approval: ApprovalSummary) => void;
}) {
  const dialog = useAppDialog(t);
  const [currentAccessToken, setCurrentAccessToken] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [confirmAccessToken, setConfirmAccessToken] = useState("");
  const [otpSecret, setOtpSecret] = useState("");
  const [otpQr, setOtpQr] = useState("");
  const [otpAccessToken, setOtpAccessToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [tokenMessage, setTokenMessage] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  const [otpCopyMessage, setOtpCopyMessage] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [apiKeyGroups, setApiKeyGroups] = useState<ApiKeyPermissionGroup[]>([]);
  const [apiKeyPresets, setApiKeyPresets] = useState<ApiKeyPreset[]>([]);
  const [apiKeyForm, setApiKeyForm] = useState({ name: "", permissions: [] as ApiKeyPermission[] });
  const [apiKeyEditorOpen, setApiKeyEditorOpen] = useState(false);
  const [apiKeyEditorMode, setApiKeyEditorMode] = useState<"create" | "edit">("create");
  const [apiKeyEditingId, setApiKeyEditingId] = useState("");
  const [expandedApiKeyPermissions, setExpandedApiKeyPermissions] = useState("");
  const [createdApiKey, setCreatedApiKey] = useState<ApiKeyDetailResponse | null>(null);
  const [apiKeyMessage, setApiKeyMessage] = useState("");
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [storageScan, setStorageScan] = useState<StorageScanResponse | null>(null);
  const [storageSearch, setStorageSearch] = useState("");
  const [storageStatusFilter, setStorageStatusFilter] = useState("");
  const [storageSort, setStorageSort] = useState<"bytes" | "updated" | "type">("bytes");
  const [selectedStorageIds, setSelectedStorageIds] = useState<string[]>([]);
  const [backupPreview, setBackupPreview] = useState<SystemBackupPreviewResponse | null>(null);
  const [backupFilePage, setBackupFilePage] = useState(0);
  const [backupSettings, setBackupSettings] = useState<SystemBackupSettings | null>(null);
  const [backupIgnoreRules, setBackupIgnoreRules] = useState("");
  const [restorePreview, setRestorePreview] = useState<SystemBackupPreviewResponse | null>(null);
  const [restoreFilePage, setRestoreFilePage] = useState(0);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("");
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cleanupArchivedApprovals, setCleanupArchivedApprovals] = useState(true);
  const [cleanupArchivedApprovalDays, setCleanupArchivedApprovalDays] = useState(30);
  const [cleanupApprovalAuditLog, setCleanupApprovalAuditLog] = useState(false);
  const [taskHealth, setTaskHealth] = useState<TaskHealthResponse | null>(null);
  const [usageOverview, setUsageOverview] = useState<TokenUsageResponse | null>(null);
  const [usageRecentPage, setUsageRecentPage] = useState(0);
  const [usageFilterFrom, setUsageFilterFrom] = useState("");
  const [usageFilterTo, setUsageFilterTo] = useState("");
  const [appliedUsageFilter, setAppliedUsageFilter] = useState({ createdFrom: "", createdTo: "" });
  const [usageRetention, setUsageRetention] = useState<TokenUsageRetentionSettings | null>(null);
  const [usageDisplay, setUsageDisplay] = useState<TokenUsageDisplaySettings | null>(null);
  const [usageRetentionDays, setUsageRetentionDays] = useState("0");
  const [settingsTab, setSettingsTab] = useState<"account" | "runtime" | "credentials" | "environment" | "network" | "notifications" | "maintenance" | "storage" | "backup">("account");
  const [busy, setBusy] = useState("");
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [credentialForm, setCredentialForm] = useState({ name: "", description: "", value: "" });
  const [editingCredentialName, setEditingCredentialName] = useState("");
  const [credentialEditorOpen, setCredentialEditorOpen] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeSettings | null>(null);
  const [sandboxMode, setSandboxMode] = useState<CodexSandboxMode>("workspace-write");
  const [approvalPolicy, setApprovalPolicy] = useState<CodexApprovalPolicy>("never");
  const [bypassSandbox, setBypassSandbox] = useState(false);
  const [previewAccessSettings, setPreviewAccessSettings] = useState<PreviewAccessSettings | null>(null);
  const [previewAccessRequestTtlMinutes, setPreviewAccessRequestTtlMinutes] = useState("30");
  const [sessionCompactionSettings, setSessionCompactionSettings] = useState<SessionCompactionSettings | null>(null);
  const [sessionCompactionEnabled, setSessionCompactionEnabled] = useState(true);
  const [sessionCompactionForm, setSessionCompactionForm] = useState({
    autoCompactMessages: "80",
    autoCompactChars: "80000",
    minNewMessages: "20",
    minNewChars: "12000",
  });
  const [rateLimitSettings, setRateLimitSettings] = useState<RateLimitSettings | null>(null);
  const [environmentOverview, setEnvironmentOverview] = useState<EnvironmentOverview | null>(null);
  const [environmentRegistry, setEnvironmentRegistry] = useState<EnvironmentToolRegistryItem[]>([]);
  const [environmentToolQuery, setEnvironmentToolQuery] = useState("");
  const [environmentToolPickerOpen, setEnvironmentToolPickerOpen] = useState(false);
  const [environmentVersions, setEnvironmentVersions] = useState<EnvironmentToolVersionItem[]>([]);
  const [environmentVersionHistory, setEnvironmentVersionHistory] = useState<EnvironmentToolVersionItem[]>([]);
  const [environmentVersionPickerOpen, setEnvironmentVersionPickerOpen] = useState(false);
  const [environmentVersionError, setEnvironmentVersionError] = useState("");
  const [environmentShowVersionHistory, setEnvironmentShowVersionHistory] = useState(false);
  const [environmentProbe, setEnvironmentProbe] = useState<EnvironmentToolProbe | null>(null);
  const [environmentPackagePanel, setEnvironmentPackagePanel] = useState<EnvironmentPackageDetailResponse | null>(null);
  const [environmentPackageForm, setEnvironmentPackageForm] = useState({
    manager: "",
    packageName: "",
    versionSpec: "",
    notes: "",
  });
  const [environmentPackageProbe, setEnvironmentPackageProbe] = useState<{ installed: boolean; manager: string; packageName: string; version?: string | null; checked?: boolean } | null>(null);
  const [environmentInstallForm, setEnvironmentInstallForm] = useState({
    tool: "",
    version: "",
    scope: "global",
    autoRestore: true,
    notes: "",
  });
  const environmentReconcileItems = environmentOverview?.reconcile ?? [];
  const environmentProjectUsageItems = environmentOverview?.projectUsage ?? [];
  const environmentMissingToolCount = environmentOverview?.tools.filter((tool) => tool.status === "missing" && tool.autoRestore).length ?? 0;
  const environmentMissingPackageCount = environmentOverview?.packageRecords.filter((pkg) => pkg.status === "missing" && pkg.autoRestore).length ?? 0;
  const environmentRestoreBusy = busy.startsWith("environment-restore-missing:");
  const [rateLimitEnabled, setRateLimitEnabled] = useState(true);
  const [rateLimitForm, setRateLimitForm] = useState({
    globalPerMinute: "300",
    authPerMinute: "20",
    previewAccessPerMinute: "10",
    expensivePerFiveMinutes: "30",
    providerProxyPerMinute: "60",
    providerProxyPerHour: "600",
    providerProxyMaxConcurrent: "5",
  });
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettingsResponse | null>(null);
  const [notificationTestSettings, setNotificationTestSettings] = useState<NotificationTestSettings | null>(null);
  const [notificationTestForm, setNotificationTestForm] = useState<NotificationTestSettingsForm>(createNotificationTestSettingsForm());
  const [notificationTestSettingsCollapsed, setNotificationTestSettingsCollapsed] = useState(true);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsResponse | null>(null);
  const [notificationView, setNotificationView] = useState<"platforms" | "senders" | "recipients" | "rules" | "logs">("platforms");
  const [notificationRuleEnabledFilter, setNotificationRuleEnabledFilter] = useState("");
  const [notificationRuleCursor, setNotificationRuleCursor] = useState<string | null>(null);
  const [notificationRuleLoading, setNotificationRuleLoading] = useState(false);
  const [notificationEphemeralRuleCursor, setNotificationEphemeralRuleCursor] = useState<string | null>(null);
  const [notificationEphemeralRuleLoading, setNotificationEphemeralRuleLoading] = useState(false);
  const [notificationDeliveryEventFilter, setNotificationDeliveryEventFilter] = useState("");
  const [notificationDeliveryStatusFilter, setNotificationDeliveryStatusFilter] = useState("");
  const [notificationDeliverySeverityFilter, setNotificationDeliverySeverityFilter] = useState("");
  const [notificationDeliveryCursor, setNotificationDeliveryCursor] = useState<string | null>(null);
  const [notificationDeliveryLoading, setNotificationDeliveryLoading] = useState(false);
  const [notificationAccountForm, setNotificationAccountForm] = useState<NotificationAccountForm>(createNotificationAccountForm(locale));
  const [notificationEditingAccountId, setNotificationEditingAccountId] = useState("");
  const [notificationAccountEditorOpen, setNotificationAccountEditorOpen] = useState(false);
  const [notificationCustomTestAccount, setNotificationCustomTestAccount] = useState<NotificationAccountSummary | null>(null);
  const [notificationCustomTestForm, setNotificationCustomTestForm] = useState<NotificationCustomTestForm>({
    title: "",
    message: "",
    includeHelp: true,
  });
  const [notificationRuleForm, setNotificationRuleForm] = useState<NotificationRuleForm>(createNotificationRuleForm());
  const [notificationEditingRuleId, setNotificationEditingRuleId] = useState("");
  const [notificationRecipientForm, setNotificationRecipientForm] = useState<NotificationRecipientForm>(createNotificationRecipientForm());
  const [notificationEditingRecipientId, setNotificationEditingRecipientId] = useState("");
  const [notificationRecipientEditorOpen, setNotificationRecipientEditorOpen] = useState(false);
  const [notificationChannelManagerOpen, setNotificationChannelManagerOpen] = useState(false);
  const [notificationEditingChannelId, setNotificationEditingChannelId] = useState("");
  const [notificationChannelForm, setNotificationChannelForm] = useState<NotificationChannelForm>(createNotificationChannelForm());
  const usageTotalPages = usageOverview?.recentTotalPages ?? 1;
  const usagePageButtons = Array.from({ length: Math.min(5, usageTotalPages) }, (_, index) => Math.min(Math.max(usageRecentPage - 2, 0), Math.max(usageTotalPages - 5, 0)) + index).filter((page) => page < usageTotalPages);

  function showTokenNotice(value: string) {
    setTokenMessage(value);
    notify(value, value === t("settings.tokenUpdated") ? "success" : "error");
  }

  function showOtpNotice(value: string) {
    setOtpMessage(value);
    notify(value, value === t("settings.otpReset") || value === t("settings.otpGenerated") || value === t("action.copied") ? "success" : "error");
  }

  function showApiKeyNotice(value: string, tone: ToastTone = "success") {
    setApiKeyMessage(value);
    notify(value, tone);
  }

  useEffect(() => {
    const headers = { authorization: `Bearer ${sessionToken}` };
    fetch("/api/settings/codex-runtime", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: CodexRuntimeSettings | null) => {
        if (!settings) return;
        setCodexRuntime(settings);
        setSandboxMode(settings.sandboxMode);
        setApprovalPolicy(settings.approvalPolicy);
        setBypassSandbox(settings.bypassSandbox);
      })
      .catch(() => undefined);
    fetch("/api/settings/preview-access", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: PreviewAccessSettings | null) => {
        if (!settings) return;
        setPreviewAccessSettings(settings);
        setPreviewAccessRequestTtlMinutes(String(settings.requestTtlMinutes));
      })
      .catch(() => undefined);
    fetch("/api/settings/session-compaction", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: SessionCompactionSettings | null) => {
        if (!settings) return;
        setSessionCompactionSettings(settings);
        setSessionCompactionEnabled(settings.enabled);
        setSessionCompactionForm({
          autoCompactMessages: String(settings.autoCompactMessages),
          autoCompactChars: String(settings.autoCompactChars),
          minNewMessages: String(settings.minNewMessages),
          minNewChars: String(settings.minNewChars),
        });
      })
      .catch(() => undefined);
    fetch("/api/settings/token-usage-retention", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: TokenUsageRetentionSettings | null) => {
        if (!settings) return;
        setUsageRetention(settings);
        setUsageRetentionDays(String(settings.retentionDays));
      })
      .catch(() => undefined);
    fetch("/api/settings/token-usage-display", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: TokenUsageDisplaySettings | null) => {
        if (!settings) return;
        setUsageDisplay(settings);
      })
      .catch(() => undefined);
    fetch("/api/settings/rate-limit", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: RateLimitSettings | null) => {
        if (!settings) return;
        setRateLimitSettings(settings);
        setRateLimitEnabled(settings.enabled);
        setRateLimitForm({
          globalPerMinute: String(settings.globalPerMinute),
          authPerMinute: String(settings.authPerMinute),
          previewAccessPerMinute: String(settings.previewAccessPerMinute),
          expensivePerFiveMinutes: String(settings.expensivePerFiveMinutes),
          providerProxyPerMinute: String(settings.providerProxyPerMinute),
          providerProxyPerHour: String(settings.providerProxyPerHour),
          providerProxyMaxConcurrent: String(settings.providerProxyMaxConcurrent),
        });
      })
      .catch(() => undefined);
    fetch("/api/settings/credentials", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((items: CredentialSummary[] | null) => {
        if (Array.isArray(items)) setCredentials(items);
      })
      .catch(() => undefined);
    fetchNotificationTestSettings(sessionToken)
      .then((settings: NotificationTestSettings | null) => {
        if (!settings) return;
        setNotificationTestSettings(settings);
        setNotificationTestForm({
          titleZh: settings.titleZh,
          titleEn: settings.titleEn,
          messageZh: settings.messageZh,
          messageEn: settings.messageEn,
          includeHelp: settings.includeHelp,
        });
      })
      .catch(() => undefined);
    fetch("/api/settings/backup", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: SystemBackupSettings | null) => {
        if (!settings) return;
        setBackupSettings(settings);
        setBackupIgnoreRules(settings.ignorePatterns.join("\n"));
      })
      .catch(() => undefined);
    fetch("/api/settings/environment", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((overview: EnvironmentOverview | null) => {
        if (!overview) return;
        setEnvironmentOverview(overview);
      })
      .catch(() => undefined);
    fetch("/api/settings/environment/tool-registry", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { items: EnvironmentToolRegistryItem[] } | null) => {
        if (!result) return;
        setEnvironmentRegistry(result.items);
      })
      .catch(() => undefined);
    fetch("/api/auth/api-key-permissions", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((result: ApiKeyPermissionsResponse | null) => {
        if (!result) return;
        setApiKeyGroups(result.groups);
        setApiKeyPresets(result.presets);
      })
      .catch(() => undefined);
    fetch("/api/auth/api-keys", { headers })
      .then((response) => response.ok ? response.json() : null)
      .then((result: ApiKeySummary[] | null) => {
        if (!result) return;
        setApiKeys(result);
      })
      .catch(() => undefined);
    void loadNotifications();
    void loadUsageOverview();
  }, [sessionToken]);

  useEffect(() => {
    if (!notificationSettings) return;
    void loadNotifications();
  }, [notificationRuleEnabledFilter, notificationDeliveryEventFilter, notificationDeliveryStatusFilter, notificationDeliverySeverityFilter]);

  async function loadNotifications() {
    const [result, platforms] = await Promise.all([
      fetchNotificationSettings(sessionToken),
      fetchNotificationPlatformSettings(sessionToken),
    ]);
    if (!result) return;
    if (platforms) setPlatformSettings(platforms);
    const ruleParams = new URLSearchParams({ limit: "20" });
    if (notificationRuleEnabledFilter) ruleParams.set("enabled", notificationRuleEnabledFilter);
    const deliveryParams = new URLSearchParams({ limit: "20" });
    if (notificationDeliveryEventFilter) deliveryParams.set("eventType", notificationDeliveryEventFilter);
    if (notificationDeliveryStatusFilter) deliveryParams.set("status", notificationDeliveryStatusFilter);
    if (notificationDeliverySeverityFilter) deliveryParams.set("severity", notificationDeliverySeverityFilter);
    const [rulesPage, ephemeralRulesPage, deliveriesPage] = await Promise.all([
      fetchNotificationRulesPage(sessionToken, ruleParams),
      fetchNotificationEphemeralRulesPage(sessionToken, new URLSearchParams({ limit: "20" })),
      fetchNotificationDeliveriesPage(sessionToken, deliveryParams),
    ]);
    setNotificationSettings({
      ...result,
      rules: rulesPage?.items ?? result.rules,
      ephemeralRules: ephemeralRulesPage?.items ?? result.ephemeralRules,
      recentDeliveries: deliveriesPage?.items ?? result.recentDeliveries,
    });
    setNotificationRuleCursor(rulesPage?.nextCursor ?? null);
    setNotificationEphemeralRuleCursor(ephemeralRulesPage?.nextCursor ?? null);
    setNotificationDeliveryCursor(deliveriesPage?.nextCursor ?? null);
  }

  async function loadUsageOverview(page = 0, filters = appliedUsageFilter) {
    const params = new URLSearchParams({ limit: "10", page: String(Math.max(0, page)) });
    const from = datetimeLocalToIso(filters.createdFrom);
    const to = datetimeLocalToIso(filters.createdTo);
    if (from) params.set("createdFrom", from);
    if (to) params.set("createdTo", to);
    const response = await fetch(`/api/usage?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = (await response.json()) as TokenUsageResponse;
    setUsageOverview(result);
    setUsageRecentPage(result.recentPage);
  }

  function applyUsageTimeFilter(event?: React.FormEvent) {
    event?.preventDefault();
    const filters = { createdFrom: usageFilterFrom, createdTo: usageFilterTo };
    setAppliedUsageFilter(filters);
    setUsageRecentPage(0);
    void loadUsageOverview(0, filters);
  }

  function clearUsageTimeFilter() {
    const filters = { createdFrom: "", createdTo: "" };
    setUsageFilterFrom("");
    setUsageFilterTo("");
    setAppliedUsageFilter(filters);
    setUsageRecentPage(0);
    void loadUsageOverview(0, filters);
  }

  async function saveUsageRetention(event: React.FormEvent) {
    event.preventDefault();
    setBusy("usage-retention");
    try {
      const response = await fetch("/api/settings/token-usage-retention", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ retentionDays: Number(usageRetentionDays) }),
      });
      if (!response.ok) {
        notify(t("usage.retentionSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as TokenUsageRetentionSettings;
      setUsageRetention(settings);
      setUsageRetentionDays(String(settings.retentionDays));
      notify(t("usage.retentionSaved"), "success");
    } catch {
      notify(t("usage.retentionSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function updateUsageDisplay(showMessageUsage: boolean) {
    setBusy("usage-display");
    try {
      const response = await fetch("/api/settings/token-usage-display", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ showMessageUsage }),
      });
      if (!response.ok) {
        notify(t("usage.displaySaveFailed"), "error");
        return;
      }
      setUsageDisplay((await response.json()) as TokenUsageDisplaySettings);
      notify(t("usage.displaySaved"), "success");
    } catch {
      notify(t("usage.displaySaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function cleanupUsageRecords() {
    if (!window.confirm(t("usage.cleanupConfirm"))) return;
    setBusy("usage-cleanup");
    try {
      const response = await fetch("/api/usage/cleanup", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as { deleted?: number } | null;
      if (!response.ok || !result) {
        notify(t("usage.cleanupFailed"), "error");
        return;
      }
      notify(t("usage.cleanupDone").replace("{count}", String(result.deleted ?? 0)), "success");
      void loadUsageOverview();
    } catch {
      notify(t("usage.cleanupFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function clearUsageRecords() {
    if (!window.confirm(t("usage.clearConfirm"))) return;
    setBusy("usage-clear");
    try {
      const response = await fetch("/api/usage/clear", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as { deleted?: number } | null;
      if (!response.ok || !result) {
        notify(t("usage.clearFailed"), "error");
        return;
      }
      notify(t("usage.clearDone").replace("{count}", String(result.deleted ?? 0)), "success");
      void loadUsageOverview();
    } catch {
      notify(t("usage.clearFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteFilteredUsageRecords() {
    const createdFrom = datetimeLocalToIso(appliedUsageFilter.createdFrom);
    const createdTo = datetimeLocalToIso(appliedUsageFilter.createdTo);
    if (!createdFrom && !createdTo) {
      notify(t("usage.deleteFilteredNeedsFilter"), "error");
      return;
    }
    if (!window.confirm(t("usage.deleteFilteredConfirm"))) return;
    setBusy("usage-delete-filtered");
    try {
      const response = await fetch("/api/usage/delete-filtered", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ createdFrom, createdTo }),
      });
      const result = await response.json().catch(() => null) as { deleted?: number } | null;
      if (!response.ok || !result) {
        notify(t("usage.deleteFilteredFailed"), "error");
        return;
      }
      notify(t("usage.deleteFilteredDone").replace("{count}", String(result.deleted ?? 0)), "success");
      void loadUsageOverview(0);
    } catch {
      notify(t("usage.deleteFilteredFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function loadMoreNotificationRules() {
    if (!notificationRuleCursor || notificationRuleLoading) return;
    setNotificationRuleLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20", cursor: notificationRuleCursor });
      if (notificationRuleEnabledFilter) params.set("enabled", notificationRuleEnabledFilter);
      const page = await fetchNotificationRulesPage(sessionToken, params);
      if (!page) return;
      setNotificationSettings((current) => current ? { ...current, rules: [...current.rules, ...page.items] } : current);
      setNotificationRuleCursor(page.nextCursor);
    } finally {
      setNotificationRuleLoading(false);
    }
  }

  async function loadMoreNotificationEphemeralRules() {
    if (!notificationEphemeralRuleCursor || notificationEphemeralRuleLoading) return;
    setNotificationEphemeralRuleLoading(true);
    try {
      const page = await fetchNotificationEphemeralRulesPage(sessionToken, new URLSearchParams({ limit: "20", cursor: notificationEphemeralRuleCursor }));
      if (!page) return;
      setNotificationSettings((current) => current ? { ...current, ephemeralRules: [...current.ephemeralRules, ...page.items] } : current);
      setNotificationEphemeralRuleCursor(page.nextCursor);
    } finally {
      setNotificationEphemeralRuleLoading(false);
    }
  }

  async function loadMoreNotificationDeliveries() {
    if (!notificationDeliveryCursor || notificationDeliveryLoading) return;
    setNotificationDeliveryLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20", cursor: notificationDeliveryCursor });
      if (notificationDeliveryEventFilter) params.set("eventType", notificationDeliveryEventFilter);
      if (notificationDeliveryStatusFilter) params.set("status", notificationDeliveryStatusFilter);
      if (notificationDeliverySeverityFilter) params.set("severity", notificationDeliverySeverityFilter);
      const page = await fetchNotificationDeliveriesPage(sessionToken, params);
      if (!page) return;
      setNotificationSettings((current) => current ? { ...current, recentDeliveries: [...current.recentDeliveries, ...page.items] } : current);
      setNotificationDeliveryCursor(page.nextCursor);
    } finally {
      setNotificationDeliveryLoading(false);
    }
  }

  const notificationChannelKindLabel = useCallback((kind: NotificationAccountSummary["channelKind"] | NotificationRecipientSummary["kind"]) => {
    return notificationKindLabel(t, kind);
  }, [t]);

  function resetNotificationAccountForm() {
    setNotificationEditingAccountId("");
    setNotificationAccountEditorOpen(false);
    setNotificationAccountForm(createNotificationAccountForm(locale));
  }

  function editNotificationAccount(account: NotificationAccountSummary) {
    setNotificationEditingAccountId(account.id);
    setNotificationAccountEditorOpen(true);
    setNotificationAccountForm(notificationAccountFormFromAccount(account, notificationSettings?.channels));
  }

  function toggleNotificationEvent(type: NotificationEventType) {
    setNotificationRuleForm((current) => ({
      ...current,
      eventTypes: current.eventTypes.includes(type)
        ? current.eventTypes.filter((item) => item !== type)
        : [...current.eventTypes, type],
    }));
  }

  function toggleNotificationTarget(recipientId: string) {
    setNotificationRuleForm((current) => ({
      ...current,
      recipientIds: current.recipientIds.includes(recipientId)
        ? current.recipientIds.filter((item) => item !== recipientId)
        : [...current.recipientIds, recipientId],
    }));
  }

  function resetNotificationRuleForm() {
    setNotificationEditingRuleId("");
    setNotificationRuleForm(createNotificationRuleForm());
  }

  function editNotificationRule(rule: NotificationRuleSummary) {
    setNotificationEditingRuleId(rule.id);
    setNotificationRuleForm(notificationRuleFormFromRule(rule, notificationSettings?.recipients ?? []));
  }

  function resetNotificationChannelForm() {
    setNotificationEditingChannelId("");
    setNotificationChannelForm(createNotificationChannelForm());
  }

  function editNotificationChannel(channel: NotificationChannelDefinition) {
    if (channel.kind !== "webhook") return;
    setNotificationEditingChannelId(channel.id);
    setNotificationChannelForm({
      name: channel.name,
      description: channel.description,
      adapter: channel.adapter ?? "webhook",
      authType: channel.authType ?? "none",
      method: channel.method ?? "POST",
      urlTemplate: channel.urlTemplate ?? "",
      headersTemplate: channel.headersTemplate ?? "",
      bodyTemplate: channel.bodyTemplate ?? "",
      accountFields: (channel.accountFields ?? []).join(","),
    });
  }

  async function createNotificationChannel(event: React.FormEvent) {
    event.preventDefault();
    const editingChannel = notificationSettings?.channels.find((channel) => channel.id === notificationEditingChannelId);
    if (editingChannel?.builtin) return;
    setBusy("notification-channel");
    try {
      const response = await upsertNotificationChannel(sessionToken, notificationEditingChannelId, {
        name: notificationChannelForm.name,
        description: notificationChannelForm.description,
        adapter: notificationChannelForm.adapter,
        authType: notificationChannelForm.authType,
        method: notificationChannelForm.method,
        urlTemplate: notificationChannelForm.urlTemplate,
        headersTemplate: notificationChannelForm.headersTemplate,
        bodyTemplate: notificationChannelForm.bodyTemplate,
        accountFields: notificationChannelForm.accountFields.split(",").map((item) => item.trim()).filter(Boolean),
      });
      if (!response.ok) throw new Error("notification_channel_failed");
      resetNotificationChannelForm();
      await loadNotifications();
      notify(t("settings.notificationChannelSaved"), "success");
    } catch {
      notify(t("settings.notificationChannelSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationChannel(channel: NotificationChannelDefinition) {
    if (channel.builtin) return;
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteChannelConfirm"),
      message: channel.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-channel-delete:${channel.id}`);
    try {
      const response = await deleteNotificationChannelRequest(sessionToken, channel.id);
      if (!response.ok) notify(t("settings.notificationChannelDeleteFailed"), "error");
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  function resetNotificationRecipientForm() {
    setNotificationEditingRecipientId("");
    setNotificationRecipientEditorOpen(false);
    setNotificationRecipientForm(createNotificationRecipientForm());
  }

  function editNotificationRecipient(recipient: NotificationRecipientSummary) {
    setNotificationEditingRecipientId(recipient.id);
    setNotificationRecipientEditorOpen(true);
    setNotificationRecipientForm(notificationRecipientFormFromRecipient(recipient, notificationSettings?.accounts ?? []));
  }

  async function createNotificationRecipient(event: React.FormEvent) {
    event.preventDefault();
    setBusy("notification-recipient");
    try {
      const response = await upsertNotificationRecipient(sessionToken, notificationEditingRecipientId, {
        name: notificationRecipientForm.name,
        kind: notificationRecipientForm.kind,
        enabled: notificationRecipientForm.enabled,
        senderAccountId: notificationRecipientForm.kind === "email"
          ? notificationRecipientForm.senderAccountId
          : notificationRecipientForm.kind === "telegram"
            ? notificationRecipientForm.telegramSenderAccountId
            : notificationRecipientForm.kind === "weixin"
              ? notificationRecipientForm.weixinSenderAccountId
              : notificationRecipientForm.kind === "dingtalk"
                ? notificationRecipientForm.dingtalkSenderAccountId
              : notificationRecipientForm.kind === "feishu"
                ? notificationRecipientForm.feishuSenderAccountId
              : notificationRecipientForm.kind === "wecom"
                ? notificationRecipientForm.wecomSenderAccountId
              : notificationRecipientForm.qqSenderAccountId,
        channelId: notificationRecipientForm.kind === "webhook" ? notificationRecipientForm.channelId : null,
        config: buildNotificationRecipientConfig(notificationRecipientForm, notificationSettings?.channels),
        permissions: notificationPermissionsFromForm(notificationRecipientForm),
      });
      if (!response.ok) throw new Error("notification_recipient_failed");
      resetNotificationRecipientForm();
      await loadNotifications();
      notify(t("settings.notificationRecipientSaved"), "success");
    } catch {
      notify(t("settings.notificationRecipientSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationRecipient(recipient: NotificationRecipientSummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteRecipientConfirm"),
      message: recipient.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-recipient-delete:${recipient.id}`);
    try {
      await deleteNotificationRecipientRequest(sessionToken, recipient.id);
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function testNotificationRecipient(recipient: NotificationRecipientSummary) {
    setBusy(`notification-recipient-test:${recipient.id}`);
    try {
      const response = await testNotificationRecipientRequest(sessionToken, recipient.id);
      await loadNotifications();
      notify(response.ok ? t("settings.notificationTestSent") : t("settings.notificationTestFailed"), response.ok ? "success" : "error");
    } finally {
      setBusy("");
    }
  }

  async function createNotificationAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy("notification-account");
    try {
      const account = await upsertNotificationAccount(sessionToken, notificationEditingAccountId, {
        name: notificationAccountForm.name,
        channelId: notificationAccountForm.channelId,
        channelKind: notificationAccountForm.channelKind,
        enabled: notificationAccountForm.enabled,
        config: buildNotificationAccountConfig(notificationAccountForm, resolveSelectedNotificationChannel(notificationAccountForm, notificationSettings?.channels)),
        permissions: notificationPermissionsFromForm(notificationAccountForm),
      });
      if (!account) throw new Error("notification_account_failed");
      const createRecipient = !notificationEditingAccountId && (
        (notificationAccountForm.channelKind === "email" && notificationAccountForm.emailCreateRecipient && notificationAccountForm.emailFromEmail.trim()) ||
        (notificationAccountForm.channelKind === "telegram" && notificationAccountForm.telegramCreateRecipient && notificationAccountForm.telegramTestChatId.trim()) ||
        (notificationAccountForm.channelKind === "weixin" && notificationAccountForm.weixinCreateRecipient && notificationAccountForm.weixinTestChatId.trim()) ||
        (notificationAccountForm.channelKind === "wecom" && notificationAccountForm.wecomCreateRecipient && notificationAccountForm.wecomTestChatId.trim()) ||
        (notificationAccountForm.channelKind === "dingtalk" && notificationAccountForm.dingtalkCreateRecipient) ||
        (notificationAccountForm.channelKind === "feishu" && notificationAccountForm.feishuCreateRecipient && notificationAccountForm.feishuTestChatId.trim()) ||
        (notificationAccountForm.channelKind === "qq" && notificationAccountForm.qqCreateRecipient && (notificationAccountForm.qqTestChatId.trim() || notificationAccountForm.qqTestTargetId.trim()))
      );
      const existingLinkedRecipient = (notificationSettings?.recipients ?? []).some((recipient) => recipient.senderAccountId === account.id && recipient.kind === notificationAccountForm.channelKind);
      if (createRecipient && !existingLinkedRecipient) {
        const senderAccountId = account.id;
        const config = notificationAccountForm.channelKind === "email"
          ? { email: notificationAccountForm.emailFromEmail.trim() }
          : notificationAccountForm.channelKind === "telegram"
            ? { chatId: notificationAccountForm.telegramTestChatId.trim() }
            : notificationAccountForm.channelKind === "weixin"
              ? { chatId: notificationAccountForm.weixinTestChatId.trim() }
              : notificationAccountForm.channelKind === "wecom"
                ? { chatId: notificationAccountForm.wecomTestChatId.trim() }
                : notificationAccountForm.channelKind === "dingtalk"
                  ? {}
                  : notificationAccountForm.channelKind === "feishu"
                    ? { chatId: notificationAccountForm.feishuTestChatId.trim() }
                    : { chatId: notificationAccountForm.qqTestChatId.trim() || notificationAccountForm.qqTestTargetId.trim() };
        await upsertNotificationRecipient(sessionToken, "", {
          name: notificationAccountForm.name || notificationAccountForm.emailFromEmail || account.name,
          kind: notificationAccountForm.channelKind,
          enabled: true,
          senderAccountId,
          config,
        });
      }
      resetNotificationAccountForm();
      await loadNotifications();
      notify(t("settings.notificationAccountSaved"), "success");
    } catch {
      notify(t("settings.notificationAccountSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function testNotificationAccount(account: NotificationAccountSummary) {
    setBusy(`notification-test:${account.id}`);
    try {
      const { emailTo, chatId } = buildNotificationAccountTestTarget(notificationAccountForm, account);
      const response = await testNotificationAccountRequest(sessionToken, account.id, {
        emailTo,
        chatId: chatId || undefined,
      });
      await loadNotifications();
      notify(response.ok ? t("settings.notificationTestSent") : t("settings.notificationTestFailed"), response.ok ? "success" : "error");
    } finally {
      setBusy("");
    }
  }

  async function sendCustomNotificationTest(event: React.FormEvent) {
    event.preventDefault();
    const account = notificationCustomTestAccount;
    if (!account) return;
    setBusy(`notification-custom-test:${account.id}`);
    try {
      const { emailTo, chatId } = buildNotificationAccountTestTarget(notificationAccountForm, account);
      const response = await testNotificationAccountRequest(sessionToken, account.id, {
        emailTo,
        chatId: chatId || undefined,
        title: notificationCustomTestForm.title.trim() || undefined,
        message: notificationCustomTestForm.message.trim() || undefined,
        includeHelp: notificationCustomTestForm.includeHelp,
      });
      await loadNotifications();
      notify(response.ok ? t("settings.notificationTestSent") : t("settings.notificationTestFailed"), response.ok ? "success" : "error");
      if (response.ok) {
        setNotificationCustomTestAccount(null);
        setNotificationCustomTestForm({ title: "", message: "", includeHelp: true });
      }
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationAccount(account: NotificationAccountSummary) {
    const linkedRecipients = (notificationSettings?.recipients ?? []).filter((recipient) => recipient.senderAccountId === account.id);
    let deleteLinkedRecipients = false;
    if (linkedRecipients.length) {
      const decision = await dialog.confirmWithCheckbox({
        title: t("settings.notificationDeleteAccountConfirm"),
        message: t("settings.notificationDeleteAccountLinkedMessage")
          .replace("{name}", account.name)
          .replace("{count}", String(linkedRecipients.length)),
        checkboxLabel: t("settings.notificationDeleteAccountLinkedCheckbox").replace("{count}", String(linkedRecipients.length)),
        checkboxDefaultChecked: false,
        confirmLabel: t("action.delete"),
        danger: true,
      });
      if (!decision.confirmed) return;
      deleteLinkedRecipients = decision.checked;
    } else {
      const confirmed = await dialog.confirm({
        title: t("settings.notificationDeleteAccountConfirm"),
        message: account.name,
        confirmLabel: t("action.delete"),
        danger: true,
      });
      if (!confirmed) return;
    }
    setBusy(`notification-account-delete:${account.id}`);
    try {
      await deleteNotificationAccountRequest(sessionToken, account.id, deleteLinkedRecipients);
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function createNotificationRule(event: React.FormEvent) {
    event.preventDefault();
    const targets: NotificationRuleTarget[] = notificationRuleForm.recipientIds.map((recipientId) => {
      const recipient = notificationSettings?.recipients.find((item) => item.id === recipientId);
      return {
        recipientId,
        senderAccountId: recipient?.kind === "telegram" ? notificationRuleForm.telegramSenderAccountId || undefined : notificationRuleForm.senderAccountId || undefined,
      };
    });
    setBusy("notification-rule");
    try {
      const response = await upsertNotificationRule(sessionToken, notificationEditingRuleId, {
        name: notificationRuleForm.name,
        enabled: notificationRuleForm.enabled,
        eventTypes: notificationRuleForm.eventTypes,
        minSeverity: notificationRuleForm.minSeverity,
        targets,
        dedupeMinutes: Number(notificationRuleForm.dedupeMinutes) || 0,
      });
      if (!response.ok) throw new Error("notification_rule_failed");
      resetNotificationRuleForm();
      await loadNotifications();
      notify(t("settings.notificationRuleSaved"), "success");
    } catch {
      notify(t("settings.notificationRuleSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function toggleNotificationRule(rule: NotificationRuleSummary) {
    setBusy(`notification-rule:${rule.id}`);
    try {
      await upsertNotificationRule(sessionToken, rule.id, { enabled: !rule.enabled });
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationRule(rule: NotificationRuleSummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteRuleConfirm"),
      message: rule.name,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-rule-delete:${rule.id}`);
    try {
      await deleteNotificationRuleRequest(sessionToken, rule.id);
      if (notificationEditingRuleId === rule.id) resetNotificationRuleForm();
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationEphemeralRule(rule: NotificationEphemeralRuleSummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteEphemeralRuleConfirm"),
      message: `${rule.scopeType} · ${rule.eventTypes.join(", ")}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-ephemeral-rule-delete:${rule.id}`);
    try {
      await deleteNotificationEphemeralRuleRequest(sessionToken, rule.id);
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function clearNotificationRules() {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationClearRulesConfirm"),
      message: t("settings.notificationClearRulesMessage"),
      confirmLabel: t("settings.notificationClearRules"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("notification-rules-clear");
    try {
      await clearNotificationRulesRequest(sessionToken);
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function deleteNotificationDelivery(delivery: NotificationDeliverySummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationDeleteDeliveryConfirm"),
      message: delivery.title,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`notification-delivery-delete:${delivery.id}`);
    try {
      await deleteNotificationDeliveryRequest(sessionToken, delivery.id);
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function retryNotificationDelivery(delivery: NotificationDeliverySummary) {
    setBusy(`notification-delivery-retry:${delivery.id}`);
    try {
      const response = await retryNotificationDeliveryRequest(sessionToken, delivery.id);
      notify(response.ok ? t("settings.notificationRetryStarted") : t("settings.notificationRetryFailed"), response.ok ? "success" : "error");
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  async function clearNotificationDeliveries() {
    const confirmed = await dialog.confirm({
      title: t("settings.notificationClearDeliveriesConfirm"),
      message: t("settings.notificationClearDeliveriesMessage"),
      confirmLabel: t("settings.notificationClearDeliveries"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("notification-deliveries-clear");
    try {
      await clearNotificationDeliveriesRequest(sessionToken);
      await loadNotifications();
    } finally {
      setBusy("");
    }
  }

  function notificationDeliveryMetadata(delivery: NotificationDeliverySummary) {
    const metadata = delivery.metadata ?? {};
    const account = metadata.account && typeof metadata.account === "object" ? metadata.account as Record<string, unknown> : {};
    const recipient = metadata.recipient && typeof metadata.recipient === "object" ? metadata.recipient as Record<string, unknown> : {};
    const target = metadata.target && typeof metadata.target === "object" ? metadata.target as Record<string, unknown> : {};
    const targetKind = (recipient.kind ?? account.kind) as NotificationAccountSummary["channelKind"] | NotificationRecipientSummary["kind"] | undefined;
    return {
      targetName: recipient.name ? String(recipient.name) : account.name ? String(account.name) : delivery.accountId ?? "-",
      targetKind: targetKind ? notificationChannelKindLabel(targetKind) : "-",
      accountName: account.name ? String(account.name) : delivery.accountId ?? "-",
      responseStatus: delivery.responseStatus ?? "-",
      attempts: delivery.attempts,
      sentAt: delivery.sentAt ? formatShortDate(delivery.sentAt) : "-",
      emailToCount: Number(target.emailToCount ?? 0),
      chatConfigured: Boolean(target.chatId),
    };
  }

  async function updateAccessToken(event: React.FormEvent) {
    event.preventDefault();
    setTokenMessage("");
    if (accessToken !== confirmAccessToken) {
      showTokenNotice(t("settings.tokenMismatch"));
      return;
    }
    setBusy("token");
    try {
      const body: UpdateAccessTokenRequest = { currentAccessToken, accessToken };
      const response = await fetch("/api/auth/access-token", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as (LoginResponse & { error?: string }) | null;
      if (!response.ok) {
        if (result?.error === "unauthorized") showTokenNotice(t("settings.loginExpired"));
        else if (result?.error === "invalid_current_access_token") showTokenNotice(t("settings.currentTokenInvalid"));
        else if (result?.error === "access_token_required") showTokenNotice(t("settings.tokenRequired"));
        else showTokenNotice(t("settings.tokenUpdateFailed"));
        return;
      }
      if (result?.sessionToken) {
        onSessionRefresh(result.sessionToken, result.auth);
        setCurrentAccessToken("");
        setAccessToken("");
        setConfirmAccessToken("");
        showTokenNotice(t("settings.tokenUpdated"));
      } else {
        showTokenNotice(t("settings.tokenUpdateFailed"));
      }
    } catch {
      showTokenNotice(t("settings.tokenUpdateFailed"));
    } finally {
      setBusy("");
    }
  }

  async function resetOtp() {
    setOtpMessage("");
    setBusy("otp");
    const response = await fetch("/api/auth/otp/reset", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    setBusy("");
    if (!response.ok) {
      showOtpNotice(t("settings.otpResetFailed"));
      return;
    }
    const result = (await response.json()) as ResetOtpResponse;
    setOtpSecret(result.otpSecret);
    setOtpQr(await QRCode.toDataURL(result.otpauthUrl, {
      margin: 1,
      width: 192,
      color: { dark: "#191d1b", light: "#ffffff" },
    }));
    setOtpAccessToken("");
    setOtpCode("");
    setOtpCopyMessage("");
    setOtpMessage(t("settings.otpGenerated"));
  }

  async function confirmOtpReset(event: React.FormEvent) {
    event.preventDefault();
    if (!otpSecret || !otpAccessToken.trim() || !otpCode.trim()) return;
    setOtpMessage("");
    setBusy("otp-confirm");
    const body: ConfirmOtpResetRequest = { currentAccessToken: otpAccessToken, otp: otpCode.trim() };
    const response = await fetch("/api/auth/otp/reset/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy("");
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      showOtpNotice(result?.error === "invalid_current_access_token" ? t("settings.currentTokenInvalid") : t("settings.otpVerifyFailed"));
      return;
    }
    const result = (await response.json()) as LoginResponse;
    if (result.sessionToken) {
      showOtpNotice(t("settings.otpReset"));
      onSessionRefresh(result.sessionToken, result.auth);
      setOtpAccessToken("");
      setOtpCode("");
    }
  }

  async function copyOtpSecret() {
    if (!otpSecret) return;
    const copied = await copyText(otpSecret);
    setOtpCopyMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    setOtpMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
    window.setTimeout(() => setOtpCopyMessage(""), 4000);
  }

  function toggleApiKeyPermission(permission: ApiKeyPermission) {
    setApiKeyForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  function applyApiKeyPreset(preset: ApiKeyPreset) {
    setApiKeyForm((current) => ({ ...current, permissions: [...preset.permissions] }));
  }

  function openCreateApiKeyEditor() {
    setApiKeyEditorMode("create");
    setApiKeyEditingId("");
    setApiKeyForm({ name: "", permissions: [] });
    setCreatedApiKey(null);
    setApiKeyEditorOpen(true);
  }

  function openEditApiKeyEditor(key: ApiKeySummary) {
    setApiKeyEditorMode("edit");
    setApiKeyEditingId(key.id);
    setApiKeyForm({ name: key.name, permissions: [...key.permissions] });
    setCreatedApiKey(null);
    setApiKeyEditorOpen(true);
  }

  function closeApiKeyEditor() {
    setApiKeyEditorOpen(false);
    setApiKeyEditingId("");
    setApiKeyEditorMode("create");
    setApiKeyForm({ name: "", permissions: [] });
    setCreatedApiKey(null);
  }

  async function saveApiKey(event: React.FormEvent) {
    event.preventDefault();
    setApiKeyMessage("");
    if (!apiKeyForm.name.trim() || !apiKeyForm.permissions.length) {
      showApiKeyNotice(t("settings.apiKeysCreateInvalid"), "error");
      return;
    }
    const editing = apiKeyEditorMode === "edit";
    setBusy(editing ? "api-key-update" : "api-key-create");
    try {
      const body: CreateApiKeyRequest | UpdateApiKeyRequest = {
        name: apiKeyForm.name.trim(),
        permissions: apiKeyForm.permissions,
      };
      const response = await fetch(editing ? `/api/auth/api-keys/${apiKeyEditingId}` : "/api/auth/api-keys", {
        method: editing ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as ((ApiKeyDetailResponse | ApiKeySummary) & { error?: string }) | null;
      if (!response.ok || !result?.id) {
        showApiKeyNotice(editing ? t("settings.apiKeysUpdateFailed") : t("settings.apiKeysCreateFailed"), "error");
        return;
      }
      if (editing) {
        setApiKeys((current) => current.map((item) => item.id === result.id ? { ...item, ...result } : item));
        closeApiKeyEditor();
        showApiKeyNotice(t("settings.apiKeysUpdated"), "success");
      } else {
        const detail = result as ApiKeyDetailResponse;
        setCreatedApiKey(detail);
        setApiKeys((current) => [detail, ...current]);
        setApiKeyForm({ name: "", permissions: [] });
        showApiKeyNotice(t("settings.apiKeysCreated"), "success");
      }
    } catch {
      showApiKeyNotice(apiKeyEditorMode === "edit" ? t("settings.apiKeysUpdateFailed") : t("settings.apiKeysCreateFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function revokeApiKey(key: ApiKeySummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.apiKeysRevoke"),
      message: `${key.name}\n${t("settings.apiKeysRevokeConfirm")}`,
      confirmLabel: t("settings.apiKeysRevoke"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`api-key-revoke:${key.id}`);
    try {
      const response = await fetch(`/api/auth/api-keys/${key.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as (ApiKeySummary & { error?: string }) | null;
      if (!response.ok || !result?.id) {
        showApiKeyNotice(t("settings.apiKeysRevokeFailed"), "error");
        return;
      }
      setApiKeys((current) => current.map((item) => item.id === result.id ? result : item));
      showApiKeyNotice(t("settings.apiKeysRevoked"), "success");
    } catch {
      showApiKeyNotice(t("settings.apiKeysRevokeFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteRevokedApiKey(key: ApiKeySummary) {
    const confirmed = await dialog.confirm({
      title: t("settings.apiKeysDeleteRecord"),
      message: `${key.name}\n${t("settings.apiKeysDeleteRecordConfirm")}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`api-key-delete:${key.id}`);
    try {
      const response = await fetch(`/api/auth/api-keys/${key.id}/record`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        showApiKeyNotice(t("settings.apiKeysDeleteRecordFailed"), "error");
        return;
      }
      setApiKeys((current) => current.filter((item) => item.id !== key.id));
      showApiKeyNotice(t("settings.apiKeysDeleteRecordDone"), "success");
    } catch {
      showApiKeyNotice(t("settings.apiKeysDeleteRecordFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function copyCreatedApiKey() {
    if (!createdApiKey?.key) return;
    const copied = await copyText(createdApiKey.key);
    showApiKeyNotice(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function cleanupMaintenance() {
    if (!window.confirm(cleanupApprovalAuditLog ? t("settings.cleanupAuditConfirm") : t("settings.cleanupConfirm"))) return;
    setCleanupMessage("");
    setBusy("cleanup");
    try {
      const response = await fetch("/api/settings/maintenance/cleanup", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          deleteArchivedApprovals: cleanupArchivedApprovals,
          archivedApprovalRetentionDays: cleanupArchivedApprovalDays,
          deleteApprovalAuditLog: cleanupApprovalAuditLog,
        }),
      });
      const result = await response.json().catch(() => null) as MaintenanceCleanupResponse | { error?: string } | null;
      if (!response.ok || !result || !("deleted" in result)) {
        setCleanupMessage(t("settings.cleanupFailed"));
        notify(t("settings.cleanupFailed"), "error");
        return;
      }
      const totalDeleted = Object.values(result.deleted).reduce((sum, value) => sum + value, 0);
      const totalUpdated = Object.values(result.updated).reduce((sum, value) => sum + value, 0);
      const message = `${t("settings.cleanupDone")} ${t("settings.cleanupDeleted")}: ${totalDeleted}; ${t("settings.cleanupUpdated")}: ${totalUpdated}`;
      setCleanupMessage(message);
      notify(message, "success");
    } catch {
      setCleanupMessage(t("settings.cleanupFailed"));
      notify(t("settings.cleanupFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function loadTaskHealth() {
    setBusy("task-health");
    try {
      const response = await fetch("/api/settings/task-health", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("task_health_failed");
      const result = (await response.json()) as TaskHealthResponse;
      setTaskHealth(result);
      notify(result.ok ? t("settings.taskHealthOk") : t("settings.taskHealthIssues"), result.ok ? "success" : "info");
    } catch {
      notify(t("settings.taskHealthFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function repairTaskHealth() {
    const confirmed = await dialog.confirm({
      title: t("settings.repairTaskHealth"),
      message: t("settings.repairTaskHealthConfirm"),
      confirmLabel: t("settings.repairTaskHealth"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("task-health-repair");
    try {
      const response = await fetch("/api/settings/task-health/repair", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("task_health_repair_failed");
      const result = (await response.json()) as TaskHealthRepairResponse;
      setTaskHealth(result.health);
      notify(t("settings.taskHealthRepaired").replace("{count}", String(result.repaired.length)), "success");
    } catch {
      notify(t("settings.taskHealthRepairFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function resetApprovals() {
    if (!window.confirm(t("settings.resetApprovalsConfirm"))) return;
    setCleanupMessage("");
    setBusy("approval-reset");
    try {
      const response = await fetch("/api/settings/approvals/reset", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; deletedGrants?: number } | null;
      if (!response.ok || !result?.ok) {
        setCleanupMessage(t("settings.resetApprovalsFailed"));
        notify(t("settings.resetApprovalsFailed"), "error");
        return;
      }
      const message = t("settings.resetApprovalsDone").replace("{count}", String(result.deletedGrants ?? 0));
      setCleanupMessage(message);
      notify(message, "success");
    } catch {
      setCleanupMessage(t("settings.resetApprovalsFailed"));
      notify(t("settings.resetApprovalsFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function scanStorage() {
    setBusy("storage-scan");
    try {
      const response = await fetch("/api/settings/storage", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("storage_scan_failed");
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds([]);
    } catch {
      notify(t("common.loadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteStorageItem(item: StorageItemSummary) {
    const force = item.status === "active";
    if (!window.confirm(force ? t("settings.storageForceDeleteConfirm") : t("settings.storageDeleteConfirm"))) return;
    setBusy(`storage-delete:${item.id}`);
    try {
      const response = await fetch("/api/settings/storage/delete", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ type: item.type, path: item.path, force }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "storage_delete_failed");
      }
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds((items) => items.filter((id) => id !== item.id));
      notify(t("settings.storageDeleted"), "success");
    } catch (error) {
      notify(error instanceof Error && error.message === "storage_item_active" ? t("settings.storageDeleteActiveFailed") : t("settings.storageDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function copyStoragePath(item: StorageItemSummary) {
    const copied = await copyText(item.path);
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function deleteSelectedStorageItems() {
    const selected = visibleStorageItems.filter((item) => selectedStorageIds.includes(item.id));
    if (!selected.length) return;
    const activeCount = selected.filter((item) => item.status === "active").length;
    const force = activeCount > 0;
    const confirmMessage = force
      ? t("settings.storageForceDeleteSelectedConfirm").replace("{count}", String(activeCount))
      : t("settings.storageDeleteSelectedConfirm").replace("{count}", String(selected.length));
    if (!window.confirm(confirmMessage)) return;
    setBusy("storage-delete-selected");
    try {
      const response = await fetch("/api/settings/storage/delete-batch", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ items: selected.map((item) => ({ type: item.type, path: item.path })), force }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "storage_delete_failed");
      }
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds([]);
      notify(t("settings.storageDeleted"), "success");
    } catch (error) {
      notify(error instanceof Error && error.message === "storage_item_active" ? t("settings.storageDeleteActiveFailed") : t("settings.storageDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteOrphanStorageItems() {
    const selected = orphanStorageItems;
    if (!selected.length) return;
    if (!window.confirm(t("settings.storageDeleteOrphansConfirm").replace("{count}", String(selected.length)))) return;
    setBusy("storage-delete-orphans");
    try {
      const response = await fetch("/api/settings/storage/delete-batch", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ items: selected.map((item) => ({ type: item.type, path: item.path })), force: false }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "storage_delete_failed");
      }
      setStorageScan((await response.json()) as StorageScanResponse);
      setSelectedStorageIds([]);
      notify(t("settings.storageDeleted"), "success");
    } catch {
      notify(t("settings.storageDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveBackupSettings(nextRules = backupIgnoreRules) {
    setBusy("backup-settings");
    try {
      const body: UpdateSystemBackupSettingsRequest = { ignorePatterns: nextRules };
      const response = await fetch("/api/settings/backup", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("backup_settings_failed");
      const settings = (await response.json()) as SystemBackupSettings;
      setBackupSettings(settings);
      setBackupIgnoreRules(settings.ignorePatterns.join("\n"));
      setBackupPreview(null);
      notify(t("settings.backupIgnoreSaved"), "success");
    } catch {
      notify(t("settings.backupIgnoreSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function editBackupIgnoreRules() {
    const nextRules = await dialog.prompt({
      title: t("settings.backupIgnoreTitle"),
      message: t("settings.backupIgnoreHelp"),
      defaultValue: backupIgnoreRules,
      placeholder: "node_modules/\n.DS_Store\n*.tmp",
      confirmLabel: t("settings.saveBackupIgnore"),
      multiline: true,
    });
    if (nextRules === null) return;
    setBackupIgnoreRules(nextRules);
    await saveBackupSettings(nextRules);
  }

  async function loadBackupPreview() {
    setBusy("backup-preview");
    try {
      const response = await fetch("/api/settings/backup/preview", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("backup_preview_failed");
      setBackupFilePage(0);
      setBackupPreview((await response.json()) as SystemBackupPreviewResponse);
    } catch {
      notify(t("settings.backupPreviewFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function downloadSystemBackup() {
    setBusy("backup-download");
    try {
      const response = await fetch("/api/settings/backup/download", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("backup_download_failed");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `codex-web-system-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify(t("settings.backupDownloadStarted"), "success");
    } catch {
      notify(t("settings.backupDownloadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function previewRestoreBackup(file: File) {
    setRestoreFile(file);
    setRestorePreview(null);
    setRestoreFilePage(0);
    setRestoreMessage("");
    setBusy("restore-preview");
    try {
      const form = new FormData();
      form.append("backup", file);
      const response = await fetch("/api/settings/restore/preview", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      if (!response.ok) throw new Error("restore_preview_failed");
      setRestoreFilePage(0);
      setRestorePreview((await response.json()) as SystemBackupPreviewResponse);
    } catch {
      setRestoreFile(null);
      notify(t("settings.restorePreviewFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function restoreSystemBackup() {
    if (!restoreFile) return;
    if (!window.confirm(t("settings.restoreConfirm"))) return;
    setRestoreMessage("");
    setBusy("restore-apply");
    try {
      const form = new FormData();
      form.append("backup", restoreFile);
      const response = await fetch("/api/settings/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      const result = await response.json().catch(() => null) as (SystemRestoreResponse & { error?: string }) | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "restore_failed");
      const message = t("settings.restoreDone").replace("{path}", result.backupBeforeRestorePath);
      setRestoreMessage(message);
      notify(t("settings.restoreDoneToast"), "success");
    } catch {
      setRestoreMessage(t("settings.restoreFailed"));
      notify(t("settings.restoreFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveCodexRuntime(event: React.FormEvent) {
    event.preventDefault();
    setBusy("runtime");
    const body: UpdateCodexRuntimeSettingsRequest = { sandboxMode, approvalPolicy, bypassSandbox };
    try {
      const response = await fetch("/api/settings/codex-runtime", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string; approval?: ApprovalSummary } | null;
        if (response.status === 409 && result?.error === "approval_required") {
          if (result.approval) onApprovalRequired(result.approval);
          notify(t("approval.required"), "info");
          return;
        }
        notify(t("settings.runtimeSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as CodexRuntimeSettings;
      setCodexRuntime(settings);
      setSandboxMode(settings.sandboxMode);
      setApprovalPolicy(settings.approvalPolicy);
      setBypassSandbox(settings.bypassSandbox);
      notify(t("settings.runtimeSaved"), "success");
    } catch {
      notify(t("settings.runtimeSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  function editCredential(item: CredentialSummary) {
    setEditingCredentialName(item.name);
    setCredentialForm({ name: item.name, description: item.description, value: "" });
    setCredentialEditorOpen(true);
  }

  function clearCredentialForm() {
    setEditingCredentialName("");
    setCredentialForm({ name: "", description: "", value: "" });
    setCredentialEditorOpen(false);
  }

  function openCreateCredentialEditor() {
    setEditingCredentialName("");
    setCredentialForm({ name: "", description: "", value: "" });
    setCredentialEditorOpen(true);
  }

  async function saveCredential(event: React.FormEvent) {
    event.preventDefault();
    const name = credentialForm.name.trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]{0,99}$/.test(name)) {
      notify(locale === "zh-CN" ? "凭证名称只能使用大写字母、数字和下划线，且不能以数字开头" : "Credential names can only use uppercase letters, numbers, and underscores, and cannot start with a number", "error");
      return;
    }
    if (!editingCredentialName && !credentialForm.value) {
      notify(locale === "zh-CN" ? "新凭证需要填写 Secret 值" : "New credentials need a secret value", "error");
      return;
    }
    setBusy("credential-save");
    try {
      const response = await fetch("/api/settings/credentials", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: credentialForm.description,
          value: credentialForm.value || undefined,
        }),
      });
      const result = await response.json().catch(() => null) as CredentialSummary | null;
      if (!response.ok || !result?.name) {
        notify(locale === "zh-CN" ? "凭证保存失败" : "Failed to save credential", "error");
        return;
      }
      setCredentials((current) => [result, ...current.filter((item) => item.name !== result.name)].sort((a, b) => a.name.localeCompare(b.name)));
      clearCredentialForm();
      notify(locale === "zh-CN" ? "凭证已保存" : "Credential saved", "success");
    } catch {
      notify(locale === "zh-CN" ? "凭证保存失败" : "Failed to save credential", "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteCredential(item: CredentialSummary) {
    const confirmed = await dialog.confirm({
      title: locale === "zh-CN" ? "删除凭证" : "Delete credential",
      message: `${item.name}\n${locale === "zh-CN" ? "删除后依赖它的任务将无法再读取该 Secret。" : "Tasks that depend on this secret will no longer be able to read it."}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`credential-delete:${item.name}`);
    try {
      const response = await fetch(`/api/settings/credentials/${encodeURIComponent(item.name)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        notify(locale === "zh-CN" ? "凭证删除失败" : "Failed to delete credential", "error");
        return;
      }
      setCredentials((current) => current.filter((credential) => credential.name !== item.name));
      if (editingCredentialName === item.name) clearCredentialForm();
      notify(locale === "zh-CN" ? "凭证已删除" : "Credential deleted", "success");
    } catch {
      notify(locale === "zh-CN" ? "凭证删除失败" : "Failed to delete credential", "error");
    } finally {
      setBusy("");
    }
  }

  async function copyCredentialName(item: CredentialSummary) {
    const copied = await copyText(item.name);
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function savePreviewAccessSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("preview-access");
    try {
      const response = await fetch("/api/settings/preview-access", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ requestTtlMinutes: Number(previewAccessRequestTtlMinutes) }),
      });
      if (!response.ok) {
        notify(t("settings.previewAccessSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as PreviewAccessSettings;
      setPreviewAccessSettings(settings);
      setPreviewAccessRequestTtlMinutes(String(settings.requestTtlMinutes));
      notify(t("settings.previewAccessSaved"), "success");
    } catch {
      notify(t("settings.previewAccessSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveSessionCompactionSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("session-compaction");
    const body: UpdateSessionCompactionSettingsRequest = {
      enabled: sessionCompactionEnabled,
      autoCompactMessages: Number(sessionCompactionForm.autoCompactMessages),
      autoCompactChars: Number(sessionCompactionForm.autoCompactChars),
      minNewMessages: Number(sessionCompactionForm.minNewMessages),
      minNewChars: Number(sessionCompactionForm.minNewChars),
    };
    try {
      const response = await fetch("/api/settings/session-compaction", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        notify(t("settings.sessionCompactionSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as SessionCompactionSettings;
      setSessionCompactionSettings(settings);
      setSessionCompactionEnabled(settings.enabled);
      setSessionCompactionForm({
        autoCompactMessages: String(settings.autoCompactMessages),
        autoCompactChars: String(settings.autoCompactChars),
        minNewMessages: String(settings.minNewMessages),
        minNewChars: String(settings.minNewChars),
      });
      notify(t("settings.sessionCompactionSaved"), "success");
    } catch {
      notify(t("settings.sessionCompactionSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveRateLimitSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("rate-limit");
    try {
      const response = await fetch("/api/settings/rate-limit", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          enabled: rateLimitEnabled,
          globalPerMinute: Number(rateLimitForm.globalPerMinute),
          authPerMinute: Number(rateLimitForm.authPerMinute),
          previewAccessPerMinute: Number(rateLimitForm.previewAccessPerMinute),
          expensivePerFiveMinutes: Number(rateLimitForm.expensivePerFiveMinutes),
          providerProxyPerMinute: Number(rateLimitForm.providerProxyPerMinute),
          providerProxyPerHour: Number(rateLimitForm.providerProxyPerHour),
          providerProxyMaxConcurrent: Number(rateLimitForm.providerProxyMaxConcurrent),
        }),
      });
      if (!response.ok) {
        notify(t("settings.rateLimitSaveFailed"), "error");
        return;
      }
      const settings = (await response.json()) as RateLimitSettings;
      setRateLimitSettings(settings);
      setRateLimitEnabled(settings.enabled);
      setRateLimitForm({
        globalPerMinute: String(settings.globalPerMinute),
        authPerMinute: String(settings.authPerMinute),
        previewAccessPerMinute: String(settings.previewAccessPerMinute),
        expensivePerFiveMinutes: String(settings.expensivePerFiveMinutes),
        providerProxyPerMinute: String(settings.providerProxyPerMinute),
        providerProxyPerHour: String(settings.providerProxyPerHour),
        providerProxyMaxConcurrent: String(settings.providerProxyMaxConcurrent),
      });
      notify(t("settings.rateLimitSaved"), "success");
    } catch {
      notify(t("settings.rateLimitSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveNotificationTestSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("notification-test-settings");
    try {
      const settings = await updateNotificationTestSettings(sessionToken, {
        titleZh: notificationTestForm.titleZh,
        titleEn: notificationTestForm.titleEn,
        messageZh: notificationTestForm.messageZh,
        messageEn: notificationTestForm.messageEn,
        includeHelp: notificationTestForm.includeHelp,
      });
      if (!settings) {
        notify(t("settings.notificationTestSettingsSaveFailed"), "error");
        return;
      }
      setNotificationTestSettings(settings);
      setNotificationTestForm({
        titleZh: settings.titleZh,
        titleEn: settings.titleEn,
        messageZh: settings.messageZh,
        messageEn: settings.messageEn,
        includeHelp: settings.includeHelp,
      });
      notify(t("settings.notificationTestSettingsSaved"), "success");
    } catch {
      notify(t("settings.notificationTestSettingsSaveFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function scanEnvironment() {
    setBusy("environment-scan");
    try {
      const response = await fetch("/api/settings/environment/scan", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_scan_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentScanSuccess"), "success");
    } catch {
      notify(t("settings.environmentScanFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function previewEnvironmentRestore(mode: "all" | "auto" = "auto") {
    const request: EnvironmentRestoreMissingRequest = {
      mode,
      includeTools: true,
      includePackages: true,
    };
    const response = await fetch("/api/settings/environment/restore-preview", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error("environment_restore_preview_failed");
    return (await response.json()) as EnvironmentRestorePreviewResponse;
  }

  async function restoreMissingEnvironment(mode: "all" | "auto" = "auto") {
    setBusy(`environment-restore-missing:${mode}`);
    try {
      const preview = await previewEnvironmentRestore(mode);
      if (!preview.items.length) {
        notify(t("settings.environmentRestoreMissingNothing"), "info");
        return;
      }
      const message = [
        t("settings.environmentRestoreMissingConfirm")
          .replace("{tools}", String(preview.tools))
          .replace("{packages}", String(preview.packages)),
        ...preview.items.slice(0, 5).map((item) => `- ${item.title}`),
        preview.items.length > 5 ? t("settings.environmentRestoreMissingMore").replace("{count}", String(preview.items.length - 5)) : "",
      ].filter(Boolean).join("\n");
      const confirmed = await dialog.confirm({
        title: t("settings.environmentRestoreMissing"),
        message,
        confirmLabel: t("settings.environmentRestoreMissing"),
        danger: false,
      });
      if (!confirmed) return;
      const request: EnvironmentRestoreMissingRequest = {
        mode,
        includeTools: true,
        includePackages: true,
      };
      const response = await fetch("/api/settings/environment/restore-missing", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | null;
      if (!response.ok || !result) throw new Error("environment_restore_missing_failed");
      setEnvironmentOverview(result);
      if (environmentPackagePanel) await openEnvironmentPackagePanel(environmentPackagePanel.toolRecord);
      notify(t("settings.environmentRestoreMissingDone"), "success");
    } catch {
      notify(t("settings.environmentRestoreMissingFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function installMise() {
    setBusy("environment-mise-install");
    try {
      const response = await fetch("/api/settings/environment/mise/install", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentMiseInstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify(t("settings.environmentMiseInstallSuccess"), "success");
    } catch {
      notify(t("settings.environmentMiseInstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function installEnvironmentTool(event: React.FormEvent) {
    event.preventDefault();
    setBusy("environment-install");
    try {
      const body: InstallEnvironmentToolRequest = {
        tool: environmentInstallForm.tool,
        version: environmentInstallForm.version,
        scope: environmentInstallForm.scope as InstallEnvironmentToolRequest["scope"],
        autoRestore: environmentInstallForm.autoRestore,
        notes: environmentInstallForm.notes,
      };
      const endpoint = environmentProbe?.installed ? "/api/settings/environment/tools/register" : "/api/settings/environment/tools/install";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          detectedVersion: environmentProbe?.detectedVersion ?? null,
          source: environmentProbe?.installed ? "system" : undefined,
        }),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { error?: string; detail?: string; overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentInstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify((environmentProbe?.installed ? t("settings.environmentRecordSuccess") : t("settings.environmentInstallSuccess")).replace("{tool}", environmentInstallForm.tool), "success");
    } catch {
      notify(t("settings.environmentInstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteEnvironmentToolRecord(tool: EnvironmentToolRecord) {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentToolDeleteConfirm"),
      message: `${tool.tool} ${tool.requestedVersion}\n${t("settings.environmentToolDeleteHint")}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-tool-delete:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_tool_delete_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentToolDeleted"), "success");
    } catch {
      notify(t("settings.environmentToolDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function uninstallEnvironmentTool(tool: EnvironmentToolRecord) {
    if (tool.source !== "mise") return;
    const confirmed = await dialog.confirm({
      title: t("settings.environmentToolUninstallConfirm"),
      message: `${tool.tool} ${tool.requestedVersion}\n${t("settings.environmentToolUninstallHint")}`,
      confirmLabel: t("settings.environmentToolUninstall"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-tool-uninstall:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}/uninstall`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { error?: string; overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentToolUninstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify(t("settings.environmentToolUninstalled"), "success");
    } catch {
      notify(t("settings.environmentToolUninstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function reinstallEnvironmentTool(tool: EnvironmentToolRecord) {
    if (tool.source !== "mise") return;
    const confirmed = await dialog.confirm({
      title: t("settings.environmentToolReinstallConfirm"),
      message: `${tool.tool} ${tool.requestedVersion}\n${t("settings.environmentToolReinstallHint")}`,
      confirmLabel: t("settings.environmentToolReinstall"),
    });
    if (!confirmed) return;
    setBusy(`environment-tool-reinstall:${tool.id}`);
    try {
      const body: InstallEnvironmentToolRequest = {
        tool: tool.tool,
        version: tool.requestedVersion,
        scope: tool.scope,
        autoRestore: tool.autoRestore,
        notes: tool.notes ?? "",
      };
      const response = await fetch("/api/settings/environment/tools/install", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { error?: string; detail?: string; overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentToolReinstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify(t("settings.environmentToolReinstalled").replace("{tool}", `${tool.tool}@${tool.requestedVersion}`), "success");
    } catch {
      notify(t("settings.environmentToolReinstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function setEnvironmentToolDefault(tool: EnvironmentToolRecord) {
    setBusy(`environment-tool-default:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}/set-default`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentToolSetDefaultFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      notify(t("settings.environmentToolSetDefaultSuccess").replace("{tool}", `${tool.tool}@${tool.requestedVersion}`), "success");
    } catch {
      notify(t("settings.environmentToolSetDefaultFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function openEnvironmentPackagePanel(tool: EnvironmentToolRecord) {
    setBusy(`environment-packages:${tool.id}`);
    try {
      const response = await fetch(`/api/settings/environment/tools/${tool.id}/packages`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_packages_failed");
      const detail = (await response.json()) as EnvironmentPackageDetailResponse;
      setEnvironmentPackagePanel(detail);
      setEnvironmentPackageForm({
        manager: "",
        packageName: "",
        versionSpec: "",
        notes: "",
      });
      setEnvironmentPackageProbe(null);
    } catch {
      notify(t("settings.environmentPackagesLoadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  const selectedEnvironmentPackageManager = environmentPackagePanel?.managers.find((manager) => manager.id === environmentPackageForm.manager) ?? null;
  const normalizedEnvironmentPackageName = environmentPackageForm.packageName.trim().toLowerCase();
  const environmentPackageAlreadyTracked = environmentPackagePanel?.packages.some((pkg) => pkg.manager === environmentPackageForm.manager && pkg.packageName.trim().toLowerCase() === normalizedEnvironmentPackageName) ?? false;
  const filteredEnvironmentPackages = environmentPackagePanel?.packages.filter((pkg) => {
    if (!normalizedEnvironmentPackageName) return true;
    return pkg.packageName.toLowerCase().includes(normalizedEnvironmentPackageName);
  }) ?? [];
  const environmentPackageNeedsManualCleanup = (pkg: EnvironmentPackageRecord) => pkg.manager === "go-install" || pkg.manager === "shards";

  async function probeEnvironmentPackage() {
    if (!environmentPackagePanel || !environmentPackageForm.manager || !environmentPackageForm.packageName.trim()) return;
    setBusy("environment-package-probe");
    try {
      const params = new URLSearchParams({
        manager: environmentPackageForm.manager,
        package: environmentPackageForm.packageName.trim(),
      });
      const response = await fetch(`/api/settings/environment/tools/${environmentPackagePanel.toolRecord.id}/packages/probe?${params.toString()}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_package_probe_failed");
      const probe = (await response.json()) as { installed: boolean; version?: string | null; manager: string; packageName: string };
      setEnvironmentPackageProbe({ ...probe, checked: true });
      notify(probe.installed ? t("settings.environmentPackageDetected") : t("settings.environmentPackageNotDetected"), probe.installed ? "success" : "info");
    } catch {
      notify(t("settings.environmentPackageCheckFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function runEnvironmentBulkAction(input: EnvironmentBulkActionRequest) {
    const detectedCount = input.action === "record_detected_packages"
      ? environmentPackagePanel?.packages.filter((pkg) => !pkg.persisted).length ?? 0
      : 0;
    const missingCount = input.action === "install_missing_packages"
      ? environmentPackagePanel?.packages.filter((pkg) => pkg.status === "missing").length ?? 0
      : 0;
    setBusy(`environment-bulk:${input.action}`);
    try {
      const response = await fetch("/api/settings/environment/bulk", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentPackagesLoadFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      if (environmentPackagePanel && input.toolRecordId === environmentPackagePanel.toolRecord.id) {
        await openEnvironmentPackagePanel(environmentPackagePanel.toolRecord);
      }
      if (input.action === "record_detected_packages") {
        notify(detectedCount
          ? t("settings.environmentBulkRecordDetectedDone").replace("{count}", String(detectedCount))
          : t("settings.environmentBulkRecordDetectedEmpty"), detectedCount ? "success" : "info");
      }
      if (input.action === "install_missing_packages") {
        notify(missingCount
          ? t("settings.environmentBulkInstallMissingDone").replace("{count}", String(missingCount))
          : t("settings.environmentBulkInstallMissingEmpty"), missingCount ? "success" : "info");
      }
    } catch {
      notify(t("settings.environmentPackagesLoadFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function installEnvironmentPackage(event: React.FormEvent) {
    event.preventDefault();
    if (!environmentPackagePanel) return;
    setBusy("environment-package-install");
    try {
      const response = await fetch("/api/settings/environment/packages/install", {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          toolRecordId: environmentPackagePanel.toolRecord.id,
          manager: environmentPackageForm.manager,
          packageName: environmentPackageForm.packageName,
          versionSpec: environmentPackageForm.versionSpec,
          notes: environmentPackageForm.notes,
        }),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentPackageInstallFailed"), "error");
        return;
      }
      const overview = result as EnvironmentOverview;
      setEnvironmentOverview(overview);
      await openEnvironmentPackagePanel(environmentPackagePanel.toolRecord);
      setEnvironmentPackageProbe(null);
      notify(t("settings.environmentPackageInstalled").replace("{name}", environmentPackageForm.packageName), "success");
    } catch {
      notify(t("settings.environmentPackageInstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function uninstallEnvironmentPackage(pkg: EnvironmentPackageRecord) {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentPackageUninstallConfirm"),
      message: `${pkg.packageName}\n${t("settings.environmentPackageUninstallHint")}`,
      confirmLabel: t("settings.environmentPackageUninstall"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-package-delete:${pkg.id}`);
    try {
      const response = await fetch(`/api/settings/environment/packages/${pkg.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ manager: pkg.manager }),
      });
      const result = await response.json().catch(() => null) as EnvironmentOverview | { overview?: EnvironmentOverview } | null;
      if (!response.ok) {
        if (result && "overview" in result && result.overview) setEnvironmentOverview(result.overview);
        notify(t("settings.environmentPackageUninstallFailed"), "error");
        return;
      }
      setEnvironmentOverview(result as EnvironmentOverview);
      if (environmentPackagePanel) await openEnvironmentPackagePanel(environmentPackagePanel.toolRecord);
      notify(t("settings.environmentPackageUninstalled").replace("{name}", pkg.packageName), "success");
    } catch {
      notify(t("settings.environmentPackageUninstallFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function deleteEnvironmentRestoreRun(run: EnvironmentRestoreRun) {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentRestoreDeleteConfirm"),
      message: run.summary,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy(`environment-restore-delete:${run.id}`);
    try {
      const response = await fetch(`/api/settings/environment/restore-runs/${run.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_restore_delete_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentRestoreDeleted"), "success");
    } catch {
      notify(t("settings.environmentRestoreDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function clearEnvironmentRestoreRuns() {
    const confirmed = await dialog.confirm({
      title: t("settings.environmentRestoreClearConfirm"),
      message: t("settings.environmentRestoreClearHint"),
      confirmLabel: t("settings.environmentRestoreClear"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("environment-restore-clear");
    try {
      const response = await fetch("/api/settings/environment/restore-runs", {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_restore_clear_failed");
      setEnvironmentOverview((await response.json()) as EnvironmentOverview);
      notify(t("settings.environmentRestoreCleared"), "success");
    } catch {
      notify(t("settings.environmentRestoreDeleteFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function loadEnvironmentRegistry(query = environmentToolQuery) {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/settings/environment/tool-registry${params.toString() ? `?${params}` : ""}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_registry_failed");
      const result = (await response.json()) as { items: EnvironmentToolRegistryItem[]; mise?: EnvironmentOverview["mise"] };
      setEnvironmentRegistry(result.items);
      if (result.mise && environmentOverview) {
        setEnvironmentOverview({ ...environmentOverview, mise: result.mise });
      }
    } catch {
      notify(t("settings.environmentRegistryFailed"), "error");
    }
  }

  async function loadEnvironmentVersions(tool = environmentInstallForm.tool) {
    if (!tool.trim()) {
      setEnvironmentVersions([]);
      setEnvironmentVersionHistory([]);
      setEnvironmentVersionError("");
      return;
    }
    try {
      const params = new URLSearchParams({ tool: tool.trim() });
      const response = await fetch(`/api/settings/environment/tool-versions?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_versions_failed");
      const result = (await response.json()) as { items: EnvironmentToolVersionItem[]; history?: EnvironmentToolVersionItem[]; error?: string | null; mise?: EnvironmentOverview["mise"] };
      setEnvironmentVersions(result.items);
      setEnvironmentVersionHistory(result.history ?? []);
      setEnvironmentVersionError(result.error ?? "");
      setEnvironmentShowVersionHistory(false);
      if (result.mise && environmentOverview) {
        setEnvironmentOverview({ ...environmentOverview, mise: result.mise });
      }
    } catch {
      setEnvironmentVersions([]);
      setEnvironmentVersionHistory([]);
      setEnvironmentVersionError(t("settings.environmentVersionsFailed"));
    }
  }

  async function probeEnvironmentTool(tool = environmentInstallForm.tool) {
    if (!tool.trim()) {
      setEnvironmentProbe(null);
      return;
    }
    try {
      const params = new URLSearchParams({ tool: tool.trim() });
      const response = await fetch(`/api/settings/environment/tool-probe?${params}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("environment_probe_failed");
      const result = (await response.json()) as { probe: EnvironmentToolProbe; mise?: EnvironmentOverview["mise"] };
      setEnvironmentProbe(result.probe);
      if (result.mise && environmentOverview) {
        setEnvironmentOverview({ ...environmentOverview, mise: result.mise });
      }
    } catch {
      setEnvironmentProbe(null);
    }
  }

  const visibleStorageItems = (storageScan?.items ?? [])
    .filter((item) => {
      const query = storageSearch.trim().toLowerCase();
      if (storageStatusFilter && item.status !== storageStatusFilter) return false;
      return !query || [item.label, item.type, readableStorageItemType(item.type, t), item.sessionType ? readableStorageSessionType(item.sessionType, t) : "", item.status, item.path, item.relatedId, item.relatedName, item.relatedType].some((value) => value?.toLowerCase().includes(query));
    })
    .sort((a, b) => {
      if (storageSort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      if (storageSort === "type") return a.type.localeCompare(b.type) || b.bytes - a.bytes;
      return b.bytes - a.bytes;
    });
  const visibleStorageIds = visibleStorageItems.map((item) => item.id);
  const allVisibleStorageSelected = visibleStorageIds.length > 0 && visibleStorageIds.every((id) => selectedStorageIds.includes(id));
  const activeStorageItems = storageScan?.items.filter((item) => item.status === "active") ?? [];
  const orphanStorageItems = storageScan?.items.filter((item) => item.status === "orphan") ?? [];
  const miseStatus = environmentOverview?.mise ?? null;
  const miseInstalled = miseStatus?.installed === true;
  function notificationEphemeralRuleSourceKind(rule: NotificationEphemeralRuleSummary) {
    if (rule.scopeType === "automation") return t("settings.notificationSourceAutomation");
    if (rule.scopeType === "room_task") return t("settings.notificationSourceRoomTask");
    if (rule.scopeType === "task") return t("settings.notificationSourceTask");
    return t("settings.notificationSourceSession");
  }
  function renderBackupFileList(preview: SystemBackupPreviewResponse, page: number, setPage: React.Dispatch<React.SetStateAction<number>>) {
    const total = preview.files.length;
    const pageCount = Math.max(1, Math.ceil(total / backupFilePageSize));
    const safePage = Math.min(Math.max(page, 0), pageCount - 1);
    const start = safePage * backupFilePageSize;
    const visibleFiles = preview.files.slice(start, start + backupFilePageSize);
    const end = start + visibleFiles.length;
    return (
      <>
        <div className="settings-actions">
          <span className="subtle">{t("settings.backupFilesShowing").replace("{start}", total ? String(start + 1) : "0").replace("{end}", String(end)).replace("{total}", String(total))}</span>
          <button className="ghost-button" type="button" disabled={safePage <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>{t("settings.backupFilesPrevious")}</button>
          <button className="ghost-button" type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>{t("settings.backupFilesNext")}</button>
        </div>
        <div className="storage-list">
          {visibleFiles.length ? visibleFiles.map((file) => (
            <div className="storage-item" key={file.path}>
              <div>
                <strong>{file.path}</strong>
                <span>{formatBytes(file.bytes)}{file.modifiedAt ? ` · ${formatShortDate(file.modifiedAt)}` : ""}</span>
              </div>
              <span className="pill">{t("settings.backupIncluded")}</span>
            </div>
          )) : <div className="empty-state">{t("settings.backupFilesEmpty")}</div>}
        </div>
      </>
    );
  }

  return (
    <main className="management-page">
      <PageHeader crumb={`${t("page.global")} / ${t("nav.settings")}`} title={t("page.settings")} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.settings")} />
      <Tabs className="settings-root" value={settingsTab} onValueChange={(value) => setSettingsTab(value as typeof settingsTab)}>
        <TabsList className="settings-tabs" aria-label={t("page.settings")}>
          <TabsTrigger className="settings-tab" value="account">{t("settings.tabAccount")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="runtime">{t("settings.tabRuntime")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="credentials">{locale === "zh-CN" ? "凭证" : "Credentials"}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="environment">{t("settings.tabEnvironment")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="network">{t("settings.tabNetwork")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="notifications">{t("settings.tabNotifications")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="maintenance">{t("settings.tabMaintenance")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="storage">{t("settings.tabStorage")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="backup">{t("settings.tabBackup")}</TabsTrigger>
        </TabsList>
        <TabsContent className="settings-list" value="account">
          <form className="provider-card" onSubmit={updateAccessToken}>
          <strong>{t("settings.accessTitle")}</strong>
          <span>{t("settings.accessHelp")}</span>
          <input name="currentaccesstoken" className="search-input" type="password" autoComplete="current-password" value={currentAccessToken} onChange={(event) => setCurrentAccessToken(event.target.value)} placeholder={t("settings.currentToken")} required />
          <input name="accesstoken" className="search-input" type="password" autoComplete="new-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("settings.newToken")} required />
          <input name="confirmaccesstoken" className="search-input" type="password" autoComplete="new-password" value={confirmAccessToken} onChange={(event) => setConfirmAccessToken(event.target.value)} placeholder={t("settings.confirmToken")} required />
          <div className="settings-actions">
            <button className="ghost-button" type="submit" disabled={busy === "token"}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </div>
          {tokenMessage && <span className={tokenMessage === t("settings.tokenUpdated") ? "result-ok" : "result-error"}>{tokenMessage}</span>}
          </form>
          <form className="provider-card" onSubmit={confirmOtpReset}>
          <strong>{t("settings.otpTitle")}</strong>
          <span>{t("settings.otpHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "otp"} onClick={() => void resetOtp()}><IconText icon={RefreshCw}>{t("settings.resetOtp")}</IconText></button>
          </div>
          {otpQr && <img className="otp-qr" src={otpQr} alt={t("auth.otpQrAlt")} />}
          {otpSecret && (
            <>
              <div className="secret-row">
                <code className="secret-box">{otpSecret}</code>
                <button className="ghost-button" type="button" onClick={() => void copyOtpSecret()}>{otpCopyMessage || t("action.copy")}</button>
              </div>
              <input name="otpaccesstoken" className="search-input" type="password" autoComplete="current-password" value={otpAccessToken} onChange={(event) => setOtpAccessToken(event.target.value)} placeholder={t("settings.currentToken")} required />
              <input name="otpcode" className="search-input" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} placeholder={t("settings.otpCode")} required />
              <div className="settings-actions">
                <button className="ghost-button" type="submit" disabled={busy === "otp-confirm"}><IconText icon={Save}>{t("settings.verifyOtp")}</IconText></button>
              </div>
            </>
          )}
          {otpMessage && <span className={otpMessage === t("settings.otpReset") || otpMessage === t("settings.otpGenerated") || otpMessage === t("action.copied") ? "result-ok" : "result-error"}>{otpMessage}</span>}
          </form>
          <section className="provider-card">
          <div className="api-keys-head">
            <div className="api-keys-head-copy">
              <strong>{t("settings.apiKeysTitle")}</strong>
              <span>{t("settings.apiKeysHelp")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={openCreateApiKeyEditor}><IconText icon={Plus}>{t("settings.apiKeysCreate")}</IconText></button>
          </div>
          {apiKeyMessage && <span className={apiKeyMessage === t("settings.apiKeysCreated") || apiKeyMessage === t("settings.apiKeysRevoked") || apiKeyMessage === t("settings.apiKeysUpdated") || apiKeyMessage === t("settings.apiKeysDeleteRecordDone") || apiKeyMessage === t("action.copied") ? "result-ok" : "result-error"}>{apiKeyMessage}</span>}
          <div className="storage-list">
            {!apiKeys.length && <div className="empty-state">{t("settings.apiKeysEmpty")}</div>}
            {apiKeys.map((key) => (
              <div className="storage-item" key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  <span>{key.keyPreview}</span>
                  <div className="api-key-permission-summary">
                    {(expandedApiKeyPermissions === key.id ? key.permissions : key.permissions.slice(0, 4)).map((permission) => (
                      <span className="api-key-permission-chip" key={permission}>{apiKeyPermissionLabel(t, permission)}</span>
                    ))}
                    {key.permissions.length > 4 && (
                      <button className="api-key-permission-more" type="button" onClick={() => setExpandedApiKeyPermissions((current) => current === key.id ? "" : key.id)}>
                        {expandedApiKeyPermissions === key.id ? t("action.collapse") : `+${key.permissions.length - 4}`}
                      </button>
                    )}
                  </div>
                  <span>{key.revokedAt ? `${t("settings.apiKeysStatusRevoked")} · ${formatShortDate(key.revokedAt)}` : `${t("settings.apiKeysStatusActive")} · ${t("settings.apiKeysLastUsed").replace("{time}", key.lastUsedAt ? formatShortDate(key.lastUsedAt) : t("settings.apiKeysNeverUsed"))}`}</span>
                </div>
                <div className="storage-actions">
                  <button className="ghost-button" type="button" onClick={() => openEditApiKeyEditor(key)}><IconText icon={Pencil}>{t("action.edit")}</IconText></button>
                  {!key.revokedAt && <button className="ghost-button danger-button" type="button" disabled={busy === `api-key-revoke:${key.id}`} onClick={() => void revokeApiKey(key)}>{t("settings.apiKeysRevoke")}</button>}
                  {key.revokedAt && <button className="ghost-button danger-button" type="button" disabled={busy === `api-key-delete:${key.id}`} onClick={() => void deleteRevokedApiKey(key)}><IconText icon={Trash2}>{t("settings.apiKeysDeleteRecord")}</IconText></button>}
                </div>
              </div>
            ))}
          </div>
          {apiKeyEditorOpen && (
            <div className="dialog-layer" role="presentation">
              <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={closeApiKeyEditor} />
              <form className="dialog-card api-key-editor-dialog" role="dialog" aria-modal="true" aria-label={apiKeyEditorMode === "edit" ? t("settings.apiKeysEdit") : t("settings.apiKeysCreate")} onSubmit={saveApiKey}>
                <div className="dialog-head">
                  <div>
                    <strong>{apiKeyEditorMode === "edit" ? t("settings.apiKeysEdit") : t("settings.apiKeysCreate")}</strong>
                    <p>{t("settings.apiKeysHelp")}</p>
                  </div>
                  <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={closeApiKeyEditor}><X size={16} /></button>
                </div>
                <label>
                  <span>{t("settings.apiKeysName")}</span>
                  <input name="api-key-name" value={apiKeyForm.name} onChange={(event) => setApiKeyForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("settings.apiKeysNamePlaceholder")} required />
                </label>
                <div className="api-keys-preset-row">
                  {apiKeyPresets.map((preset) => (
                    <button key={preset.id} className="ghost-button" type="button" onClick={() => applyApiKeyPreset(preset)}>{apiKeyPresetLabel(t, preset)}</button>
                  ))}
                </div>
                <div className="api-keys-groups">
                  {apiKeyGroups.map((group) => (
                    <div className="api-key-group" key={group.id}>
                      <strong>{apiKeyGroupLabel(t, group.id)}</strong>
                      <span className="subtle">{apiKeyPermissionGroupDescription(t, group)}</span>
                      <div className="api-key-group-options">
                        {group.permissions.map((permission) => (
                          <label className="checkbox-row" key={permission.id} title={apiKeyPermissionGroupTitle(t, permission)}>
                            <input name={`api-key-permission-${permission.id}`} type="checkbox" checked={apiKeyForm.permissions.includes(permission.id)} onChange={() => toggleApiKeyPermission(permission.id)} />
                            <span>{apiKeyPermissionGroupLabel(t, permission)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {createdApiKey?.key && apiKeyEditorMode === "create" && (
                  <div className="api-key-secret-card">
                    <span>{t("settings.apiKeysCreatedHint")}</span>
                    <div className="secret-row">
                      <code className="secret-box">{createdApiKey.key}</code>
                      <button className="ghost-button" type="button" onClick={() => void copyCreatedApiKey()}>{t("action.copy")}</button>
                    </div>
                  </div>
                )}
                <div className="dialog-actions">
                  <button className="ghost-button" type="button" onClick={closeApiKeyEditor}>{createdApiKey?.key && apiKeyEditorMode === "create" ? t("action.close") : t("action.cancel")}</button>
                  <button className="ghost-button" type="submit" disabled={busy === "api-key-create" || busy === "api-key-update"}>
                    <IconText icon={apiKeyEditorMode === "edit" ? Save : Plus}>{apiKeyEditorMode === "edit" ? t("action.saveChanges") : t("settings.apiKeysCreate")}</IconText>
                  </button>
                </div>
              </form>
            </div>
          )}
          </section>
          <section className="provider-card">
          <strong>{t("settings.logoutTitle")}</strong>
          <span>{t("settings.logoutHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" onClick={onLogout}>{t("settings.logout")}</button>
          </div>
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="runtime">
          <form className="provider-card" onSubmit={saveCodexRuntime}>
          <strong>{t("settings.codexRuntimeTitle")}</strong>
          <span>{t("settings.codexRuntimeHelp")}</span>
          <label>
            <span>{t("settings.sandboxMode")}</span>
            <select name="sandboxmode" className="search-input" value={sandboxMode} onChange={(event) => setSandboxMode(event.target.value as CodexSandboxMode)} disabled={bypassSandbox}>
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
              <option value="danger-full-access">danger-full-access</option>
            </select>
          </label>
          <label>
            <span>{t("settings.approvalPolicy")}</span>
            <select name="approvalpolicy" className="search-input" value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as CodexApprovalPolicy)} disabled={bypassSandbox}>
              <option value="never">never</option>
              <option value="on-request">on-request</option>
              <option value="untrusted">untrusted</option>
              <option value="on-failure">on-failure</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input name="bypasssandbox" type="checkbox" checked={bypassSandbox} onChange={(event) => setBypassSandbox(event.target.checked)} />
            <span>{t("settings.bypassSandbox")}</span>
          </label>
          <span>{t("settings.bypassSandboxHelp")}</span>
          {codexRuntime && <code>{codexRuntime.sandboxMode} · {codexRuntime.approvalPolicy} · bypass={String(codexRuntime.bypassSandbox)}</code>}
          <div className="settings-actions">
            <button className="ghost-button" type="submit" disabled={busy === "runtime"}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </div>
          </form>
          <form className="provider-card" onSubmit={saveSessionCompactionSettings}>
          <strong>{t("settings.sessionCompactionTitle")}</strong>
          <span>{t("settings.sessionCompactionHelp")}</span>
          <label className="checkbox-row">
            <input name="sessioncompactionenabled" type="checkbox" checked={sessionCompactionEnabled} onChange={(event) => setSessionCompactionEnabled(event.target.checked)} />
            <span>{t("settings.sessionCompactionEnabled")}</span>
          </label>
          {([
            ["autoCompactMessages", "sessionCompactionAutoMessages"],
            ["autoCompactChars", "sessionCompactionAutoChars"],
            ["minNewMessages", "sessionCompactionMinNewMessages"],
            ["minNewChars", "sessionCompactionMinNewChars"],
          ] as const).map(([key, labelKey]) => (
            <label key={key}>
              <span>{t(`settings.${labelKey}`)}</span>
              <input name={key} className="search-input" type="number" min="1" value={sessionCompactionForm[key]} onChange={(event) => setSessionCompactionForm((current) => ({ ...current, [key]: event.target.value }))} />
            </label>
          ))}
          {sessionCompactionSettings && <code>{sessionCompactionSettings.enabled ? "enabled" : "disabled"} · {sessionCompactionSettings.autoCompactMessages} messages / {sessionCompactionSettings.autoCompactChars} chars</code>}
          <div className="settings-actions">
            <button className="ghost-button" type="submit" disabled={busy === "session-compaction"}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </div>
          </form>
        </TabsContent>
        <TabsContent className="settings-list" value="credentials">
          <section className="provider-card">
            <div className="api-keys-head">
              <div className="api-keys-head-copy">
                <strong>{locale === "zh-CN" ? "已保存凭证" : "Saved Credentials"}</strong>
                <span>{locale === "zh-CN" ? "页面只显示掩码，真实值不会从列表接口返回。" : "The page only shows a mask; real values are not returned by the list API."}</span>
              </div>
              <div className="settings-actions">
                <span className="pill">{credentials.length}</span>
                <button className="ghost-button" type="button" onClick={openCreateCredentialEditor}><IconText icon={Plus}>{locale === "zh-CN" ? "添加凭证" : "Add credential"}</IconText></button>
              </div>
            </div>
            <div className="storage-list">
              {!credentials.length && <div className="empty-state">{locale === "zh-CN" ? "暂无凭证" : "No credentials yet"}</div>}
              {credentials.map((item) => (
                <div className="storage-item" key={item.name}>
                  <div>
                    <strong>
                      {item.name}
                      <button className="icon-button-inline" type="button" title={t("action.copy")} aria-label={t("action.copy")} onClick={() => void copyCredentialName(item)}><Copy size={14} /></button>
                    </strong>
                    <span>{item.description || (locale === "zh-CN" ? "无说明" : "No description")}</span>
                    <span>{locale === "zh-CN" ? "更新于" : "Updated"} {formatShortDate(item.updatedAt)}</span>
                  </div>
                  <div className="storage-actions">
                    <span className="pill">{item.configured ? "••••••••" : (locale === "zh-CN" ? "未配置" : "Not configured")}</span>
                    <button className="ghost-button" type="button" onClick={() => editCredential(item)}><IconText icon={Pencil}>{t("action.edit")}</IconText></button>
                    <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `credential-delete:${item.name}`} title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteCredential(item)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          {credentialEditorOpen && (
            <div className="dialog-layer" role="presentation">
              <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={clearCredentialForm} />
              <form className="dialog-card api-key-editor-dialog" role="dialog" aria-modal="true" aria-label={editingCredentialName ? (locale === "zh-CN" ? "修改凭证" : "Edit credential") : (locale === "zh-CN" ? "创建凭证" : "Create credential")} onSubmit={saveCredential}>
                <div className="dialog-head">
                  <div>
                    <strong>{editingCredentialName ? (locale === "zh-CN" ? "修改凭证" : "Edit Credential") : (locale === "zh-CN" ? "创建凭证" : "Create Credential")}</strong>
                    <p>{locale === "zh-CN" ? "保存后不会回显真实值；修改时留空 Secret 值会保留原值。" : "Values are never shown after saving; leave the secret blank while editing to keep the current value."}</p>
                  </div>
                  <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={clearCredentialForm}><X size={16} /></button>
                </div>
                <label>
                  <span>{locale === "zh-CN" ? "名称" : "Name"}</span>
                  <input
                    name="credential-name"
                    value={credentialForm.name}
                    onChange={(event) => setCredentialForm((current) => ({ ...current, name: event.target.value.toUpperCase() }))}
                    placeholder={locale === "zh-CN" ? "例如 OPENAI_API_KEY" : "e.g. OPENAI_API_KEY"}
                    disabled={Boolean(editingCredentialName)}
                    required
                  />
                </label>
                <label>
                  <span>{locale === "zh-CN" ? "说明" : "Description"}</span>
                  <input
                    name="credential-description"
                    value={credentialForm.description}
                    onChange={(event) => setCredentialForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder={locale === "zh-CN" ? "可选" : "Optional"}
                  />
                </label>
                <label>
                  <span>Secret</span>
                  <input
                    name="credential-value"
                    type="password"
                    autoComplete="new-password"
                    value={credentialForm.value}
                    onChange={(event) => setCredentialForm((current) => ({ ...current, value: event.target.value }))}
                    placeholder={editingCredentialName ? (locale === "zh-CN" ? "新的 Secret 值，留空则不修改" : "New secret value, blank keeps current") : (locale === "zh-CN" ? "Secret 值" : "Secret value")}
                    required={!editingCredentialName}
                  />
                </label>
                <div className="dialog-actions">
                  <button className="ghost-button" type="button" onClick={clearCredentialForm}>{t("action.cancel")}</button>
                  <button className="ghost-button" type="submit" disabled={busy === "credential-save"}><IconText icon={editingCredentialName ? Save : Plus}>{editingCredentialName ? t("action.saveChanges") : (locale === "zh-CN" ? "创建凭证" : "Create credential")}</IconText></button>
                </div>
              </form>
            </div>
          )}
        </TabsContent>
        <TabsContent className="settings-list" value="environment">
          <section className="settings-feature-panel">
            <div className="settings-feature-hero environment-hero">
              <div>
                <strong>{t("settings.environmentTitle")}</strong>
                <span>{t("settings.environmentHelp")}</span>
                <div className={`environment-mise-status ${miseInstalled ? "ok" : "warning"}`}>
                  <span className={`pill ${miseInstalled ? "" : "warm"}`}>{miseInstalled ? t("settings.environmentMiseReady") : t("settings.environmentMiseMissing")}</span>
                  <span>
                    {miseInstalled
                      ? t("settings.environmentMiseVersion").replace("{version}", miseStatus?.version ?? t("settings.environmentMissingVersion"))
                      : t("settings.environmentMiseMissingHelp")}
                  </span>
                </div>
              </div>
              <div className="settings-actions">
                {!miseInstalled && (
                  <button className="ghost-button" type="button" disabled={busy === "environment-mise-install"} onClick={() => void installMise()}>
                    <IconText icon={Download}>{busy === "environment-mise-install" ? t("settings.environmentMiseInstalling") : t("settings.environmentMiseInstall")}</IconText>
                  </button>
                )}
                <button className="ghost-button" type="button" disabled={busy === "environment-scan"} onClick={() => void scanEnvironment()}><IconText icon={RefreshCw}>{t("settings.environmentScan")}</IconText></button>
              </div>
            </div>
            <div className="environment-layout">
              <form className="provider-card environment-install-card" onSubmit={installEnvironmentTool}>
                <div className="environment-card-head">
                  <div>
                    <strong>{t("settings.environmentInstall")}</strong>
                    <span>{t("settings.environmentInstallHelp")}</span>
                  </div>
                </div>
                <div className="environment-install-grid">
                  <label>
                    <span>{t("settings.environmentToolName")}</span>
                    <div className="environment-tool-picker">
                      <input
                        name="environment-tool"
                        className="search-input"
                        value={environmentToolQuery || environmentInstallForm.tool}
                        onFocus={() => {
                          setEnvironmentToolPickerOpen(false);
                        }}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEnvironmentToolQuery(value);
                          setEnvironmentInstallForm((current) => ({ ...current, tool: value }));
                          setEnvironmentToolPickerOpen(false);
                        }}
                        placeholder={t("settings.environmentToolPlaceholder")}
                        required
                      />
                      <button
                        className="environment-tool-search"
                        type="button"
                        onClick={() => {
                          setEnvironmentToolPickerOpen(true);
                          void loadEnvironmentRegistry(environmentToolQuery || environmentInstallForm.tool);
                        }}
                      >
                        {t("settings.environmentSearchTools")}
                      </button>
                      {environmentToolPickerOpen && (
                        <div className="environment-tool-menu">
                          {environmentRegistry.length ? environmentRegistry.slice(0, 12).map((item) => (
                            <button
                              className="environment-tool-option"
                              type="button"
                              key={item.name}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setEnvironmentInstallForm((current) => ({ ...current, tool: item.name }));
                                setEnvironmentToolQuery(item.name);
                                setEnvironmentToolPickerOpen(false);
                                setEnvironmentVersionPickerOpen(true);
                                void loadEnvironmentVersions(item.name);
                                void probeEnvironmentTool(item.name);
                              }}
                            >
                              <strong>{item.name}</strong>
                              {item.description && <span>{item.description}</span>}
                            </button>
                          )) : <div className="environment-tool-empty">{t("settings.environmentRegistryEmpty")}</div>}
                        </div>
                      )}
                    </div>
                  </label>
                  <label>
                    <span>{t("settings.environmentToolVersion")}</span>
                    <div className="environment-tool-picker">
                      <input
                        name="environment-version"
                        className="search-input"
                        value={environmentInstallForm.version}
                        onFocus={() => {
                          setEnvironmentVersionPickerOpen(false);
                        }}
                        onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, version: event.target.value }))}
                        placeholder={t("settings.environmentVersionPlaceholder")}
                        required
                      />
                      <button
                        className="environment-tool-search"
                        type="button"
                        disabled={!environmentInstallForm.tool.trim()}
                        onClick={() => {
                          setEnvironmentVersionPickerOpen(true);
                          void loadEnvironmentVersions();
                        }}
                      >
                        {t("settings.environmentLoadVersions")}
                      </button>
                      {environmentVersionPickerOpen && (
                        <div className="environment-tool-menu">
                          {environmentVersions.length ? (
                            <>
                              {environmentVersions.map((item) => (
                                <button
                                  className="environment-tool-option"
                                  type="button"
                                  key={item.version}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    setEnvironmentInstallForm((current) => ({ ...current, version: item.version }));
                                    setEnvironmentVersionPickerOpen(false);
                                  }}
                                >
                                  <strong>{item.version}</strong>
                                  {item.recommended && <span>{t("settings.environmentRecommendedVersion")}</span>}
                                </button>
                              ))}
                              {Boolean(environmentVersionHistory.length) && (
                                <>
                                  <button
                                    className="environment-tool-more"
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => setEnvironmentShowVersionHistory((current) => !current)}
                                  >
                                    {environmentShowVersionHistory ? t("settings.environmentHideHistory") : t("settings.environmentShowHistory")}
                                  </button>
                                  {environmentShowVersionHistory && environmentVersionHistory.map((item) => (
                                    <button
                                      className="environment-tool-option"
                                      type="button"
                                      key={`history-${item.version}`}
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => {
                                        setEnvironmentInstallForm((current) => ({ ...current, version: item.version }));
                                        setEnvironmentVersionPickerOpen(false);
                                      }}
                                    >
                                      <strong>{item.version}</strong>
                                    </button>
                                  ))}
                                </>
                              )}
                            </>
                          ) : <div className="environment-tool-empty">{environmentVersionError || t("settings.environmentVersionEmpty")}</div>}
                        </div>
                      )}
                    </div>
                  </label>
                  <label>
                    <span>{t("settings.environmentScope")}</span>
                    <select name="environment-scope" className="search-input" value={environmentInstallForm.scope} onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, scope: event.target.value }))}>
                      <option value="global">{t("settings.environmentScopeGlobal")}</option>
                      <option value="workspace">{t("settings.environmentScopeWorkspace")}</option>
                      <option value="room">{t("settings.environmentScopeRoom")}</option>
                      <option value="session">{t("settings.environmentScopeSession")}</option>
                    </select>
                  </label>
                  <label>
                    <span>{t("settings.environmentNotes")}</span>
                    <input name="environment-notes" className="search-input" value={environmentInstallForm.notes} onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("settings.environmentNotesPlaceholder")} />
                  </label>
                </div>
                {environmentProbe?.tool === environmentInstallForm.tool && (
                  <div className={`environment-detected-status ${environmentProbe.installed ? "ok" : "warning"}`}>
                    <span className={`pill ${environmentProbe.installed ? "" : "warm"}`}>
                      {environmentProbe.installed ? t("settings.environmentDetectedInstalled") : t("settings.environmentDetectedMissing")}
                    </span>
                    <span>
                      {environmentProbe.installed
                        ? t("settings.environmentDetectedVersion").replace("{version}", environmentProbe.detectedVersion ?? t("settings.environmentMissingVersion"))
                        : t("settings.environmentDetectedMissingHelp")}
                    </span>
                  </div>
                )}
                <label className="checkbox-row environment-inline-toggle">
                  <input name="environment-auto-restore" type="checkbox" checked={environmentInstallForm.autoRestore} onChange={(event) => setEnvironmentInstallForm((current) => ({ ...current, autoRestore: event.target.checked }))} />
                  <span>{t("settings.environmentAutoRestore")}</span>
                </label>
                <div className="settings-actions environment-actions">
                  <button className="ghost-button" type="submit" disabled={busy === "environment-install"}>
                    <IconText icon={busy === "environment-install" ? RefreshCw : Plus}>
                      {busy === "environment-install"
                        ? (environmentProbe?.installed ? t("settings.environmentRecording") : t("settings.environmentInstalling"))
                        : (environmentProbe?.installed ? t("settings.environmentRecord") : t("settings.environmentInstall"))}
                    </IconText>
                  </button>
                </div>
              </form>
              <div className="environment-summary-grid">
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentReconcileTitle")}</strong>
                      <span>{t("settings.environmentReconcileHelp")}</span>
                    </div>
                    <div className="provider-card-actions">
                      <span className="pill">{environmentReconcileItems.length}</span>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busy === "environment-scan" || environmentRestoreBusy || (!environmentMissingToolCount && !environmentMissingPackageCount)}
                        onClick={() => void restoreMissingEnvironment("auto")}
                      >
                        <IconText icon={RotateCcw}>{environmentRestoreBusy ? t("settings.environmentRestoringMissing") : t("settings.environmentRestoreMissing")}</IconText>
                      </button>
                    </div>
                  </div>
                  {!environmentReconcileItems.length && <div className="empty-state">{t("settings.environmentEmptyReconcile")}</div>}
                  {Boolean(environmentMissingToolCount || environmentMissingPackageCount) && (
                    <div className="environment-reconcile-banner">
                      <span>{t("settings.environmentRestoreMissingHint").replace("{tools}", String(environmentMissingToolCount)).replace("{packages}", String(environmentMissingPackageCount))}</span>
                    </div>
                  )}
                  {environmentRestoreBusy && (
                    <div className="environment-reconcile-banner running">
                      <span>{t("settings.environmentRestoreRunningHint")}</span>
                    </div>
                  )}
                  {Boolean(environmentReconcileItems.length) && (
                    <div className="environment-list">
                      {environmentReconcileItems.map((item) => (
                        <article className="environment-item" key={item.id}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{item.title}</strong>
                              <span className="pill warm">{item.status}</span>
                            </div>
                            <span>{item.detail}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentTrackedTools")}</strong>
                      <span>{t("settings.environmentTrackedToolsHelp")}</span>
                    </div>
                    <span className="pill">{environmentOverview?.tools.length ?? 0}</span>
                  </div>
                  {!environmentOverview?.tools.length && <div className="empty-state">{t("settings.environmentEmpty")}</div>}
                  {Boolean(environmentOverview?.tools.length) && (
                    <div className="environment-list">
                      {environmentOverview?.tools.map((tool) => (
                        <article className="environment-item" key={tool.id}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{tool.tool}</strong>
                              <div className="provider-card-actions">
                                {tool.isGlobalDefault && <span className="pill">{t("settings.environmentGlobalDefault")}</span>}
                                <span className={`pill ${tool.status === "installed" ? "" : "warm"}`}>{tool.status}</span>
                              </div>
                            </div>
                            <span>{tool.requestedVersion} · {tool.detectedVersion ?? t("settings.environmentMissingVersion")}</span>
                            <span>{tool.scope} · {tool.source} · {tool.autoRestore ? t("settings.environmentAutoRestoreOn") : t("settings.environmentAutoRestoreOff")}</span>
                            {tool.notes && <span>{tool.notes}</span>}
                          </div>
                          <div className="storage-actions">
                            {!tool.isGlobalDefault && (
                              <button className="ghost-button icon-only" type="button" disabled={busy === `environment-tool-default:${tool.id}`} title={t("settings.environmentSetGlobalDefault")} aria-label={t("settings.environmentSetGlobalDefault")} onClick={() => void setEnvironmentToolDefault(tool)}><IconText icon={Check}>{t("settings.environmentSetGlobalDefault")}</IconText></button>
                            )}
                            <button className="ghost-button icon-only" type="button" disabled={busy === `environment-packages:${tool.id}`} title={t("settings.environmentPackageManage")} aria-label={t("settings.environmentPackageManage")} onClick={() => void openEnvironmentPackagePanel(tool)}><IconText icon={Boxes}>{t("settings.environmentPackageManage")}</IconText></button>
                            {tool.source === "mise" && (
                              <>
                                <button className="ghost-button icon-only" type="button" disabled={busy === `environment-tool-reinstall:${tool.id}`} title={t("settings.environmentToolReinstall")} aria-label={t("settings.environmentToolReinstall")} onClick={() => void reinstallEnvironmentTool(tool)}><IconText icon={RefreshCw}>{t("settings.environmentToolReinstall")}</IconText></button>
                                <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-tool-uninstall:${tool.id}`} title={t("settings.environmentToolUninstall")} aria-label={t("settings.environmentToolUninstall")} onClick={() => void uninstallEnvironmentTool(tool)}><IconText icon={PackageX}>{t("settings.environmentToolUninstall")}</IconText></button>
                              </>
                            )}
                            <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-tool-delete:${tool.id}`} title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteEnvironmentToolRecord(tool)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentProjectUsageTitle")}</strong>
                      <span>{t("settings.environmentProjectUsageHelp")}</span>
                    </div>
                    <span className="pill">{environmentProjectUsageItems.length}</span>
                  </div>
                  {!environmentProjectUsageItems.length && <div className="empty-state">{t("settings.environmentEmptyProjectUsage")}</div>}
                  {Boolean(environmentProjectUsageItems.length) && (
                    <div className="environment-list">
                      {environmentProjectUsageItems.map((item) => (
                        <article className="environment-item" key={item.projectId}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{item.projectName}</strong>
                              <span className="pill">{item.matchedTools.join(", ")}</span>
                            </div>
                            <span>{item.workspacePath}</span>
                            <span>{item.detectedFiles.join(" · ")}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section className="provider-card environment-summary-card">
                  <div className="environment-card-head">
                    <div>
                      <strong>{t("settings.environmentRestoreHistory")}</strong>
                      <span>{t("settings.environmentRestoreHistoryHelp")}</span>
                    </div>
                    <div className="provider-card-actions">
                      <span className="pill">{environmentOverview?.restoreRuns.length ?? 0}</span>
                      <button className="ghost-button danger-button" type="button" disabled={busy === "environment-bulk:cleanup_stale_records"} onClick={() => void runEnvironmentBulkAction({ action: "cleanup_stale_records" })}>{t("settings.environmentBulkCleanupStale")}</button>
                      <button className="ghost-button danger-button" type="button" disabled={busy === "environment-restore-clear" || !(environmentOverview?.restoreRuns.length ?? 0)} onClick={() => void clearEnvironmentRestoreRuns()}>{t("settings.environmentRestoreClear")}</button>
                    </div>
                  </div>
                  {!environmentOverview?.restoreRuns.length && <div className="empty-state">{t("settings.environmentRestoreEmpty")}</div>}
                  {Boolean(environmentOverview?.restoreRuns.length) && (
                    <div className="environment-list">
                      {environmentOverview?.restoreRuns.map((run) => (
                        <article className="environment-item" key={run.id}>
                          <div className="environment-item-main">
                            <div className="environment-item-head">
                              <strong>{run.summary}</strong>
                              <span className={`pill ${run.status === "success" ? "" : "warm"}`}>{run.status}</span>
                            </div>
                            <span>{formatShortDate(run.createdAt)}</span>
                          </div>
                          <div className="storage-actions">
                            <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-restore-delete:${run.id}`} title={t("action.delete")} aria-label={t("action.delete")} onClick={() => void deleteEnvironmentRestoreRun(run)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="network">
          <form className="provider-card" onSubmit={savePreviewAccessSettings}>
            <strong>{t("settings.previewAccessTitle")}</strong>
            <span>{t("settings.previewAccessHelp")}</span>
            <label>
              <span>{t("settings.previewAccessRequestTtl")}</span>
              <input name="previewaccessttl" className="search-input" type="number" min="1" max="1440" value={previewAccessRequestTtlMinutes} onChange={(event) => setPreviewAccessRequestTtlMinutes(event.target.value)} />
            </label>
            {previewAccessSettings && <code>{t("settings.previewAccessCurrent").replace("{minutes}", String(previewAccessSettings.requestTtlMinutes))}</code>}
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "preview-access"}><IconText icon={Save}>{t("action.save")}</IconText></button>
            </div>
          </form>
          <form className="provider-card" onSubmit={saveRateLimitSettings}>
            <strong>{t("settings.rateLimitTitle")}</strong>
            <span>{t("settings.rateLimitHelp")}</span>
            <label className="checkbox-row">
              <input name="ratelimitenabled" type="checkbox" checked={rateLimitEnabled} onChange={(event) => setRateLimitEnabled(event.target.checked)} />
              <span>{t("settings.rateLimitEnabled")}</span>
            </label>
            {([
              ["globalPerMinute", "rateLimitGlobalPerMinute"],
              ["authPerMinute", "rateLimitAuthPerMinute"],
              ["previewAccessPerMinute", "rateLimitPreviewAccessPerMinute"],
              ["expensivePerFiveMinutes", "rateLimitExpensivePerFiveMinutes"],
              ["providerProxyPerMinute", "rateLimitProviderProxyPerMinute"],
              ["providerProxyPerHour", "rateLimitProviderProxyPerHour"],
              ["providerProxyMaxConcurrent", "rateLimitProviderProxyMaxConcurrent"],
            ] as const).map(([key, labelKey]) => (
              <label key={key}>
                <span>{t(`settings.${labelKey}`)}</span>
                <input name={key} className="search-input" type="number" min="1" value={rateLimitForm[key]} onChange={(event) => setRateLimitForm((current) => ({ ...current, [key]: event.target.value }))} />
              </label>
            ))}
            {rateLimitSettings && <code>{rateLimitSettings.enabled ? "enabled" : "disabled"} · global={rateLimitSettings.globalPerMinute}/min</code>}
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "rate-limit"}><IconText icon={Save}>{t("action.save")}</IconText></button>
            </div>
          </form>
        </TabsContent>
        <TabsContent className="settings-list" value="notifications">
          <div className="settings-tabs notification-inner-tabs">
            {(["platforms", "senders", "recipients", "rules", "logs"] as const).map((view) => (
              <button className={`settings-tab ${notificationView === view ? "active" : ""}`} type="button" key={view} onClick={() => setNotificationView(view)}>
                {t(`settings.notificationTab${view === "platforms" ? "Platforms" : view === "senders" ? "Senders" : view === "recipients" ? "Recipients" : view === "rules" ? "Rules" : "Logs"}`)}
              </button>
            ))}
          </div>
          {notificationView === "platforms" && <NotificationPlatformsPanel platformSettings={platformSettings} t={t} />}
          {notificationView === "senders" && (
            <>
          <NotificationTestSettingsCard
            busy={busy === "notification-test-settings"}
            collapsed={notificationTestSettingsCollapsed}
            form={notificationTestForm}
            settings={notificationTestSettings}
            t={t}
            onSubmit={saveNotificationTestSettings}
            setCollapsed={setNotificationTestSettingsCollapsed}
            setForm={setNotificationTestForm}
          />
          {notificationAccountEditorOpen && (
            <NotificationAccountEditorDialog
              busy={busy}
              editingAccountId={notificationEditingAccountId}
              form={notificationAccountForm}
              sessionToken={sessionToken}
              t={t}
              kindLabel={notificationChannelKindLabel}
              loadNotifications={loadNotifications}
              onClose={resetNotificationAccountForm}
              onSubmit={createNotificationAccount}
              setForm={setNotificationAccountForm}
            />
          )}
          <NotificationAccountList
            accounts={notificationSettings?.accounts ?? []}
            busy={busy}
            t={t}
            accountKindLabel={(account) => notificationChannelKindLabel(resolveNotificationAccountKind(account, notificationSettings?.channels))}
            permissionSummary={(permissions) => notificationPermissionSummaryText(t, permissions)}
            onAdd={() => { resetNotificationAccountForm(); setNotificationAccountEditorOpen(true); }}
            onCustomTest={(account) => {
              setNotificationCustomTestAccount(account);
              setNotificationCustomTestForm({ title: "", message: "", includeHelp: true });
            }}
            onDelete={(account) => void deleteNotificationAccount(account)}
            onEdit={editNotificationAccount}
            onTest={(account) => void testNotificationAccount(account)}
          />
            </>
          )}
          {notificationView === "recipients" && (
            <>
          {notificationRecipientEditorOpen && (
            <NotificationRecipientEditorDialog
              busy={busy}
              editingRecipientId={notificationEditingRecipientId}
              form={notificationRecipientForm}
              notificationSettings={notificationSettings}
              t={t}
              kindLabel={notificationChannelKindLabel}
              onClose={resetNotificationRecipientForm}
              onManageChannels={() => setNotificationChannelManagerOpen(true)}
              onSubmit={createNotificationRecipient}
              setForm={setNotificationRecipientForm}
              accounts={notificationSettings?.accounts ?? []}
            />
          )}
          <NotificationRecipientList
            busy={busy}
            recipients={notificationSettings?.recipients ?? []}
            t={t}
            kindLabel={notificationChannelKindLabel}
            permissionSummary={(permissions) => notificationPermissionSummaryText(t, permissions)}
            onAdd={() => { resetNotificationRecipientForm(); setNotificationRecipientEditorOpen(true); }}
            onDelete={(recipient) => void deleteNotificationRecipient(recipient)}
            onEdit={editNotificationRecipient}
            onTest={(recipient) => void testNotificationRecipient(recipient)}
          />
            </>
          )}
          {notificationView === "rules" && (
            <>
          <form className="notification-card" onSubmit={createNotificationRule}>
            <strong>{t("settings.notificationRulesTitle")}</strong>
            <span>{t("settings.notificationRulesHelp")}</span>
            <label>
              <span>{t("settings.notificationRuleName")}</span>
              <input name="notification-rule-name" className="search-input" value={notificationRuleForm.name} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="checkbox-row">
              <input name="notification-rule-enabled" type="checkbox" checked={notificationRuleForm.enabled} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>{t("settings.notificationEnabled")}</span>
            </label>
            <label>
              <span>{t("settings.notificationEvents")}</span>
              <div className="notification-check-grid">
                {(["task_completed", "task_failed", "task_interrupted", "needs_approval", "task_health_issue", "provider_check_failed", "backup_failed", "restore_failed", "auth_login"] as NotificationEventType[]).map((type) => (
                  <label className="checkbox-row" key={type}>
                    <input name={`notification-rule-event-${type}`} type="checkbox" checked={notificationRuleForm.eventTypes.includes(type)} onChange={() => toggleNotificationEvent(type)} />
                    <span>{readableNotificationEvent(type, t)}</span>
                  </label>
                ))}
              </div>
            </label>
            <label>
              <span>{t("settings.notificationMinSeverity")}</span>
              <select name="notification-rule-min-severity" className="search-input" value={notificationRuleForm.minSeverity} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, minSeverity: event.target.value as NotificationSeverity }))}>
                {(["info", "success", "warning", "error"] as NotificationSeverity[]).map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </label>
            {getNotificationSenderAccountsForKind(notificationSettings?.accounts ?? [], "email").length > 1 && (
              <label>
                <span>{t("settings.notificationEmailSenderOverride")}</span>
                <select name="notification-rule-email-sender-override" className="search-input" value={notificationRuleForm.senderAccountId} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, senderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationUseRecipientDefaultSender")}</option>
                  {getNotificationSenderAccountsForKind(notificationSettings?.accounts ?? [], "email").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            )}
            {getNotificationSenderAccountsForKind(notificationSettings?.accounts ?? [], "telegram").length > 1 && (
              <label>
                <span>{t("settings.notificationTelegramSenderOverride")}</span>
                <select name="notification-rule-telegram-sender-override" className="search-input" value={notificationRuleForm.telegramSenderAccountId} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, telegramSenderAccountId: event.target.value }))}>
                  <option value="">{t("settings.notificationUseRecipientDefaultSender")}</option>
                  {getNotificationSenderAccountsForKind(notificationSettings?.accounts ?? [], "telegram").map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>{t("settings.notificationTargets")}</span>
              <div className="notification-check-grid">
                {(notificationSettings?.recipients ?? []).map((recipient) => (
                  <label className="checkbox-row" key={recipient.id}>
                    <input name={`notification-rule-recipient-${recipient.id}`} type="checkbox" checked={notificationRuleForm.recipientIds.includes(recipient.id)} onChange={() => toggleNotificationTarget(recipient.id)} />
                    <span>{recipient.name} · {notificationChannelKindLabel(recipient.kind)}</span>
                  </label>
                ))}
              </div>
              {notificationSettings && !notificationSettings.recipients.length && <span className="subtle">{t("settings.notificationNoRecipients")}</span>}
            </label>
            <label>
              <span>{t("settings.notificationDedupeMinutes")}</span>
              <input name="notification-dedupe" className="search-input" type="number" min="0" value={notificationRuleForm.dedupeMinutes} onChange={(event) => setNotificationRuleForm((current) => ({ ...current, dedupeMinutes: event.target.value }))} />
            </label>
            <div className="settings-actions">
              <button className="ghost-button" type="submit" disabled={busy === "notification-rule"}><IconText icon={notificationEditingRuleId ? Save : Plus}>{notificationEditingRuleId ? t("action.saveChanges") : t("settings.notificationAddRule")}</IconText></button>
              {notificationEditingRuleId && <button className="ghost-button" type="button" onClick={resetNotificationRuleForm}>{t("action.cancel")}</button>}
            </div>
          </form>
          <section className="notification-card">
            <div className="item-row">
              <strong>{t("settings.notificationRuleList")}</strong>
              <button className="ghost-button danger-button" type="button" disabled={busy === "notification-rules-clear" || !((notificationSettings?.rules.length ?? 0) + (notificationSettings?.ephemeralRules.length ?? 0))} onClick={() => void clearNotificationRules()}><IconText icon={Trash2}>{t("settings.notificationClearRules")}</IconText></button>
            </div>
            {(notificationSettings?.rules ?? []).map((rule) => (
              <div className="storage-item" key={rule.id}>
                <div>
                  <strong>{rule.name}</strong>
                  <span>{rule.enabled ? "enabled" : "disabled"} · {rule.eventTypes.join(", ")} · {rule.targets.length} targets</span>
                </div>
                <div className="storage-actions">
                  <button className="ghost-button" type="button" onClick={() => editNotificationRule(rule)}>{t("action.edit")}</button>
                  <button className="ghost-button" type="button" onClick={() => void toggleNotificationRule(rule)}>{rule.enabled ? t("automation.pause") : t("automation.resume")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteNotificationRule(rule)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {notificationSettings && !notificationSettings.rules.length && <div className="empty-state">{t("settings.notificationNoRules")}</div>}
            {notificationRuleCursor && (
              <div className="settings-actions">
                <button className="ghost-button" type="button" disabled={notificationRuleLoading} onClick={() => void loadMoreNotificationRules()}>{t("session.loadMore")}</button>
              </div>
            )}
          </section>
          <section className="notification-card">
            <strong>{t("settings.notificationEphemeralRuleList")}</strong>
            {(notificationSettings?.ephemeralRules ?? []).map((rule: NotificationEphemeralRuleSummary) => (
              <div className="storage-item" key={rule.id}>
                <div>
                  <strong>{t("settings.notificationRuleSource")}: {notificationEphemeralRuleSourceKind(rule)} · {rule.source?.exists === false ? t("settings.notificationSourceMissing") : rule.source?.label ?? rule.scopeId}</strong>
                  <span>{[
                    rule.source?.detail,
                    rule.scopeId,
                  ].filter(Boolean).join(" · ")}</span>
                  <span>{rule.enabled ? t("settings.notificationRuleEnabled") : t("settings.notificationRuleDisabled")} · {rule.eventTypes.map((type) => readableNotificationEvent(type, t)).join(", ")} · {rule.targets.map((target) => notificationSettings?.recipients.find((recipient) => recipient.id === target.recipientId)?.name ?? target.recipientId ?? target.accountId).filter(Boolean).join(", ")}</span>
                  <span>{rule.expireMode} · {formatShortDate(rule.createdAt)}{rule.triggeredAt ? ` · triggered ${formatShortDate(rule.triggeredAt)}` : ""}</span>
                </div>
                <div className="storage-actions">
                  <button className="ghost-button danger-button" type="button" disabled={busy === `notification-ephemeral-rule-delete:${rule.id}`} onClick={() => void deleteNotificationEphemeralRule(rule)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {notificationSettings && !notificationSettings.ephemeralRules.length && <div className="empty-state">{t("settings.notificationNoEphemeralRules")}</div>}
            {notificationEphemeralRuleCursor && (
              <div className="settings-actions">
                <button className="ghost-button" type="button" disabled={notificationEphemeralRuleLoading} onClick={() => void loadMoreNotificationEphemeralRules()}>{t("session.loadMore")}</button>
              </div>
            )}
          </section>
            </>
          )}
          {notificationView === "logs" && (
          <section className="notification-card">
            <div className="item-row">
              <strong>{t("settings.notificationDeliveriesTitle")}</strong>
              <button className="ghost-button danger-button" type="button" disabled={busy === "notification-deliveries-clear" || !(notificationSettings?.recentDeliveries.length ?? 0)} onClick={() => void clearNotificationDeliveries()}><IconText icon={Trash2}>{t("settings.notificationClearDeliveries")}</IconText></button>
            </div>
            <div className="filter-toolbar compact-filter-toolbar">
              <select name="notification-delivery-event-filter" className="filter-select" value={notificationDeliveryEventFilter} onChange={(event) => setNotificationDeliveryEventFilter(event.target.value)}>
                <option value="">{t("settings.notificationEvents")}</option>
                {(["task_completed", "task_failed", "task_interrupted", "needs_approval", "task_health_issue", "provider_check_failed", "backup_failed", "restore_failed", "auth_login"] as NotificationEventType[]).map((type) => (
                  <option key={type} value={type}>{readableNotificationEvent(type, t)}</option>
                ))}
              </select>
              <select name="notification-delivery-status-filter" className="filter-select" value={notificationDeliveryStatusFilter} onChange={(event) => setNotificationDeliveryStatusFilter(event.target.value)}>
                <option value="">{t("session.allStatuses")}</option>
                {(["pending", "sent", "failed", "skipped"] as NotificationDeliverySummary["status"][]).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <select name="notification-delivery-severity-filter" className="filter-select" value={notificationDeliverySeverityFilter} onChange={(event) => setNotificationDeliverySeverityFilter(event.target.value)}>
                <option value="">{t("settings.notificationMinSeverity")}</option>
                {(["info", "success", "warning", "error"] as NotificationSeverity[]).map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </div>
            {(notificationSettings?.recentDeliveries ?? []).map((delivery: NotificationDeliverySummary) => {
              const detail = notificationDeliveryMetadata(delivery);
              return (
              <div className="storage-item notification-delivery-item" key={delivery.id}>
                <div>
                  <strong>{delivery.title}</strong>
                  <span>{delivery.eventType} · {delivery.severity} · {delivery.status} · {formatShortDate(delivery.createdAt)}</span>
                  <span>{delivery.message}</span>
                  <div className="notification-delivery-details">
                    <span>{t("settings.notificationDeliveryTarget")}：{detail.targetName} · {detail.targetKind}</span>
                    <span>{t("settings.notificationDeliverySender")}：{detail.accountName}</span>
                    <span>{t("settings.notificationDeliveryAttempts")}：{detail.attempts}</span>
                    <span>{t("settings.notificationDeliveryResponse")}：{detail.responseStatus}</span>
                    <span>{t("settings.notificationDeliverySentAt")}：{detail.sentAt}</span>
                    {detail.emailToCount > 0 && <span>{t("settings.notificationDeliveryEmailCount")}：{detail.emailToCount}</span>}
                    {detail.chatConfigured && <span>{t("settings.notificationDeliveryChatConfigured")}</span>}
                  </div>
                  {delivery.lastError && <span className="result-error">{delivery.lastError}</span>}
                </div>
                <div className="storage-actions">
                  {delivery.status === "failed" && (
                    <button className="ghost-button" type="button" disabled={busy === `notification-delivery-retry:${delivery.id}`} onClick={() => void retryNotificationDelivery(delivery)}>
                      <IconText icon={RefreshCw}>{t("settings.notificationRetry")}</IconText>
                    </button>
                  )}
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteNotificationDelivery(delivery)}>{t("action.delete")}</button>
                </div>
              </div>
              );
            })}
            {notificationSettings && !notificationSettings.recentDeliveries.length && <div className="empty-state">{t("settings.notificationNoDeliveries")}</div>}
            {notificationDeliveryCursor && (
              <div className="settings-actions">
                <button className="ghost-button" type="button" disabled={notificationDeliveryLoading} onClick={() => void loadMoreNotificationDeliveries()}>{t("session.loadMore")}</button>
              </div>
            )}
          </section>
          )}
        </TabsContent>
        <TabsContent className="settings-list" value="maintenance">
          <section className="provider-card">
          <strong>{t("settings.maintenanceTitle")}</strong>
          <span>{t("settings.maintenanceHelp")}</span>
          <label className="checkbox-row">
            <input name="cleanuparchivedapprovals" type="checkbox" checked={cleanupArchivedApprovals} onChange={(event) => setCleanupArchivedApprovals(event.target.checked)} />
            <span>{t("settings.cleanupArchivedApprovals")}</span>
          </label>
          <label>
            <span>{t("settings.cleanupArchivedApprovalDays")}</span>
            <input name="cleanuparchivedapprovaldays" className="search-input" type="number" min={0} max={3650} value={cleanupArchivedApprovalDays} onChange={(event) => setCleanupArchivedApprovalDays(Number(event.target.value))} disabled={!cleanupArchivedApprovals} />
          </label>
          <label className="checkbox-row">
            <input name="cleanupapprovalauditlog" type="checkbox" checked={cleanupApprovalAuditLog} onChange={(event) => setCleanupApprovalAuditLog(event.target.checked)} />
            <span>{t("settings.cleanupApprovalAuditLog")}</span>
          </label>
          <span>{t("settings.cleanupApprovalAuditLogHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "cleanup"} onClick={() => void cleanupMaintenance()}><IconText icon={Trash2}>{t("settings.cleanupDatabase")}</IconText></button>
            <button className="ghost-button" type="button" disabled={busy === "approval-reset"} onClick={() => void resetApprovals()}><IconText icon={ShieldCheck}>{t("settings.resetApprovals")}</IconText></button>
          </div>
          {cleanupMessage && <span className={cleanupMessage === t("settings.cleanupFailed") || cleanupMessage === t("settings.resetApprovalsFailed") ? "result-error" : "result-ok"}>{cleanupMessage}</span>}
          </section>
          <section className="provider-card">
          <strong>{t("settings.taskHealthTitle")}</strong>
          <span>{t("settings.taskHealthHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "task-health"} onClick={() => void loadTaskHealth()}><IconText icon={Activity}>{t("settings.checkTaskHealth")}</IconText></button>
            <button className="ghost-button danger-button" type="button" disabled={busy === "task-health-repair" || !taskHealth?.items.some((item) => item.issue)} onClick={() => void repairTaskHealth()}><IconText icon={RefreshCw}>{t("settings.repairTaskHealth")}</IconText></button>
            {taskHealth && <span className={taskHealth.ok ? "result-ok" : "result-error"}>{taskHealth.ok ? t("settings.taskHealthOk") : t("settings.taskHealthIssues")}</span>}
          </div>
          {taskHealth && !taskHealth.items.length && <div className="empty-state">{t("settings.taskHealthEmpty")}</div>}
          {taskHealth && taskHealth.items.length > 0 && (
            <div className="storage-list">
              {taskHealth.items.map((item) => (
                <div className="storage-item" key={`${item.sessionId}:${item.runId ?? ""}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.sessionId}</span>
                    <span>runner {item.pid ?? "-"} · {item.pidAlive ? t("settings.taskHealthAlive") : t("settings.taskHealthMissing")} · log {formatBytes(item.logBytes)}</span>
                    {item.childPid && <span>codex {item.childPid} · {item.childPidAlive ? t("settings.taskHealthAlive") : t("settings.taskHealthMissing")}</span>}
                  </div>
                  <div className="storage-actions">
                    <span className={`pill ${item.issue ? "warm" : ""}`}>{item.issue ?? t("settings.taskHealthHealthy")}</span>
                    <button className="ghost-button" type="button" onClick={() => onOpenSession(item.sessionId)}>{t("nav.sessions")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </section>
          <section className="provider-card">
          <strong>{t("usage.title")}</strong>
          <span>{t("usage.globalHelp")}</span>
          <label className="room-setting-row">
            <span>{t("usage.showMessageUsageGlobal")}</span>
            <Switch checked={usageDisplay?.showMessageUsage === true} disabled={busy === "usage-display"} onCheckedChange={(checked) => void updateUsageDisplay(checked)} />
          </label>
          <span className="subtle">{t("usage.showMessageUsageGlobalHelp")}</span>
          <form className="usage-retention-form" onSubmit={saveUsageRetention}>
            <label>
              <span>{t("usage.retentionDays")}</span>
              <input name="usageRetentionDays" className="search-input" type="number" min="0" max="3650" value={usageRetentionDays} onChange={(event) => setUsageRetentionDays(event.target.value)} />
            </label>
            <button className="ghost-button" type="submit" disabled={busy === "usage-retention"}><IconText icon={Save}>{t("action.save")}</IconText></button>
          </form>
          {usageRetention && <code>{usageRetention.retentionDays > 0 ? t("usage.retentionCurrent").replace("{days}", String(usageRetention.retentionDays)) : t("usage.retentionForever")}</code>}
          <div className="settings-actions">
            <button className="ghost-button" type="button" onClick={() => void loadUsageOverview()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></button>
            <button className="ghost-button danger-button" type="button" disabled={busy === "usage-cleanup" || !usageRetention?.retentionDays} onClick={() => void cleanupUsageRecords()}><IconText icon={Trash2}>{t("usage.cleanupNow")}</IconText></button>
            <button className="ghost-button danger-button" type="button" disabled={busy === "usage-clear" || !usageOverview?.summary.records} onClick={() => void clearUsageRecords()}><IconText icon={Trash2}>{t("usage.clearAll")}</IconText></button>
          </div>
          {usageOverview && (
            <>
              <div className="item-row">
                <strong>{t("usage.requestRecords")}</strong>
                <span>{usageOverview.recent.length}/{usageOverview.summary.records}</span>
              </div>
              <form className="usage-filter-form" onSubmit={applyUsageTimeFilter}>
                <label>
                  <span>{t("usage.filterFrom")}</span>
                  <input name="usageFilterFrom" className="search-input" type="datetime-local" value={usageFilterFrom} onChange={(event) => setUsageFilterFrom(event.target.value)} />
                </label>
                <label>
                  <span>{t("usage.filterTo")}</span>
                  <input name="usageFilterTo" className="search-input" type="datetime-local" value={usageFilterTo} onChange={(event) => setUsageFilterTo(event.target.value)} />
                </label>
                <div className="settings-actions">
                  <button className="ghost-button" type="submit">{t("usage.applyFilter")}</button>
                  <button className="ghost-button" type="button" disabled={!usageFilterFrom && !usageFilterTo && !appliedUsageFilter.createdFrom && !appliedUsageFilter.createdTo} onClick={clearUsageTimeFilter}>{t("usage.clearFilter")}</button>
                  <button className="ghost-button danger-button" type="button" disabled={busy === "usage-delete-filtered" || (!appliedUsageFilter.createdFrom && !appliedUsageFilter.createdTo) || !usageOverview.summary.records} onClick={() => void deleteFilteredUsageRecords()}><IconText icon={Trash2}>{t("usage.deleteFiltered")}</IconText></button>
                </div>
              </form>
            </>
          )}
          {usageOverview && usageOverview.summary.records > 0 ? (
            <>
              <div className="session-info-grid">
                <div className="session-info-row"><span>{t("usage.totalTokens")}</span><strong>{formatTokens(usageOverview.summary.totalTokens)}</strong></div>
                <div className="session-info-row"><span>{t("usage.inputTokens")}</span><strong>{formatTokens(usageOverview.summary.inputTokens)}</strong></div>
                <div className="session-info-row"><span>{t("usage.outputTokens")}</span><strong>{formatTokens(usageOverview.summary.outputTokens)}</strong></div>
                <div className="session-info-row"><span>{t("usage.cachedInputTokens")}</span><strong>{formatTokens(usageOverview.summary.cachedInputTokens)}</strong></div>
                <div className="session-info-row"><span>{t("usage.reasoningTokens")}</span><strong>{formatTokens(usageOverview.summary.reasoningOutputTokens)}</strong></div>
                <div className="session-info-row"><span>{t("usage.records")}</span><strong>{usageOverview.summary.records}</strong></div>
              </div>
              <span className="subtle">{t("usage.breakdownHelp")}</span>
              <div className="storage-list">
                {[...usageOverview.byProvider.slice(0, 3), ...usageOverview.byModel.slice(0, 3), ...usageOverview.bySession.slice(0, 3)].map((bucket, index) => (
                  <div className="storage-item" key={`${bucket.key}:${index}`}>
                    <div>
                      <strong>{bucket.label ?? bucket.key}</strong>
                      <span>{bucket.providerId ? t("usage.byProvider") : bucket.model ? t("usage.byModel") : t("usage.bySession")} · {bucket.deleted ? `${t("usage.deleted")} · ` : ""}{formatTokens(bucket.summary.totalTokens)} {t("usage.totalTokens")}</span>
                    </div>
                    <div className="storage-actions">
                      <span className="pill">{t("usage.inputTokens")} {formatTokens(bucket.summary.inputTokens)}</span>
                      <span className="pill">{t("usage.outputTokens")} {formatTokens(bucket.summary.outputTokens)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="storage-list">
                {usageOverview.recent.map((record) => (
                  <div className="storage-item" key={record.id}>
                    <div>
                      <strong>{record.sessionTitle ?? record.sessionId}</strong>
                      <span>{formatShortDate(record.createdAt)} · {record.providerName ?? record.providerId ?? "-"} / {record.model ?? "-"}</span>
                      <span>{t("usage.requestId")} {record.id} · {t("usage.source")} {record.source}</span>
                    </div>
                    <div className="storage-actions">
                      <span className="pill">{formatTokens(record.totalTokens)} {t("usage.totalTokens")}</span>
                      <span className="pill">{t("usage.inputTokens")} {formatTokens(record.inputTokens)}</span>
                      <span className="pill">{t("usage.cachedInputTokens")} {formatTokens(record.cachedInputTokens)}</span>
                      <span className="pill">{t("usage.outputTokens")} {formatTokens(record.outputTokens)}</span>
                      <span className="pill">{t("usage.reasoningTokens")} {formatTokens(record.reasoningOutputTokens)}</span>
                      <span className="pill">{t("usage.billableInputTokens")} {formatTokens(record.billableInputTokens)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {usageTotalPages > 1 && (
                <div className="settings-actions">
                  <button className="ghost-button" type="button" disabled={usageRecentPage === 0} onClick={() => void loadUsageOverview(usageRecentPage - 1)}>{t("usage.previousPage")}</button>
                  {usagePageButtons[0] > 0 && <button className="ghost-button" type="button" onClick={() => void loadUsageOverview(0)}>1</button>}
                  {usagePageButtons[0] > 1 && <span className="pill">...</span>}
                  {usagePageButtons.map((page) => (
                    <button className={`ghost-button${page === usageRecentPage ? " active" : ""}`} type="button" key={page} onClick={() => void loadUsageOverview(page)}>{page + 1}</button>
                  ))}
                  {usagePageButtons.at(-1) !== undefined && usagePageButtons.at(-1)! < usageTotalPages - 2 && <span className="pill">...</span>}
                  {usagePageButtons.at(-1) !== undefined && usagePageButtons.at(-1)! < usageTotalPages - 1 && <button className="ghost-button" type="button" onClick={() => void loadUsageOverview(usageTotalPages - 1)}>{usageTotalPages}</button>}
                  <button className="ghost-button" type="button" disabled={usageRecentPage >= usageTotalPages - 1} onClick={() => void loadUsageOverview(usageRecentPage + 1)}>{t("usage.nextPage")}</button>
                </div>
              )}
            </>
          ) : <div className="empty-state">{t("usage.empty")}</div>}
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="storage">
          <section className="provider-card">
          <strong>{t("settings.storageTitle")}</strong>
          <span>{t("settings.storageHelp")}</span>
          <div className="settings-actions">
            <button className="ghost-button" type="button" disabled={busy === "storage-scan"} onClick={() => void scanStorage()}><IconText icon={FolderOpen}>{t("settings.scanStorage")}</IconText></button>
            {storageScan && (
              <>
                <button className="ghost-button" type="button" disabled={!visibleStorageItems.length} onClick={() => setSelectedStorageIds(allVisibleStorageSelected ? selectedStorageIds.filter((id) => !visibleStorageIds.includes(id)) : Array.from(new Set([...selectedStorageIds, ...visibleStorageIds])))}>{allVisibleStorageSelected ? t("settings.storageUnselectVisible") : t("settings.storageSelectVisible")}</button>
                <button className="ghost-button danger-button" type="button" disabled={!selectedStorageIds.length || busy === "storage-delete-selected"} onClick={() => void deleteSelectedStorageItems()}><IconText icon={Trash2}>{t("settings.storageDeleteSelected").replace("{count}", String(selectedStorageIds.length))}</IconText></button>
                <button className="ghost-button danger-button" type="button" disabled={!orphanStorageItems.length || busy === "storage-delete-orphans"} onClick={() => void deleteOrphanStorageItems()}><IconText icon={Trash2}>{t("settings.storageDeleteOrphans").replace("{count}", String(orphanStorageItems.length))}</IconText></button>
              </>
            )}
            {storageScan && <span className="subtle">{t("settings.storageTotal")}: {formatBytes(storageScan.totalBytes)} · {t("settings.storageActive")} {activeStorageItems.length} · {t("settings.storageOrphan")} {orphanStorageItems.length}</span>}
          </div>
          {storageScan && <span className="subtle">{t("settings.storageOrphanHelp")}</span>}
          {storageScan && (
            <div className="project-list-filters">
              <input name="storagesearch" value={storageSearch} onChange={(event) => setStorageSearch(event.target.value)} placeholder={t("settings.storageSearch")} />
              <select name="storagestatusfilter" value={storageStatusFilter} onChange={(event) => setStorageStatusFilter(event.target.value)}>
                <option value="">{t("session.allStatuses")}</option>
                <option value="active">{t("settings.storageActive")}</option>
                <option value="orphan">{t("settings.storageOrphan")}</option>
              </select>
              <select name="storagesort" value={storageSort} onChange={(event) => setStorageSort(event.target.value as typeof storageSort)}>
                <option value="bytes">{t("settings.storageSortSize")}</option>
                <option value="updated">{t("settings.storageSortUpdated")}</option>
                <option value="type">{t("settings.storageSortType")}</option>
              </select>
            </div>
          )}
          {storageScan && !storageScan.items.length && <div className="empty-state">{t("settings.storageEmpty")}</div>}
          {storageScan && storageScan.items.length > 0 && (
            <div className="storage-list">
              {visibleStorageItems.map((item) => (
                <div className="storage-item" key={item.id}>
                  <div>
                    <strong><input name={`storage-${item.id}`} type="checkbox" checked={selectedStorageIds.includes(item.id)} onChange={() => setSelectedStorageIds((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])} /> {item.label}</strong>
                    {item.sessionType && item.type === "session-data" && (
                      <span>{t("settings.storageSessionType")}: {readableStorageSessionType(item.sessionType, t)}</span>
                    )}
                    {item.sessionKind && item.type === "session-data" && (
                      <span>{t("settings.storageSessionKind")}: {readableStorageSessionKind(item.sessionKind, t)}</span>
                    )}
                    {item.relatedName && (
                      <span>{t(`settings.storageRelated${item.relatedType === "project" ? "Project" : item.relatedType === "room" ? "Room" : item.relatedType === "run" ? "Run" : item.relatedType === "preview" ? "Preview" : "Session"}`)}: {item.relatedName}</span>
                    )}
                    <span>{readableStorageItemType(item.type, t)} · {formatBytes(item.bytes)} · {formatShortDate(item.updatedAt)}</span>
                    <code>{item.path}</code>
                  </div>
                  <div className="storage-actions">
                    <span className={`pill ${item.status === "orphan" ? "warm" : ""}`}>{item.status === "orphan" ? t("settings.storageOrphan") : t("settings.storageActive")}</span>
                    <button className="ghost-button icon-only" type="button" title={t("action.copy")} aria-label={t("action.copy")} onClick={() => void copyStoragePath(item)}><IconText icon={Copy}>{t("action.copy")}</IconText></button>
                    <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `storage-delete:${item.id}`} title={t("settings.storageDelete")} aria-label={t("settings.storageDelete")} onClick={() => void deleteStorageItem(item)}><IconText icon={Trash2}>{t("settings.storageDelete")}</IconText></button>
                  </div>
                </div>
              ))}
              {!visibleStorageItems.length && <div className="empty-state">{t("settings.storageEmpty")}</div>}
            </div>
          )}
          </section>
        </TabsContent>
        <TabsContent className="settings-list" value="backup">
          <section className="provider-card">
            <strong>{t("settings.backupTitle")}</strong>
            <span>{t("settings.backupHelp")}</span>
            <div className="settings-actions">
              <button className="ghost-button" type="button" disabled={busy === "backup-settings"} onClick={() => void editBackupIgnoreRules()}><IconText icon={Info}>{t("settings.editBackupIgnore")}</IconText></button>
              <button className="ghost-button" type="button" disabled={busy === "backup-preview"} onClick={() => backupPreview ? setBackupPreview(null) : void loadBackupPreview()}><IconText icon={Files}>{backupPreview ? t("settings.backupHidePreview") : t("settings.backupPreview")}</IconText></button>
              <button className="ghost-button" type="button" disabled={busy === "backup-download"} onClick={() => void downloadSystemBackup()}><IconText icon={Download}>{t("settings.backupDownload")}</IconText></button>
            </div>
            {backupSettings && <span className="subtle">{t("settings.backupIgnoreUpdated").replace("{time}", formatShortDate(backupSettings.updatedAt))}</span>}
            <div className="backup-scope-grid">
              <div>
                <strong>{t("settings.backupIncluded")}</strong>
                <ul>
                  {(backupPreview?.manifest.included ?? [t("settings.backupIncludedDefault")]).map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}
                </ul>
              </div>
              <div>
                <strong>{t("settings.backupExcluded")}</strong>
                <ul>
                  {(backupPreview?.manifest.excluded ?? [t("settings.backupExcludedDefault")]).map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}
                </ul>
              </div>
            </div>
            {backupPreview && (
              <>
                <span className="result-ok">{t("settings.backupPreviewStats").replace("{entries}", String(backupPreview.entries)).replace("{size}", formatBytes(backupPreview.bytes))}</span>
                <strong>{t("settings.backupFilesTitle")}</strong>
                {renderBackupFileList(backupPreview, backupFilePage, setBackupFilePage)}
                <strong>{t("settings.backupProjectReferences")}</strong>
                <div className="storage-list">
                  {backupPreview.manifest.projects.length ? backupPreview.manifest.projects.map((project) => (
                    <div className="storage-item" key={project.id}>
                      <div>
                        <strong>{project.name}</strong>
                        <span>{project.exists ? t("settings.projectPathExists") : t("settings.projectPathMissing")} · {t("settings.projectSourceExcluded")}</span>
                        <code>{project.workspacePath}</code>
                        {(project.gitBranch || project.gitCommit || project.gitRemote) && <span>{[project.gitBranch, project.gitCommit?.slice(0, 8), project.gitDirty ? t("settings.gitDirty") : null].filter(Boolean).join(" · ")}</span>}
                      </div>
                      <span className="pill warm">{t("settings.notIncluded")}</span>
                    </div>
                  )) : <div className="empty-state">{t("settings.noProjectReferences")}</div>}
                </div>
                {backupPreview.manifest.warnings.map((warning) => <span className="result-error" key={warning}>{readableBackupManifestText(warning, t)}</span>)}
              </>
            )}
          </section>
          <section className="provider-card">
            <strong>{t("settings.restoreTitle")}</strong>
            <span>{t("settings.restoreHelp")}</span>
            <div className="restore-file-picker">
              <input ref={restoreFileInputRef} name="restore-backup-file" className="restore-file-native" type="file" accept=".zip,application/zip" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void previewRestoreBackup(file);
              }} />
              <button className="ghost-button" type="button" onClick={() => {
                if (restoreFileInputRef.current) restoreFileInputRef.current.value = "";
                restoreFileInputRef.current?.click();
              }}>{t("settings.restoreChooseFile")}</button>
              <span className="subtle">{restoreFile?.name ?? t("settings.restoreNoFileSelected")}</span>
            </div>
            {restorePreview && (
              <>
                <span className="result-ok">{t("settings.restorePreviewStats").replace("{entries}", String(restorePreview.entries)).replace("{size}", formatBytes(restorePreview.bytes))}</span>
                <strong>{t("settings.backupFilesTitle")}</strong>
                {renderBackupFileList(restorePreview, restoreFilePage, setRestoreFilePage)}
                <div className="backup-scope-grid">
                  <div>
                    <strong>{t("settings.backupIncluded")}</strong>
                    <ul>{restorePreview.manifest.included.map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}</ul>
                  </div>
                  <div>
                    <strong>{t("settings.backupExcluded")}</strong>
                    <ul>{restorePreview.manifest.excluded.map((item) => <li key={item}>{readableBackupManifestText(item, t)}</li>)}</ul>
                  </div>
                </div>
                <div className="settings-actions">
                  <button className="ghost-button danger-button" type="button" disabled={busy === "restore-apply"} onClick={() => void restoreSystemBackup()}><IconText icon={RotateCcw}>{t("settings.restoreApply")}</IconText></button>
                </div>
                {restorePreview.manifest.warnings.map((warning) => <span className="result-error" key={warning}>{readableBackupManifestText(warning, t)}</span>)}
              </>
            )}
            {restoreMessage && <span className={restoreMessage === t("settings.restoreFailed") ? "result-error" : "result-ok"}>{restoreMessage}</span>}
          </section>
      </TabsContent>
      </Tabs>
      {notificationCustomTestAccount && (
        <NotificationCustomTestDialog
          account={notificationCustomTestAccount}
          busy={busy === `notification-custom-test:${notificationCustomTestAccount.id}`}
          form={notificationCustomTestForm}
          t={t}
          onClose={() => setNotificationCustomTestAccount(null)}
          onSubmit={sendCustomNotificationTest}
          setForm={setNotificationCustomTestForm}
        />
      )}
      {notificationChannelManagerOpen && (
        <NotificationChannelManagerDialog
          busy={busy}
          editingChannelId={notificationEditingChannelId}
          form={notificationChannelForm}
          settings={notificationSettings}
          t={t}
          onClose={() => setNotificationChannelManagerOpen(false)}
          onDelete={(channel) => void deleteNotificationChannel(channel)}
          onEdit={editNotificationChannel}
          onReset={resetNotificationChannelForm}
          onSubmit={createNotificationChannel}
          setForm={setNotificationChannelForm}
        />
      )}
      {environmentPackagePanel && (
        <div className="dialog-layer" role="presentation">
          <button className="dialog-backdrop" type="button" aria-label={t("action.close")} onClick={() => setEnvironmentPackagePanel(null)} />
          <section className="dialog-card environment-package-dialog" role="dialog" aria-modal="true" aria-label={t("settings.environmentPackageManage")}>
            <div className="dialog-head">
              <div>
                <strong>{t("settings.environmentPackageManage")}</strong>
                <p>{`${environmentPackagePanel.toolRecord.tool}@${environmentPackagePanel.toolRecord.requestedVersion}`}</p>
                <p>{t("settings.environmentPackageSupportHint")}</p>
                {environmentPackagePanel.toolRecord.tool === "python" && <p>{t("settings.environmentPythonPackageHint")}</p>}
              </div>
              <div className="dialog-head-actions">
                <button className="drawer-close" type="button" aria-label={t("action.close")} onClick={() => setEnvironmentPackagePanel(null)}><X size={16} /></button>
              </div>
            </div>
            <form className="environment-package-form" onSubmit={installEnvironmentPackage}>
              <label>
                <span>{t("settings.environmentPackageManager")}</span>
                <select name="environment-package-manager" value={environmentPackageForm.manager} onChange={(event) => {
                  const manager = event.target.value;
                  setEnvironmentPackageForm((current) => ({ ...current, manager }));
                  setEnvironmentPackageProbe(environmentPackagePanel.packages.some((pkg) => pkg.packageName.toLowerCase() === environmentPackageForm.packageName.trim().toLowerCase() && pkg.manager === manager)
                    ? { installed: true, manager, packageName: environmentPackageForm.packageName.trim(), checked: false }
                    : null);
                }} required>
                  <option value="">{t("settings.environmentPackageManagerPlaceholder")}</option>
                  {environmentPackagePanel.managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>{manager.label}{manager.detectedVersion ? ` · ${manager.detectedVersion} · ${t("settings.environmentPackageManagerRecommended")}` : ""}</option>
                  ))}
                </select>
              </label>
              {selectedEnvironmentPackageManager && (
                <div className="environment-package-manager-hint">
                  <span className="pill">{selectedEnvironmentPackageManager.label}</span>
                  {selectedEnvironmentPackageManager.detectedVersion && <span className="pill">{`${t("settings.environmentDetectedVersion")} ${selectedEnvironmentPackageManager.detectedVersion}`}</span>}
                  <span className="subtle">{selectedEnvironmentPackageManager.installCommandExample}</span>
                  {environmentPackagePanel.toolRecord.tool === "python" && selectedEnvironmentPackageManager.id === "pip" && <span className="subtle">{t("settings.environmentPythonPipHint")}</span>}
                  {environmentPackagePanel.toolRecord.tool === "python" && selectedEnvironmentPackageManager.id === "uv" && <span className="subtle">{t("settings.environmentPythonUvToolHint")}</span>}
                </div>
              )}
              <div className="environment-package-name-row">
                <label>
                  <span>{t("settings.environmentPackageName")}</span>
                  <input name="environment-package-name" value={environmentPackageForm.packageName} onChange={(event) => {
                    const value = event.target.value;
                    setEnvironmentPackageForm((current) => ({ ...current, packageName: value }));
                    setEnvironmentPackageProbe(environmentPackagePanel.packages.some((pkg) => pkg.packageName.toLowerCase() === value.trim().toLowerCase() && pkg.manager === environmentPackageForm.manager)
                      ? { installed: true, manager: environmentPackageForm.manager, packageName: value.trim(), checked: false }
                      : null);
                  }} placeholder={t("settings.environmentPackageNamePlaceholder")} required />
                </label>
                <button className="ghost-button" type="button" disabled={busy === "environment-package-probe" || !environmentPackageForm.manager || !environmentPackageForm.packageName.trim()} onClick={() => void probeEnvironmentPackage()}>
                  <IconText icon={busy === "environment-package-probe" ? RefreshCw : Search}>{busy === "environment-package-probe" ? t("settings.environmentPackageChecking") : t("settings.environmentPackageCheck")}</IconText>
                </button>
              </div>
              {normalizedEnvironmentPackageName && (
                <div className="environment-package-inline-state">
                  {environmentPackageAlreadyTracked
                    ? <span className="pill">{t("settings.environmentPackageAlreadyTracked")}</span>
                    : environmentPackageProbe?.installed
                      ? <span className="pill">{t("settings.environmentPackageDetected")}</span>
                      : environmentPackageProbe?.checked
                        ? <span className="subtle">{t("settings.environmentPackageNotDetected")}</span>
                        : <span className="subtle">{t("settings.environmentPackageWillInstall")}</span>}
                  {environmentPackageProbe?.installed && environmentPackageProbe.version && <span className="pill">{environmentPackageProbe.version}</span>}
                </div>
              )}
              <label>
                <span>{t("settings.environmentPackageVersion")}</span>
                <input name="environment-package-version" value={environmentPackageForm.versionSpec} onChange={(event) => setEnvironmentPackageForm((current) => ({ ...current, versionSpec: event.target.value }))} placeholder={t("settings.environmentPackageVersionPlaceholder")} />
              </label>
              <label>
                <span>{t("settings.environmentNotes")}</span>
                <input name="environment-package-notes" value={environmentPackageForm.notes} onChange={(event) => setEnvironmentPackageForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("settings.environmentNotesPlaceholder")} />
              </label>
              <div className="dialog-actions">
                <button className="ghost-button" type="submit" disabled={busy === "environment-package-install" || !environmentPackageForm.manager}><IconText icon={Plus}>{environmentPackageProbe?.installed ? t("settings.environmentPackageRecord") : t("settings.environmentPackageInstall")}</IconText></button>
                <button className="ghost-button" type="button" disabled={busy === "environment-bulk:record_detected_packages"} onClick={() => void runEnvironmentBulkAction({ action: "record_detected_packages", toolRecordId: environmentPackagePanel.toolRecord.id })}>{t("settings.environmentBulkRecordDetected")}</button>
                <button className="ghost-button" type="button" disabled={busy === "environment-bulk:install_missing_packages"} onClick={() => void runEnvironmentBulkAction({ action: "install_missing_packages", toolRecordId: environmentPackagePanel.toolRecord.id })}>{t("settings.environmentBulkInstallMissing")}</button>
              </div>
            </form>
            <div className="environment-package-list">
              <div className="environment-card-head">
                <div>
                  <strong>{t("settings.environmentRestorePreviewTitle")}</strong>
                  <span>{t("settings.environmentRestorePreviewHelp")}</span>
                </div>
              </div>
              {!environmentPackagePanel.restorePreview.length && <div className="empty-state">{t("settings.environmentPreviewEmpty")}</div>}
              {environmentPackagePanel.restorePreview.map((item) => (
                <article className="environment-item" key={item.id}>
                  <div className="environment-item-main">
                    <div className="environment-item-head">
                      <strong>{item.title}</strong>
                      <span className={`pill ${item.action === "manual" ? "warm" : ""}`}>
                        {item.action === "install" ? t("settings.environmentActionInstall")
                          : item.action === "record" ? t("settings.environmentActionRecord")
                            : item.action === "manual" ? t("settings.environmentActionManual")
                              : t("settings.environmentActionSkip")}
                      </span>
                    </div>
                    <span>{item.detail}</span>
                    {item.command && <code>{item.command}</code>}
                  </div>
                </article>
              ))}
            </div>
            <div className="environment-package-list">
              {!environmentPackagePanel.packages.length && <div className="empty-state">{t("settings.environmentPackageEmpty")}</div>}
              {Boolean(environmentPackagePanel.packages.length) && !filteredEnvironmentPackages.length && <div className="empty-state">{t("settings.environmentPackageFilterEmpty")}</div>}
              {filteredEnvironmentPackages.map((pkg) => (
                <article className="environment-item" key={pkg.id}>
                  <div className="environment-item-main">
                    <div className="environment-item-head">
                      <strong>{pkg.packageName}</strong>
                      <div className="provider-card-actions">
                        <span className={`pill ${pkg.status === "failed" ? "warm" : ""}`}>{pkg.manager}</span>
                        <span className="pill">{pkg.persisted ? t("settings.environmentPackageRecorded") : t("settings.environmentPackageDetected")}</span>
                      </div>
                    </div>
                    <span>{pkg.installedVersion ?? pkg.versionSpec ?? t("settings.environmentMissingVersion")}</span>
                    <span>{pkg.targetLabel}</span>
                    {pkg.notes && <span>{pkg.notes}</span>}
                  </div>
                  <div className="storage-actions">
                    <button className="ghost-button danger-button icon-only" type="button" disabled={busy === `environment-package-delete:${pkg.id}` || environmentPackageNeedsManualCleanup(pkg)} title={environmentPackageNeedsManualCleanup(pkg) ? t("settings.environmentPackageManualCleanup") : t("settings.environmentPackageUninstall")} aria-label={environmentPackageNeedsManualCleanup(pkg) ? t("settings.environmentPackageManualCleanup") : t("settings.environmentPackageUninstall")} onClick={() => void uninstallEnvironmentPackage(pkg)}><IconText icon={Trash2}>{environmentPackageNeedsManualCleanup(pkg) ? t("settings.environmentPackageManualCleanup") : t("settings.environmentPackageUninstall")}</IconText></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      {dialog.node}
    </main>
  );
}

function datetimeLocalToIso(value: string) {
  if (!value.trim()) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
