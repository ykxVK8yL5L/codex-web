import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  Activity,
  Bell,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FilePlus2,
  Files,
  FolderOpen,
  FolderGit2,
  FolderPlus,
  GitPullRequest,
  Globe,
  History,
  Info,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pause,
  PackageX,
  PanelLeftOpen,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Unlock,
  Users,
  X,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { useAppDialog } from "@/components/AppDialog";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Button } from "@/components/ui/button";
import { CodeEditor, preferredCodeEditorMode, type CodeEditorMode } from "@/components/CodeEditor";
import { FilterSearchInput, FilterToolbar } from "@/components/FilterControls";
import { IconText } from "@/components/IconText";
import { LanguageSelect } from "@/components/LanguageSelect";
import { NotificationCenter } from "@/components/NotificationCenter";
import { NotificationCenterContext, PageHeader } from "@/components/PageHeader";
import { PreviewDetailRow } from "@/components/PreviewDetailRow";
import { Input } from "@/components/ui/input";
import { NotificationPlatformsPanel } from "@/components/settings/NotificationPlatformsPanel";
import { FilesPage } from "@/features/files";
import { ProvidersPage } from "@/features/providers";
import { AutomationsPage } from "@/features/automations";
import { ExtensionsPage } from "@/features/extensions";
import { SettingsPage } from "@/features/settings";
import { TerminalPage } from "@/features/terminal";
import { ApprovalsPage } from "@/features/approvals";
import { PreviewsPage } from "@/features/previews";
import { ProjectsPage } from "@/features/projects";
import { ContactsPage } from "@/features/contacts/ContactsPage";
import { GoalPanel } from "@/features/goals/GoalPanel";
import { RoomConsole, type RoomConsoleUpdate } from "@/features/rooms/RoomConsole";
import {
  filesToAttachmentInputs,
  localStorageStringSet,
  localUserMessage,
  listenModeOptions,
  maxComposerAttachmentBytes,
  maxComposerAttachmentFiles,
  mergeMessages,
  messageTextWithContext,
  newestLinesFirst,
  newestTaskRunsFirst,
  projectDisplayName,
  promptWithFileReferences,
  readLocalStorageValue,
  readableAgentWorkspaceMode,
  readableBackupManifestText,
  readableGitStatus,
  readableGoalMode,
  readableGoalStatus,
  readableListenMode,
  readableNotificationEvent,
  readablePermissionProfile,
  readableRoomArtifactKind,
  readableRoomDecisionStatus,
  readableRoomHandoffStatus,
  readableRunStatus,
  readableSessionType,
  readableStatus,
  readableStorageItemType,
  readableStorageSessionKind,
  readableStorageSessionType,
  roomArtifactKinds,
  type ComposerFileReference,
} from "@/features/sessions/utils";
import { MessageCards } from "@/features/sessions/MessageCards";
import { Bubble } from "@/features/sessions/Bubble";
import { ContextPanel } from "@/features/sessions/ContextPanel";
import { QueuedMessageRow } from "@/features/sessions/QueuedMessageRow";
import { SessionPage } from "@/features/sessions/SessionPage";
import { MobileMainToggle, MobileSessionToggle, SessionLoadingPage } from "@/features/sessions/SessionChrome";
import { Threads } from "@/features/sessions/Threads";
import { AutomationNotifyRuleDialog } from "@/components/automations";
import {
  apiKeyActionLabel,
  apiKeyGroupLabel,
  apiKeyModuleLabel,
  apiKeyPermissionGroupDescription,
  apiKeyPermissionLabel,
  apiKeyPermissionOptionLabel,
  apiKeyPermissionOptionTitle,
  apiKeyPermissionGroupLabel,
  apiKeyPermissionGroupTitle,
  apiKeyPresetLabel,
} from "@/features/settings/labels";
import { Switch } from "@/components/ui/switch";
import { PreviewDirectoryPicker } from "@/components/PreviewDirectoryPicker";
import { ToastViewport } from "@/components/ToastViewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clearNotificationDeliveriesRequest,
  clearNotificationRulesRequest,
  buildNotificationAccountConfig,
  buildNotificationRecipientConfig,
  createNotificationAccountForm,
  createNotificationChannelForm,
  createNotificationEphemeralRule,
  createNotificationRecipientForm,
  createNotificationRuleForm,
  createNotificationTestSettingsForm,
  deleteNotificationAccountRequest,
  deleteNotificationChannelRequest,
  deleteNotificationDeliveryRequest,
  deleteNotificationEphemeralRuleRequest,
  deleteNotificationRecipientRequest,
  deleteNotificationRuleRequest,
  fetchNotificationDeliveriesPage,
  fetchNotificationEphemeralRulesPage,
  fetchNotificationPlatformSettings,
  fetchNotificationRulesPage,
  fetchNotificationSettings,
  fetchNotificationTestSettings,
  NotificationAccountEditorDialog,
  NotificationAccountList,
  NotificationChannelManagerDialog,
  NotificationCustomTestDialog,
  type NotificationAccountForm,
  type NotificationCustomTestForm,
  notificationKindLabel,
  notificationAccountFormFromAccount,
  notificationRecipientFormFromRecipient,
  notificationRuleFormFromRule,
  notificationAccountKind as resolveNotificationAccountKind,
  notificationPermissionSummary as notificationPermissionSummaryText,
  notificationPermissionsFromForm,
  notificationPermissionsToForm,
  notificationAccountTestTarget as buildNotificationAccountTestTarget,
  notificationSenderAccountsForKind as getNotificationSenderAccountsForKind,
  NotificationRecipientList,
  NotificationRecipientEditorDialog,
  NotificationTestSettingsCard,
  type NotificationChannelForm,
  type NotificationRecipientForm,
  type NotificationRuleForm,
  type NotificationTestSettingsForm,
  retryNotificationDeliveryRequest,
  testNotificationAccountRequest,
  testNotificationRecipientRequest,
  updateNotificationTestSettings,
  selectedNotificationChannel as resolveSelectedNotificationChannel,
  upsertNotificationAccount,
  upsertNotificationChannel,
  upsertNotificationRecipient,
  upsertNotificationRule,
} from "@/features/notifications";
import { formatBytes, formatShortDate, prettyJson, renderPreviewCommand, rulesForArchiveTemplates } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import { sessionInfoRequestedEvent, taskActivityChangedEvent, workspaceChangedEvent } from "@/lib/events";
import { localeLabels, translate, type Locale, type TranslationKey } from "@/lib/i18n";
import { detectInitialLocale, pageFromHash, routeFromHash, type Page } from "@/lib/navigation";
import { openPreviewUrl } from "@/lib/previews";
import type {
  ApprovalDecisionResponse,
  ApprovalGrantSummary,
  ApprovalSummary,
  AgentCircleSummary,
  AgentGroupSummary,
  AgentListenMode,
  AgentProjectAccessMode,
  AgentRoleSummary,
  AgentRoleTemplateSummary,
  AgentSummary,
  AppNotificationSummary,
  AppNotificationStreamEvent,
  AppNotificationsResponse,
  ApiKeyDetailResponse,
  ApiKeyPermission,
  ApiKeyPermissionGroup,
  ApiKeyPermissionsResponse,
  ApiKeyPreset,
  ApiKeySummary,
  ArchiveIgnoreTemplate,
  AuthState,
  AutomationRunSummary,
  AutomationSummary,
  CodexApprovalPolicy,
  CodexRuntimeSettings,
  CodexSandboxMode,
  CodexTaskDetail,
  ContinueCodexTaskRequest,
  CreateCodexTaskRequest,
  CreateMcpServerRequest,
  CreatePluginRequest,
  CreateSkillRequest,
  DeleteSkillRequest,
  CreateFileRequest,
  CreateFileMountRequest,
  CreateRoomMessageResponse,
  CreateProjectRequest,
  CreatePreviewRequest,
  CreateProviderRequest,
  CreateAutomationRequest,
  CreateApiKeyRequest,
  CreateTerminalSessionRequest,
  DeleteMarketplaceItemsRequest,
  ExtensionDetail,
  ExtensionSummary,
  ExecutionContextSummary,
  EnvironmentOverview,
  EnvironmentBulkActionRequest,
  EnvironmentPackageDetailResponse,
  EnvironmentPackageManagerOption,
  EnvironmentPackageRecord,
  EnvironmentRestoreMissingRequest,
  EnvironmentRestorePreviewResponse,
  EnvironmentRestoreRun,
  EnvironmentToolRecord,
  EnvironmentToolRegistryItem,
  EnvironmentToolProbe,
  EnvironmentToolVersionItem,
  FileContentResponse,
  FileArchiveRequest,
  FileArchivePreviewResponse,
  FileEntry,
  FileListResponse,
  FileMount,
  GoalDetailResponse,
  GoalFocusStatus,
  GoalItemStatus,
  GoalMode,
  GoalStatus,
  GoalSummary,
  LoginResponse,
  MaintenanceCleanupResponse,
  MessageCardSummary,
  NotificationAccountSummary,
  NotificationChannelDefinition,
  NotificationDeliverySummary,
  NotificationEphemeralRuleSummary,
  NotificationEventType,
  NotificationRecipientSummary,
  NotificationRuleSummary,
  NotificationRuleTarget,
  NotificationSeverity,
  NotificationSettingsResponse,
  NotificationTestSettings,
  PageResponse,
  PermissionProfileId,
  PlatformSettingsResponse,
  ProjectCheckRunSummary,
  ProjectGitOperationRequest,
  ProjectGitOperationSummary,
  ProjectStatsSummary,
  ProjectSummary,
  PreviewAccess,
  PreviewAccessSettings,
  PreviewLogsResponse,
  PreviewSummary,
  ProviderCapabilities,
  ProviderDetectionResponse,
  ProviderHealthCheck,
  ProviderModelsResponse,
  ProviderSummary,
  ProviderTestResponse,
  QueuedMessage,
  QueueMessageRequest,
  RateLimitSettings,
  RenameFileRequest,
  ReorderQueuedMessagesRequest,
  AgentRunSummary,
  RecoverCodexTaskRequest,
  RoomEventSummary,
  RoomArtifactSummary,
  RoomAgentSummary,
  RoomDecisionSummary,
  RoomHandoffSummary,
  RoomRunDiffResponse,
  RoomRunMergeResponse,
  RoomScheduleSummary,
  RoomSummary,
  RoomTaskSummary,
  SessionMessage,
  SessionCompactionResponse,
  SessionCompactionSettings,
  SessionMessagesPage,
  SessionSummary,
  SessionCompactionListResponse,
  SetupStartResponse,
  ResetOtpResponse,
  StorageItemSummary,
  StorageScanResponse,
  SystemBackupPreviewResponse,
  SystemBackupSettings,
  SystemRestoreResponse,
  TerminalDefaultsResponse,
  TerminalCommandResponse,
  TaskActivityResponse,
  TaskActivitySummary,
  TaskContextFileResponse,
  TaskContextResponse,
  TaskHealthResponse,
  TaskHealthRepairResponse,
  TaskLogResponse,
  TaskRunSummary,
  TerminalSessionSummary,
  UploadAttachmentInput,
  UpdateApiKeyRequest,
  UpdateQueuedMessageRequest,
  UpdateSessionCompactionRequest,
  UpdateSessionCompactionSettingsRequest,
  UpdateFileMountRequest,
  UpdateProjectRequest,
  UpdateProviderRequest,
  UpdateSessionRequest,
  UpdateAutomationRequest,
  UpdateAccessTokenRequest,
  UpdateCodexRuntimeSettingsRequest,
  UpdateSkillRequest,
  InstallEnvironmentToolRequest,
  ImportMarketplaceCatalogRequest,
  ImportSkillRequest,
  ImportMcpServerRequest,
  InstallMarketplaceItemResponse,
  MarketplaceCapabilityType,
  MarketplaceCatalogItem,
  MarketplaceCatalogResponse,
  UpdateRoomDecisionRequest,
  UpdateRoomHandoffRequest,
  UpdateSystemBackupSettingsRequest,
  ConfirmOtpResetRequest,
  UpdateTerminalSessionRequest,
  WorkspaceChangeFile,
  WorkspaceChanges,
} from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";
type ToastState = { id: number; message: string; tone: ToastTone };
const browserNotificationsEnabledKey = "codex-web-browser-notifications-enabled";
const suppressedAppNotificationsKey = "codex-web-suppressed-app-notifications";
const navItems: Array<{ page: Page; labelKey: TranslationKey; icon: React.ComponentType<{ size?: number }> }> = [
  { page: "sessions", labelKey: "nav.sessions", icon: Bot },
  { page: "files", labelKey: "nav.files", icon: Files },
  { page: "terminal", labelKey: "nav.terminal", icon: TerminalIcon },
  { page: "projects", labelKey: "nav.projects", icon: FolderGit2 },
  { page: "previews", labelKey: "nav.previews", icon: Globe },
  { page: "contacts", labelKey: "nav.contacts", icon: Users },
  { page: "extensions", labelKey: "nav.extensions", icon: Plug },
  { page: "automations", labelKey: "nav.automations", icon: Clock3 },
  { page: "providers", labelKey: "nav.providers", icon: Boxes },
  { page: "approvals", labelKey: "nav.approvals", icon: ShieldCheck },
  { page: "settings", labelKey: "nav.settings", icon: Settings },
];

function App() {
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem("codex-web-session") ?? "");
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());
  const t: TFunction = useCallback((key) => translate(locale, key), [locale]);
  const [page, setPage] = useState<Page>(sessionToken ? pageFromHash() : "auth");
  const [authChecked, setAuthChecked] = useState(false);
  const authRequestRef = useRef(0);
  const [auth, setAuth] = useState<AuthState>({
    authenticated: Boolean(sessionToken),
    setupRequired: !sessionToken,
    needsOtp: !sessionToken,
    user: sessionToken ? { id: "local-admin", email: "admin@local" } : null,
  });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionProjectFilter, setSessionProjectFilter] = useState("all");
  const [sessionStatusFilter, setSessionStatusFilter] = useState("all");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const pendingApprovalIdsRef = useRef<Set<string>>(new Set());
  const [taskDetails, setTaskDetails] = useState<Record<string, CodexTaskDetail>>({});
  const [optimisticMessages, setOptimisticMessages] = useState<Record<string, SessionMessage[]>>({});
  const [messageQueues, setMessageQueues] = useState<Record<string, QueuedMessage[]>>({});
  const [activeSessionId, setActiveSessionId] = useState(() => sessionToken ? routeFromHash().sessionId : "");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [draftTaskProjectId, setDraftTaskProjectId] = useState<string | null>(null);
  const [sessionNavOpen, setSessionNavOpen] = useState(false);
  const [mainNavOpen, setMainNavOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [appNotifications, setAppNotifications] = useState<AppNotificationSummary[]>([]);
  const [appNotificationUnreadCount, setAppNotificationUnreadCount] = useState(0);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(() => localStorage.getItem(browserNotificationsEnabledKey) !== "false");
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<NotificationPermission>(() => typeof Notification === "undefined" ? "denied" : Notification.permission);
  const browserNotificationsEnabledRef = useRef(browserNotificationsEnabled);
  const browserNotificationInstancesRef = useRef<Map<string, Notification>>(new Map());
  const appNotificationIdsRef = useRef<Set<string>>(new Set());
  const appNotificationsReadyRef = useRef(false);
  const suppressedAppNotificationIdsRef = useRef<Set<string>>(localStorageStringSet(suppressedAppNotificationsKey));
  const pageActiveRef = useRef(typeof document === "undefined" ? false : document.visibilityState === "visible");
  const toastTimerRef = useRef<number | null>(null);
  const dialog = useAppDialog();
  const activeSession = activeSessionId ? sessions.find((session) => session.id === activeSessionId) : undefined;
  const visibleSessions = sessions.filter((session) => {
    if (session.conversationType === "agent" && session.roomId) return false;
    if (session.conversationType === "automation") {
      return !automations.some((automation) => automation.sessionId === session.id);
    }
    return true;
  });
  const routeSessionPending = page === "sessions" && Boolean(activeSessionId) && !activeSession;

  function navigate(pageName: Page) {
    setSessionNavOpen(false);
    setMainNavOpen(false);
    if (pageName === "auth") {
      setPage("auth");
      return;
    }
    window.location.hash = pageName;
    setPage(pageName);
    if (pageName === "sessions") setActiveSessionId("");
  }

  function navigateSession(sessionId: string) {
    setSessionNavOpen(false);
    window.location.hash = `sessions/${encodeURIComponent(sessionId)}`;
    setPage("sessions");
    setActiveSessionId(sessionId);
    const unreadIds = appNotifications
      .filter((item) => !item.readAt && item.sourceType === "session" && item.sourceId === sessionId)
      .map((item) => item.id);
    if (unreadIds.length) void markAppNotificationsRead(unreadIds);
  }

  function applyHashRoute() {
    const route = routeFromHash();
    setPage(route.page);
    setActiveSessionId(route.page === "sessions" ? route.sessionId : "");
  }

  function changeLocale(nextLocale: Locale) {
    localStorage.setItem("codex-web-locale", nextLocale);
    setLocale(nextLocale);
  }

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const rememberPendingApprovalId = useCallback((approvalId?: string | null) => {
    if (!approvalId) return;
    const known = pendingApprovalIdsRef.current;
    if (known.has(approvalId)) return;
    known.add(approvalId);
    setPendingApprovalsCount((count) => count + 1);
  }, []);

  const notificationMatchesCurrentSession = useCallback((item: AppNotificationSummary) => {
    const metadata = item.metadata ?? {};
    const metadataSessionId = typeof metadata.sessionId === "string" ? metadata.sessionId : "";
    const metadataRoomId = typeof metadata.roomId === "string" ? metadata.roomId : "";
    return page === "sessions" && Boolean(activeSessionId) && (
      item.sourceId === activeSessionId ||
      metadataSessionId === activeSessionId ||
      (Boolean(activeSession?.roomId) && metadataRoomId === activeSession?.roomId)
    );
  }, [activeSession?.roomId, activeSessionId, page]);

  const shouldSuppressAppNotification = useCallback((item: AppNotificationSummary) => pageActiveRef.current && notificationMatchesCurrentSession(item), [notificationMatchesCurrentSession]);
  const unreadSessionNotificationIds = useMemo(() => new Set(appNotifications
    .filter((item) => !item.readAt && item.sourceType === "session" && item.sourceId)
    .map((item) => String(item.sourceId))), [appNotifications]);

  function rememberSuppressedAppNotifications(ids: string[]) {
    if (!ids.length) return;
    const suppressed = suppressedAppNotificationIdsRef.current;
    ids.forEach((id) => suppressed.add(id));
    const trimmed = Array.from(suppressed).slice(-300);
    suppressedAppNotificationIdsRef.current = new Set(trimmed);
    localStorage.setItem(suppressedAppNotificationsKey, JSON.stringify(trimmed));
  }

  function markSuppressedAppNotificationsRead(ids: string[]) {
    if (!ids.length || !sessionToken) return;
    void fetch("/api/app-notifications/read", {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
  }

  const pushBrowserNotification = useCallback((item: AppNotificationSummary) => {
    if (!browserNotificationsEnabledRef.current) return;
    if (localStorage.getItem(browserNotificationsEnabledKey) === "false") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (pageActiveRef.current) return;
    if (notificationMatchesCurrentSession(item) && document.visibilityState === "visible") return;
    try {
      const notification = new Notification(item.title, {
        body: item.message,
        tag: item.id,
      });
      browserNotificationInstancesRef.current.set(item.id, notification);
      notification.onclose = () => browserNotificationInstancesRef.current.delete(item.id);
    } catch {
      // Browser notification support can be blocked by runtime policy.
    }
  }, [notificationMatchesCurrentSession]);

  const applyAppNotifications = useCallback((result: AppNotificationsResponse, options: { desktop?: boolean } = {}) => {
    const knownIds = appNotificationIdsRef.current;
    const suppressedNow = result.items.filter((item) => !suppressedAppNotificationIdsRef.current.has(item.id) && shouldSuppressAppNotification(item));
    if (suppressedNow.length) {
      rememberSuppressedAppNotifications(suppressedNow.map((item) => item.id));
      markSuppressedAppNotificationsRead(suppressedNow.filter((item) => !item.readAt).map((item) => item.id));
    }
    const suppressedIds = suppressedAppNotificationIdsRef.current;
    const visibleItems = result.items.filter((item) => !suppressedIds.has(item.id));
    const suppressedUnreadCount = result.items.filter((item) => suppressedIds.has(item.id) && !item.readAt).length;
    const newUnread = visibleItems
      .filter((item) => !knownIds.has(item.id) && !item.readAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setAppNotifications(visibleItems);
    setAppNotificationUnreadCount(Math.max(0, result.unreadCount - suppressedUnreadCount));
    result.items.forEach((item) => knownIds.add(item.id));
    if (options.desktop && appNotificationsReadyRef.current) newUnread.forEach(pushBrowserNotification);
    appNotificationsReadyRef.current = true;
  }, [pushBrowserNotification, sessionToken, shouldSuppressAppNotification]);

  const loadAppNotifications = useCallback(async (options: { desktop?: boolean } = {}) => {
    if (!sessionToken) return;
    const response = await fetch("/api/app-notifications?limit=30", {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const result = await response.json() as AppNotificationsResponse;
    applyAppNotifications(result, options);
  }, [applyAppNotifications, sessionToken]);

  async function markAppNotificationsRead(ids?: string[]) {
    const response = await fetch("/api/app-notifications/read", {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(ids ? { ids } : { all: true }),
    });
    if (!response.ok) return;
    const result = await response.json() as AppNotificationsResponse;
    setAppNotifications(result.items);
    setAppNotificationUnreadCount(result.unreadCount);
  }

  async function clearAppNotifications() {
    const confirmed = await dialog.confirm({
      title: t("notificationCenter.clearConfirm"),
      message: t("notificationCenter.clearMessage"),
      confirmLabel: t("notificationCenter.clear"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch("/api/app-notifications", {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setAppNotifications([]);
    setAppNotificationUnreadCount(0);
  }

  async function requestBrowserNotifications() {
    if (typeof Notification === "undefined") {
      notify(t("notificationCenter.browserUnsupported"), "error");
      return;
    }
    const permission = await Notification.requestPermission();
    setBrowserNotificationPermission(permission);
    notify(permission === "granted" ? t("notificationCenter.browserGranted") : t("notificationCenter.browserDenied"), permission === "granted" ? "success" : "error");
  }

  function changeBrowserNotificationsEnabled(enabled: boolean) {
    browserNotificationsEnabledRef.current = enabled;
    localStorage.setItem(browserNotificationsEnabledKey, enabled ? "true" : "false");
    setBrowserNotificationsEnabled(enabled);
    if (!enabled) {
      for (const notification of browserNotificationInstancesRef.current.values()) notification.close();
      browserNotificationInstancesRef.current.clear();
    }
    if (enabled && browserNotificationPermission !== "granted") void requestBrowserNotifications();
  }

  useEffect(() => {
    browserNotificationsEnabledRef.current = browserNotificationsEnabled;
  }, [browserNotificationsEnabled]);

  useEffect(() => {
    function handleBrowserNotificationStorage(event: StorageEvent) {
      if (event.key !== browserNotificationsEnabledKey) return;
      const enabled = event.newValue !== "false";
      browserNotificationsEnabledRef.current = enabled;
      setBrowserNotificationsEnabled(enabled);
      if (!enabled) {
        for (const notification of browserNotificationInstancesRef.current.values()) notification.close();
        browserNotificationInstancesRef.current.clear();
      }
    }
    window.addEventListener("storage", handleBrowserNotificationStorage);
    return () => window.removeEventListener("storage", handleBrowserNotificationStorage);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    function syncPageActive() {
      if (document.visibilityState !== "visible") {
        pageActiveRef.current = false;
        return;
      }
      pageActiveRef.current = typeof document.hasFocus === "function" ? document.hasFocus() : true;
    }
    function handleFocus() {
      pageActiveRef.current = document.visibilityState === "visible";
    }
    function handleBlur() {
      pageActiveRef.current = false;
    }
    syncPageActive();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", syncPageActive);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", syncPageActive);
    };
  }, []);

  useEffect(() => {
    appNotificationsReadyRef.current = false;
    appNotificationIdsRef.current = new Set();
    if (!sessionToken) return;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = 2500;
    let closed = false;
    const eventUrl = `/api/app-notifications/events?${new URLSearchParams({ token: sessionToken })}`;
    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(eventUrl);
      source.addEventListener("snapshot", (event) => {
        reconnectDelay = 2500;
        const result = JSON.parse((event as MessageEvent).data) as AppNotificationStreamEvent;
        if (result.type === "snapshot") applyAppNotifications(result, { desktop: true });
      });
      source.addEventListener("notification", (event) => {
        reconnectDelay = 2500;
        const result = JSON.parse((event as MessageEvent).data) as AppNotificationStreamEvent;
        if (result.type !== "notification") return;
        const knownIds = appNotificationIdsRef.current;
        if (
          result.notification.eventType === "needs_approval"
          && result.notification.sourceType === "approval"
          && !knownIds.has(result.notification.id)
        ) {
          rememberPendingApprovalId(result.notification.sourceId);
        }
        if (shouldSuppressAppNotification(result.notification)) {
          rememberSuppressedAppNotifications([result.notification.id]);
          if (!result.notification.readAt) markSuppressedAppNotificationsRead([result.notification.id]);
          knownIds.add(result.notification.id);
          appNotificationsReadyRef.current = true;
          return;
        }
        if (suppressedAppNotificationIdsRef.current.has(result.notification.id)) return;
        const isNewUnread = !knownIds.has(result.notification.id) && !result.notification.readAt;
        setAppNotifications((items) => [result.notification, ...items.filter((item) => item.id !== result.notification.id)].slice(0, 30));
        setAppNotificationUnreadCount(result.unreadCount);
        knownIds.add(result.notification.id);
        if (isNewUnread && appNotificationsReadyRef.current) pushBrowserNotification(result.notification);
        appNotificationsReadyRef.current = true;
      });
      source.addEventListener("ping", () => {
        reconnectDelay = 2500;
      });
      source.onerror = () => {
        source?.close();
        if (closed) return;
        const delay = reconnectDelay;
        reconnectDelay = Math.min(Math.round(reconnectDelay * 1.6), 15_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [applyAppNotifications, pushBrowserNotification, rememberPendingApprovalId, sessionToken, shouldSuppressAppNotification]);

  const resetToLogin = useCallback((nextAuth?: AuthState) => {
    void fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem("codex-web-session");
    setSessionToken("");
    setAuth(nextAuth ?? {
      authenticated: false,
      setupRequired: false,
      needsOtp: true,
      user: null,
    });
    navigate("auth");
  }, []);

  useEffect(() => {
    function handleHashChange() {
      if (auth.authenticated) applyHashRoute();
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [auth.authenticated]);

  const loadAppData = useCallback(async (token = sessionToken) => {
    if (!token) return;
    const headers = { authorization: `Bearer ${token}` };
    async function getJson<T>(url: string) {
      const response = await fetch(url, { headers });
      if (response.status === 401) {
        resetToLogin();
        throw new Error("unauthorized");
      }
      if (!response.ok) throw new Error(`request_failed:${url}`);
      return response.json() as Promise<T>;
    }
    const [nextSessions, nextProjects, nextProviders, nextAutomations, nextApprovals] = await Promise.all([
      getJson<PageResponse<SessionSummary>>("/api/sessions?limit=30"),
      getJson<ProjectSummary[]>("/api/projects"),
      getJson<ProviderSummary[]>("/api/providers"),
      getJson<AutomationSummary[]>("/api/automations"),
      getJson<PageResponse<ApprovalSummary>>("/api/approvals?status=pending&limit=1"),
    ]);
    if (!Array.isArray(nextSessions.items) || !Array.isArray(nextProjects) || !Array.isArray(nextProviders) || !Array.isArray(nextAutomations)) {
      throw new Error("invalid_app_data");
    }
    setSessions(nextSessions.items);
    setSessionCursor(nextSessions.nextCursor);
    setSessionHasMore(nextSessions.hasMore);
    setProjects(nextProjects);
    setProviders(nextProviders);
    setAutomations(nextAutomations);
    pendingApprovalIdsRef.current = new Set(nextApprovals.items.map((item) => item.id));
    setPendingApprovalsCount(nextApprovals.items.length + (nextApprovals.hasMore ? 1 : 0));
    if (activeSessionId && !nextSessions.items.some((session) => session.id === activeSessionId)) void ensureSessionLoaded(activeSessionId, token);
    if (!selectedProviderId && nextProviders[0]) setSelectedProviderId(nextProviders[0].id);
  }, [activeSessionId, resetToLogin, selectedProviderId, sessionToken]);

  async function ensureSessionLoaded(sessionId: string, token = sessionToken) {
    if (!sessionId || sessions.some((session) => session.id === sessionId) || !token) return;
    const response = await fetch(`/api/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setActiveSessionId("");
      if (routeFromHash().page === "sessions") window.location.hash = "sessions";
      return;
    }
    const session = (await response.json()) as SessionSummary;
    setSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
  }

  async function loadSessionPage(options: { reset?: boolean; search?: string; projectId?: string; status?: string } = {}) {
    if (!sessionToken) return;
    const reset = options.reset ?? false;
    const search = options.search ?? sessionSearch;
    const projectId = options.projectId ?? sessionProjectFilter;
    const status = options.status ?? sessionStatusFilter;
    const params = new URLSearchParams({ limit: "30" });
    if (!reset && sessionCursor) params.set("cursor", sessionCursor);
    if (search.trim()) params.set("q", search.trim());
    if (projectId !== "all") params.set("projectId", projectId);
    if (status !== "all") params.set("status", status);
    const response = await fetch(`/api/sessions?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<SessionSummary>;
    setSessions((items) => reset ? page.items : [...items, ...page.items.filter((session) => !items.some((item) => item.id === session.id))]);
    setSessionCursor(page.nextCursor);
    setSessionHasMore(page.hasMore);
  }

  const handleTaskDetail = useCallback((detail: CodexTaskDetail) => {
    setTaskDetails((items) => ({ ...items, [detail.session.id]: detail }));
    setOptimisticMessages((items) => {
      const serverMessages = new Set(detail.messages.map((message) => `${message.role}:${message.content}`));
      const pending = (items[detail.session.id] ?? []).filter((message) => !serverMessages.has(`${message.role}:${message.content}`));
      return { ...items, [detail.session.id]: pending };
    });
    setSessions((items) => {
      const current = items.find((item) => item.id === detail.session.id);
      if (
        current &&
        current.status === detail.session.status &&
        current.updatedAt === detail.session.updatedAt &&
        current.codexSessionId === detail.session.codexSessionId
      ) {
        return items;
      }
      return items.map((item) => item.id === detail.session.id ? detail.session : item);
    });
  }, []);

  async function createCodexTask(prompt: string, projectId: string | null, providerId: string | null, model: string | null, ephemeralNotifications?: CreateCodexTaskRequest["ephemeralNotifications"], attachments?: UploadAttachmentInput[], displayPrompt = prompt) {
    const body: CreateCodexTaskRequest = {
      prompt,
      projectId,
      providerId,
      model,
      ephemeralNotifications,
      attachments,
    };
    const response = await fetch("/api/codex/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const session = (await response.json()) as SessionSummary;
    setSessions((items) => [session, ...items.filter((item) => item.id !== session.id)]);
    setTaskDetails((items) => ({
      ...items,
      [session.id]: {
        session,
        messages: [localUserMessage(displayPrompt)],
        output: "",
        exitCode: null,
      },
    }));
    navigateSession(session.id);
  }

  function newTask() {
    setDraftTaskProjectId(null);
    setSessionNavOpen(false);
    navigate("sessions");
  }

  async function stopCodexTask(sessionId: string) {
    const response = await fetch(`/api/codex/tasks/${sessionId}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextSession = (await response.json()) as SessionSummary;
    setSessions((items) => items.map((item) => item.id === nextSession.id ? nextSession : item));
  }

  async function continueCodexTask(sessionId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null, attachments?: UploadAttachmentInput[], displayPrompt = prompt) {
    const body: ContinueCodexTaskRequest = { prompt, providerId, model, replyToMessageId, attachments };
    const response = await fetch(`/api/codex/tasks/${sessionId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    if (response.status === 202) {
      const queued = (await response.json()) as QueuedMessage;
      setMessageQueues((items) => ({
        ...items,
        [sessionId]: [...(items[sessionId] ?? []).filter((item) => item.id !== queued.id), queued],
      }));
      navigateSession(sessionId);
      return;
    }
    setOptimisticMessages((items) => ({
      ...items,
      [sessionId]: [...(items[sessionId] ?? []), localUserMessage(displayPrompt)],
    }));
    const nextSession = (await response.json()) as SessionSummary;
    setSessions((items) => items.map((item) => item.id === nextSession.id ? nextSession : item));
    navigateSession(nextSession.id);
  }

  async function recoverCodexTask(sessionId: string, prompt: string, providerId: string | null, model: string | null) {
    const body: RecoverCodexTaskRequest = { prompt, providerId, model };
    const response = await fetch(`/api/codex/tasks/${sessionId}/recover`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const detail = (await response.json()) as CodexTaskDetail;
    handleTaskDetail(detail);
    setSessions((items) => items.map((item) => item.id === detail.session.id ? detail.session : item));
    navigateSession(detail.session.id);
  }

  async function updateQueuedMessage(sessionId: string, queueId: string, prompt: string, providerId: string | null, model: string | null, replyToMessageId?: string | null) {
    const body: UpdateQueuedMessageRequest = { prompt, providerId, model, replyToMessageId };
    const response = await fetch(`/api/codex/tasks/${sessionId}/queue/${queueId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    const updated = (await response.json()) as QueuedMessage;
    setMessageQueues((items) => ({
      ...items,
      [sessionId]: (items[sessionId] ?? []).map((item) => item.id === updated.id ? updated : item),
    }));
  }

  async function reorderQueuedMessages(sessionId: string, orderedIds: string[]) {
    const body: ReorderQueuedMessagesRequest = { orderedIds };
    const previousQueue = messageQueues[sessionId] ?? [];
    const optimisticQueue = orderedIds
      .map((id) => previousQueue.find((item) => item.id === id))
      .filter((item): item is QueuedMessage => Boolean(item));
    if (optimisticQueue.length === previousQueue.length) {
      setMessageQueues((items) => ({ ...items, [sessionId]: optimisticQueue }));
    }
    const response = await fetch(`/api/codex/tasks/${sessionId}/queue`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessageQueues((items) => ({ ...items, [sessionId]: previousQueue }));
      return;
    }
    const queue = (await response.json()) as QueuedMessage[];
    setMessageQueues((items) => ({ ...items, [sessionId]: queue }));
  }

  async function deleteQueuedMessage(sessionId: string, queueId: string) {
    const response = await fetch(`/api/codex/tasks/${sessionId}/queue/${queueId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setMessageQueues((items) => ({
      ...items,
      [sessionId]: (items[sessionId] ?? []).filter((item) => item.id !== queueId),
    }));
  }

  async function deleteSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const canDeleteWorkspace = !session.projectId;
    const decision = await dialog.confirmWithCheckbox({
      title: t("session.deleteSession"),
      message: t("session.deleteMessage").replace("{title}", session.title).replace("{note}", canDeleteWorkspace ? t("session.deleteDataHint") : t("session.deleteLogsHint")),
      confirmLabel: t("session.deleteSession"),
      checkboxLabel: t("session.deleteData"),
      checkboxDefaultChecked: true,
      danger: true,
    });
    if (!decision.confirmed) return;
    const deleteWorkspace = canDeleteWorkspace && decision.checked;
    const deleteLogs = decision.checked;
    const response = await fetch(`/api/sessions/${sessionId}?${new URLSearchParams({ deleteLogs: String(deleteLogs), deleteWorkspace: String(deleteWorkspace) })}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    setTaskDetails((items) => {
      const next = { ...items };
      delete next[sessionId];
      return next;
    });
    setSessions((items) => items.filter((item) => item.id !== sessionId));
    navigate("sessions");
  }

  useEffect(() => {
    const requestId = authRequestRef.current + 1;
    authRequestRef.current = requestId;
    setAuthChecked(false);
    fetch("/api/auth/state", {
      headers: sessionToken ? { authorization: `Bearer ${sessionToken}` } : {},
    })
      .then((response) => response.json())
      .then((nextAuth: AuthState) => {
        if (authRequestRef.current !== requestId) return;
        setAuth(nextAuth);
        if (!nextAuth.authenticated) {
          resetToLogin(nextAuth);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (authRequestRef.current === requestId) setAuthChecked(true);
    });
  }, [resetToLogin, sessionToken]);

  useEffect(() => {
    if (!auth.authenticated || !sessionToken) return;
    loadAppData().catch(() => undefined);
  }, [auth.authenticated, loadAppData, sessionToken]);

  useEffect(() => {
    if (!auth.authenticated || !sessionToken || !activeSessionId || activeSession) return;
    void ensureSessionLoaded(activeSessionId);
  }, [activeSession, activeSessionId, auth.authenticated, sessionToken]);

  if (!authChecked) {
    return <div className="auth-shell"><div className="auth-panel"><strong>{t("auth.checking")}</strong></div></div>;
  }

  if (!auth.authenticated) {
    return (
      <AuthPage
        t={t}
        locale={locale}
        onLocaleChange={changeLocale}
        auth={auth}
        notify={notify}
        onLogin={async (token, nextAuth) => {
          authRequestRef.current += 1;
          localStorage.setItem("codex-web-session", token);
          setSessionToken(token);
          setAuth(nextAuth);
          setAuthChecked(true);
          applyHashRoute();
          await loadAppData(token).catch(() => undefined);
        }}
      />
    );
  }

  const notificationCenterNode = (
    <NotificationCenter
      items={appNotifications}
      unreadCount={appNotificationUnreadCount}
      open={notificationCenterOpen}
      permission={browserNotificationPermission}
      browserNotificationsEnabled={browserNotificationsEnabled}
      t={t}
      onToggle={() => {
        setNotificationCenterOpen((value) => !value);
        void loadAppNotifications();
      }}
      onClose={() => setNotificationCenterOpen(false)}
      onMarkRead={(ids) => void markAppNotificationsRead(ids)}
      onClear={() => void clearAppNotifications()}
      onRequestBrowser={() => void requestBrowserNotifications()}
      onBrowserNotificationsEnabledChange={changeBrowserNotificationsEnabled}
      onOpenSession={navigateSession}
    />
  );

  return (
    <NotificationCenterContext.Provider value={notificationCenterNode}>
    <div className={`app ${page === "sessions" ? "task-layout" : "wide-layout"}`}>
      {dialog.node}
      <ToastViewport toast={toast} onClose={() => setToast(null)} t={t} />
      <div className={`main-nav-drawer ${mainNavOpen ? "open" : ""}`}>
        <button className="drawer-backdrop" type="button" aria-label={t("session.closeMainNav")} onClick={() => setMainNavOpen(false)} />
      </div>
      <aside className={`rail ${mainNavOpen ? "open" : ""}`}>
        <div className="logo">C</div>
        <div className="mobile-nav-head">
          <strong>Codex Web</strong>
          <button className="drawer-close" type="button" onClick={() => setMainNavOpen(false)} title={t("action.close")}>
            <X size={16} />
          </button>
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <button
              className={`rail-button ${page === item.page ? "active" : ""} ${item.page === "auth" ? "auth-button" : ""}`}
              key={item.page}
              onClick={() => navigate(item.page)}
              title={label}
            >
              <Icon size={16} />
              <em>{label}</em>
              {item.page === "approvals" && pendingApprovalsCount > 0 && <span className="nav-badge">{pendingApprovalsCount}</span>}
            </button>
          );
        })}
        <LanguageSelect locale={locale} onChange={changeLocale} compact />
      </aside>

      {page === "sessions" && (
        <div className={`sessions-drawer ${sessionNavOpen ? "open" : ""}`}>
          <button className="drawer-backdrop" type="button" aria-label={t("session.closeSessionList")} onClick={() => setSessionNavOpen(false)} />
          <Threads
            sessions={visibleSessions}
            projects={projects}
            providers={providers}
            unreadSessionIds={unreadSessionNotificationIds}
            selectedProviderId={selectedProviderId}
            onSelectProvider={setSelectedProviderId}
            activeSessionId={activeSessionId}
            onSelectSession={navigateSession}
            onNewTask={newTask}
            search={sessionSearch}
            onSearch={(value) => {
              setSessionSearch(value);
              void loadSessionPage({ reset: true, search: value });
            }}
            projectFilter={sessionProjectFilter}
            onProjectFilter={(value) => {
              setSessionProjectFilter(value);
              void loadSessionPage({ reset: true, projectId: value });
            }}
            statusFilter={sessionStatusFilter}
            onStatusFilter={(value) => {
              setSessionStatusFilter(value);
              void loadSessionPage({ reset: true, status: value });
            }}
            hasMore={sessionHasMore}
            onLoadMore={() => void loadSessionPage()}
            onClose={() => setSessionNavOpen(false)}
            t={t}
          />
        </div>
      )}
      {page === "sessions" && (routeSessionPending ? <SessionLoadingPage t={t} onOpenMainNav={() => setMainNavOpen(true)} onOpenSessionNav={() => setSessionNavOpen(true)} /> : <SessionPage sessionToken={sessionToken} t={t} notify={notify} session={activeSession} project={activeSession ? projects.find((project) => project.id === activeSession.projectId) : projects.find((project) => project.id === draftTaskProjectId)} projects={projects} draftProjectId={draftTaskProjectId} onDraftProjectId={setDraftTaskProjectId} providers={providers} selectedProviderId={selectedProviderId} onSelectProvider={setSelectedProviderId} taskDetail={activeSession ? taskDetails[activeSession.id] : undefined} optimisticMessages={activeSession ? optimisticMessages[activeSession.id] ?? [] : []} queuedMessages={activeSession ? messageQueues[activeSession.id] ?? [] : []} onQueueChange={(sessionId, queue) => setMessageQueues((items) => ({ ...items, [sessionId]: queue }))} onTaskDetail={handleTaskDetail} onSubmitTask={createCodexTask} onContinueTask={continueCodexTask} onRecoverTask={recoverCodexTask} onUpdateQueuedMessage={updateQueuedMessage} onReorderQueuedMessages={reorderQueuedMessages} onDeleteQueuedMessage={deleteQueuedMessage} onStopTask={stopCodexTask} onDeleteSession={deleteSession} onSessionUpdated={(nextSession) => setSessions((items) => items.map((item) => item.id === nextSession.id ? nextSession : item))} onOpenSession={navigateSession} onOpenMainNav={() => setMainNavOpen(true)} onOpenSessionNav={() => setSessionNavOpen(true)} />)}
      {page === "sessions" && <ContextPanel sessionToken={sessionToken} session={activeSession} taskDetail={activeSession ? taskDetails[activeSession.id] : undefined} queuedMessages={activeSession ? messageQueues[activeSession.id] ?? [] : []} onUpdateQueuedMessage={updateQueuedMessage} onReorderQueuedMessages={reorderQueuedMessages} onDeleteQueuedMessage={deleteQueuedMessage} t={t} onOpenFile={(path) => {
        const params = new URLSearchParams({ path });
        if (activeSession?.workspacePath) {
          params.set("rootPath", activeSession.workspacePath);
          params.set("mountName", activeSession.title || "Session Workspace");
        }
        window.location.hash = `files?${params}`;
        setPage("files");
      }} />}
      {page === "files" && <FilesPage sessionToken={sessionToken} t={t} onOpenMainNav={() => setMainNavOpen(true)} TerminalComponent={TerminalPage} />}
      {page === "terminal" && <TerminalPage sessionToken={sessionToken} t={t} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "previews" && <PreviewsPage sessionToken={sessionToken} projects={projects} sessions={visibleSessions} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "projects" && <ProjectsPage sessionToken={sessionToken} projects={projects} sessions={visibleSessions} notify={notify} onOpenSession={navigateSession} onNewProjectSession={(projectId) => {
        setDraftTaskProjectId(projectId);
        setActiveSessionId("");
        navigate("sessions");
      }} onAnalyzeProjectCheck={async (project, result) => {
        const prompt = [
          t("project.analyzePromptIntro").replace("{name}", project.name),
          t("project.analyzePromptCommand").replace("{command}", result.command),
          t("project.analyzePromptExitCode").replace("{exitCode}", String(result.exitCode ?? "null")),
          "stdout:",
          result.stdout || "(empty)",
          "stderr:",
          result.stderr || "(empty)",
        ].join("\n");
        await createCodexTask(prompt, project.id, selectedProviderId || null, null);
        navigate("sessions");
      }} onChange={loadAppData} t={t} onOpenMainNav={() => setMainNavOpen(true)} TerminalComponent={TerminalPage} />}
      {page === "contacts" && <ContactsPage sessionToken={sessionToken} t={t} locale={locale} notify={notify} providers={providers} projects={projects} onOpenSession={navigateSession} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "extensions" && <ExtensionsPage sessionToken={sessionToken} title={t("nav.extensions")} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} TerminalComponent={TerminalPage} />}
      {page === "automations" && <AutomationsPage sessionToken={sessionToken} automations={automations} projects={projects} providers={providers} onChange={loadAppData} onOpenSession={navigateSession} title={t("nav.automations")} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "providers" && <ProvidersPage sessionToken={sessionToken} providers={providers} onChange={loadAppData} t={t} notify={notify} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "approvals" && <ApprovalsPage sessionToken={sessionToken} t={t} notify={notify} onPendingChange={setPendingApprovalsCount} onOpenMainNav={() => setMainNavOpen(true)} />}
      {page === "settings" && <SettingsPage sessionToken={sessionToken} t={t} locale={locale} onOpenSession={navigateSession} onOpenMainNav={() => setMainNavOpen(true)} onSessionRefresh={(token, nextAuth) => {
        localStorage.setItem("codex-web-session", token);
        setSessionToken(token);
        setAuth(nextAuth);
      }} onLogout={() => resetToLogin()} notify={notify} onApprovalRequired={(approval) => rememberPendingApprovalId(approval.id)} />}
    </div>
    </NotificationCenterContext.Provider>
  );
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function AuthPage({
  auth,
  locale,
  t,
  onLocaleChange,
  onLogin,
  notify,
}: {
  auth: AuthState;
  locale: Locale;
  t: TFunction;
  onLocaleChange: (locale: Locale) => void;
  onLogin: (token: string, auth: AuthState) => void | Promise<void>;
  notify: (message: string, tone?: ToastTone) => void;
}) {
  const [setup, setSetup] = useState<SetupStartResponse | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [confirmAccessToken, setConfirmAccessToken] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  function showAuthError(value: string) {
    setError(value);
    notify(value, "error");
  }

  useEffect(() => {
    if (!auth.setupRequired) return;
    fetch("/api/auth/setup/start", { method: "POST" })
      .then((response) => response.json())
      .then((nextSetup: SetupStartResponse) => setSetup(nextSetup))
      .catch(() => showAuthError(t("settings.otpResetFailed")));
  }, [auth.setupRequired]);

  useEffect(() => {
    if (!setup?.otpauthUrl) return;
    QRCode.toDataURL(setup.otpauthUrl, {
      margin: 1,
      width: 192,
      color: {
        dark: "#191d1b",
        light: "#ffffff",
      },
    })
      .then(setQrCode)
      .catch(() => showAuthError(t("settings.otpResetFailed")));
  }, [setup?.otpauthUrl]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (auth.setupRequired && accessToken !== confirmAccessToken) {
      showAuthError(t("auth.tokenMismatch"));
      return;
    }
    const response = await fetch(auth.setupRequired ? "/api/auth/setup/complete" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken, otp }),
    });
    const result = (await response.json()) as LoginResponse;
    if (!response.ok || !result.ok || !result.sessionToken) {
      showAuthError(result.error ?? t("auth.loginFailed"));
      return;
    }
    await onLogin(result.sessionToken, result.auth);
  }

  async function copyOtpSecret() {
    if (!setup?.otpSecret) return;
    const copied = await copyText(setup.otpSecret);
    setCopyMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    window.setTimeout(() => setCopyMessage(""), 1600);
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-heading">
          <div className="crumb">Codex Web</div>
          <h1>{auth.setupRequired ? t("auth.firstSetup") : t("auth.login")}</h1>
          <LanguageSelect locale={locale} onChange={onLocaleChange} />
        </div>
      <form className="auth-card" onSubmit={login}>
        {auth.setupRequired && (
          <div>
            <strong>{t("auth.otpSecret")}</strong>
            {qrCode && <img className="otp-qr" src={qrCode} alt={t("auth.otpQrAlt")} />}
            <div className="secret-row">
              <code className="secret-box">{setup?.otpSecret ?? t("auth.generating")}</code>
              <button className="ghost-button" type="button" onClick={copyOtpSecret} disabled={!setup?.otpSecret}>{t("action.copy")}</button>
            </div>
            {copyMessage && <span className="subtle">{copyMessage}</span>}
            <span className="subtle">{t("auth.otpHelp")}</span>
          </div>
        )}
        <div><strong>{auth.setupRequired ? t("auth.setupToken") : t("auth.accessToken")}</strong><input name="accesstoken-2" className="search-input" type="password" autoComplete="current-password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("auth.tokenPlaceholder")} /></div>
        {auth.setupRequired && (
          <div><strong>{t("auth.confirmToken")}</strong><input name="confirmaccesstoken-2" className="search-input" type="password" autoComplete="new-password" value={confirmAccessToken} onChange={(event) => setConfirmAccessToken(event.target.value)} placeholder={t("auth.confirmTokenPlaceholder")} /></div>
        )}
        <div><strong>{t("auth.otp")}</strong><input name="otp" className="search-input" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder={t("auth.otpPlaceholder")} /></div>
        {error && <div className="auth-error">{error}</div>}
        <button className="dark-button">{auth.setupRequired ? t("action.setup") : t("action.login")}</button>
      </form>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
