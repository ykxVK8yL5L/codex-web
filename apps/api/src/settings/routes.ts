import type { Hono } from "hono";
import type {
  ApprovalDecisionResponse,
  CodexRuntimeSettings,
  PreviewAccessSettings,
  PayloadRewriteSettings,
  PreviewSummary,
  ProjectGitOperationSummary,
  ProjectGitOperationType,
  RateLimitSettings,
  RoomRunMergeResponse,
  SystemBackupPreviewResponse,
  SystemRestoreResponse,
  TokenUsageDisplaySettings,
  TokenUsageRetentionSettings,
  UpdateCodexRuntimeSettingsRequest,
  UpdateNotificationTestSettingsRequest,
  UpdatePayloadRewriteSettingsRequest,
  UpdateSessionCompactionSettingsRequest,
  UpdateSystemBackupSettingsRequest,
} from "@codex-web/protocol";
import { parsePageLimit } from "../pagination.js";

type PreviewRecord = Omit<PreviewSummary, "url"> & { token: string };

type SettingsRoutesDeps = Record<string, any>;

export function registerSettingsRoutes(app: Hono, deps: SettingsRoutesDeps) {
  const {
    appData,
    applyRoomRunMerge,
    archiveExcluder,
    createRoomDecision,
    createZipArchive,
    createZipArchiveWithEntries,
    db,
    deleteProjectRecord,
    applyCodexRuntimeSettings,
    archiveApproval,
    backupTimestamp,
    cleanupDatabaseRedundancy,
    codexRuntimeDetails,
    codexRuntimeRisk,
    createApproval,
    createSystemBackupArchive,
    getApproval,
    getCodexRuntimeSettings,
    getPreviewAccessRequests,
    getPreviewAccessSettings,
    getRateLimitSettings,
    getSessionCompactionSettings,
    getSystemBackupSettings,
    listApprovalGrants,
    listApprovals,
    listArchiveIgnoreTemplates,
    listTaskHealth,
    dirname,
    dataDir,
    emitExternalNotification,
    expirePreviewAccessRequests,
    join,
    mkdirSync,
    parseStoredZipArchive,
    previewZipArchive,
    publicApproval,
    publicPreview,
    readBackupUpload,
    readSystemBackupArchive,
    rateLimitStore,
    registerAppNotificationRoutes,
    registerEnvironmentRoutes,
    registerNotificationAccountRoutes,
    registerNotificationBaseRoutes,
    registerNotificationRecipientRoutes,
    registerNotificationRuleRoutes,
    registerStorageRoutes,
    registerWebhookRoutes,
    repairTaskHealth,
    restoreApproval,
    resolveApproval,
    runtimeSettingsStore,
    runProjectGitOperation,
    sanitizeNotificationTestSettings,
    sanitizeSystemBackupSettings,
    saveApprovalGrant,
    saveNotificationTestSettings,
    saveSystemBackupSettings,
    startPreviewProcess,
    setCodexRuntimeSettings,
    setNotificationTestSettings,
    setPreviewAccessSettings,
    setRateLimitSettings,
    setSessionCompactionSettings,
    setSystemBackupSettings,
    approvalAlwaysAllowed,
    pathWithinRoot,
    rmSync,
    systemBackupPreviewFromArchive,
    updatePreview,
    upsertPreviewAccessRequest,
    writeFileSync,
  } = deps;
  let codexRuntimeSettings = getCodexRuntimeSettings();
  let previewAccessSettings = getPreviewAccessSettings();
  const previewAccessRequests = getPreviewAccessRequests();
  let rateLimitSettings = getRateLimitSettings();
  let sessionCompactionSettings = getSessionCompactionSettings();
  let tokenUsageRetentionSettings = deps.getTokenUsageRetentionSettings() as TokenUsageRetentionSettings;
  let tokenUsageDisplaySettings = deps.getTokenUsageDisplaySettings() as TokenUsageDisplaySettings;
  let payloadRewriteSettings = deps.getPayloadRewriteSettings() as PayloadRewriteSettings;
  let systemBackupSettings = getSystemBackupSettings();
  let notificationTestSettings = deps.getNotificationTestSettings();
  const appNotificationRouteDeps = deps.getAppNotificationRouteDeps();
  const environmentRouteDeps = deps.getEnvironmentRouteDeps();
  const notificationBaseRouteDeps = deps.getNotificationBaseRouteDeps();
  const storageRouteDeps = deps.getStorageRouteDeps();
  const webhookRouteDeps = deps.getWebhookRouteDeps();
  const previews = deps.getPreviews() as Map<string, PreviewRecord>;
  app.post("/api/settings/maintenance/cleanup", async (c) => {
    const body = await c.req.json<{ deleteArchivedApprovals?: boolean; archivedApprovalRetentionDays?: number; deleteApprovalAuditLog?: boolean }>().catch(() => ({}));
    return c.json(cleanupDatabaseRedundancy(body ?? {}));
  });
  
  app.get("/api/settings/task-health", (c) => {
    const health = listTaskHealth();
    if (!health.ok) {
      emitExternalNotification({
        eventType: "task_health_issue",
        severity: "error",
        title: "任务健康检查发现异常",
        message: health.items.filter((item: { issue?: unknown }) => item.issue).map((item: { title: string; issue?: string }) => `${item.title}: ${item.issue}`).join("\n") || "运行任务状态异常。",
        sourceType: "task-health",
        sourceId: health.checkedAt,
        metadata: { items: health.items.filter((item: { issue?: unknown }) => item.issue) },
      });
    }
    return c.json(health);
  });
  
  app.post("/api/settings/task-health/repair", (c) => c.json(repairTaskHealth()));
  
  app.post("/api/settings/approvals/reset", (c) => {
    const result = db.prepare("delete from approval_grants").run();
    return c.json({ ok: true, deletedGrants: result.changes });
  });
  
  app.get("/api/settings/preview-access", (c) => c.json(previewAccessSettings));
  
  app.patch("/api/settings/preview-access", async (c) => {
    const body = await c.req.json<Partial<PreviewAccessSettings>>().catch(() => null);
    const next = runtimeSettingsStore.previewAccess.sanitize({
      requestTtlMinutes: body?.requestTtlMinutes ?? previewAccessSettings.requestTtlMinutes,
      updatedAt: new Date().toISOString(),
    });
    previewAccessSettings = next;
    setPreviewAccessSettings(next);
    runtimeSettingsStore.previewAccess.save(next);
    expirePreviewAccessRequests();
    return c.json(next);
  });
  
  app.get("/api/settings/session-compaction", (c) => c.json(sessionCompactionSettings));
  
  app.patch("/api/settings/session-compaction", async (c) => {
    const body = await c.req.json<UpdateSessionCompactionSettingsRequest>().catch(() => null);
    const next = runtimeSettingsStore.sessionCompaction.sanitize({
      ...sessionCompactionSettings,
      ...(body ?? {}),
      updatedAt: new Date().toISOString(),
    });
    sessionCompactionSettings = next;
    setSessionCompactionSettings(next);
    runtimeSettingsStore.sessionCompaction.save(next);
    return c.json(next);
  });

  app.get("/api/settings/token-usage-retention", (c) => c.json(tokenUsageRetentionSettings));

  app.patch("/api/settings/token-usage-retention", async (c) => {
    const body = await c.req.json<Partial<TokenUsageRetentionSettings>>().catch(() => null);
    const next = runtimeSettingsStore.tokenUsageRetention.sanitize({
      ...tokenUsageRetentionSettings,
      ...(body ?? {}),
      updatedAt: new Date().toISOString(),
    });
    tokenUsageRetentionSettings = next;
    deps.setTokenUsageRetentionSettings(next);
    runtimeSettingsStore.tokenUsageRetention.save(next);
    return c.json(next);
  });

  app.get("/api/settings/token-usage-display", (c) => c.json(tokenUsageDisplaySettings));

  app.patch("/api/settings/token-usage-display", async (c) => {
    const body = await c.req.json<Partial<TokenUsageDisplaySettings>>().catch(() => null);
    const next = runtimeSettingsStore.tokenUsageDisplay.sanitize({
      ...tokenUsageDisplaySettings,
      ...(body ?? {}),
      updatedAt: new Date().toISOString(),
    });
    tokenUsageDisplaySettings = next;
    deps.setTokenUsageDisplaySettings(next);
    runtimeSettingsStore.tokenUsageDisplay.save(next);
    return c.json(next);
  });

  app.get("/api/settings/payload-rewrite", (c) => c.json(payloadRewriteSettings));

  app.patch("/api/settings/payload-rewrite", async (c) => {
    const body = await c.req.json<UpdatePayloadRewriteSettingsRequest>().catch(() => null);
    const next = runtimeSettingsStore.payloadRewrite.sanitize({
      ...payloadRewriteSettings,
      ...(body ?? {}),
      updatedAt: new Date().toISOString(),
    });
    payloadRewriteSettings = next;
    deps.setPayloadRewriteSettings(next);
    runtimeSettingsStore.payloadRewrite.save(next);
    return c.json(next);
  });
  
  app.get("/api/settings/rate-limit", (c) => c.json(rateLimitSettings));
  
  app.patch("/api/settings/rate-limit", async (c) => {
    const body = await c.req.json<Partial<RateLimitSettings>>().catch(() => null);
    const next = rateLimitStore.sanitize({
      ...rateLimitSettings,
      ...(body ?? {}),
      updatedAt: new Date().toISOString(),
    });
    rateLimitSettings = next;
    setRateLimitSettings(next);
    rateLimitStore.save(next);
    return c.json(next);
  });
  
  app.get("/api/settings/notification-test", (c) => c.json(notificationTestSettings));
  
  app.patch("/api/settings/notification-test", async (c) => {
    const body = await c.req.json<UpdateNotificationTestSettingsRequest>().catch(() => null);
    const next = sanitizeNotificationTestSettings({
      ...notificationTestSettings,
      ...(body ?? {}),
      updatedAt: new Date().toISOString(),
    });
    notificationTestSettings = next;
    setNotificationTestSettings(next);
    saveNotificationTestSettings(next);
    return c.json(next);
  });
  
  registerEnvironmentRoutes(app, environmentRouteDeps);
  
  registerNotificationBaseRoutes(app, notificationBaseRouteDeps);
  registerNotificationAccountRoutes(app, notificationBaseRouteDeps);
  registerNotificationRecipientRoutes(app, notificationBaseRouteDeps);
  registerNotificationRuleRoutes(app, notificationBaseRouteDeps);
  
  registerWebhookRoutes(app, webhookRouteDeps);
  
  registerAppNotificationRoutes(app, appNotificationRouteDeps);
  
  registerStorageRoutes(app, storageRouteDeps);
  
  app.get("/api/settings/backup", (c) => c.json(systemBackupSettings));
  
  app.patch("/api/settings/backup", async (c) => {
    const body = await c.req.json<UpdateSystemBackupSettingsRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_body" }, 400);
    systemBackupSettings = sanitizeSystemBackupSettings({ ...body, updatedAt: new Date().toISOString() });
    setSystemBackupSettings(systemBackupSettings);
    saveSystemBackupSettings(systemBackupSettings);
    return c.json(systemBackupSettings);
  });
  
  app.get("/api/settings/backup/preview", (c) => {
    try {
      const backup = createSystemBackupArchive();
      const response: SystemBackupPreviewResponse = {
        ok: true,
        manifest: backup.manifest,
        entries: backup.entries,
        files: backup.files,
        bytes: backup.bytes,
        restartRequired: false,
      };
      return c.json(response);
    } catch (error) {
      emitExternalNotification({
        eventType: "backup_failed",
        severity: "error",
        title: "备份预览失败",
        message: error instanceof Error ? error.message : "backup_preview_failed",
        sourceType: "backup",
        sourceId: "preview",
      });
      return c.json({ error: error instanceof Error ? error.message : "backup_preview_failed" }, 500);
    }
  });
  
  app.get("/api/settings/backup/download", (c) => {
    try {
      const backup = createSystemBackupArchive();
      const filename = `codex-web-system-backup-${backup.manifest.createdAt.replace(/[:.]/g, "-")}.zip`;
      c.header("content-type", "application/zip");
      c.header("content-disposition", `attachment; filename="${filename}"`);
      return c.body(backup.buffer);
    } catch (error) {
      emitExternalNotification({
        eventType: "backup_failed",
        severity: "error",
        title: "备份下载失败",
        message: error instanceof Error ? error.message : "backup_download_failed",
        sourceType: "backup",
        sourceId: "download",
      });
      return c.json({ error: error instanceof Error ? error.message : "backup_download_failed" }, 500);
    }
  });
  
  app.post("/api/settings/restore/preview", async (c) => {
    try {
      const buffer = await readBackupUpload(c);
      return c.json(systemBackupPreviewFromArchive(buffer));
    } catch (error) {
      emitExternalNotification({
        eventType: "restore_failed",
        severity: "error",
        title: "恢复预览失败",
        message: error instanceof Error ? error.message : "restore_preview_failed",
        sourceType: "restore",
        sourceId: "preview",
      });
      return c.json({ error: error instanceof Error ? error.message : "restore_preview_failed" }, 400);
    }
  });
  
  app.post("/api/settings/restore", async (c) => {
    try {
      const buffer = await readBackupUpload(c);
      const parsed = readSystemBackupArchive(buffer);
      if (!parsed.entries.length) return c.json({ error: "backup_has_no_app_data" }, 400);
      const beforeRestore = createSystemBackupArchive();
      const restoreBackupRoot = join(dirname(dataDir), "restore-backups");
      mkdirSync(restoreBackupRoot, { recursive: true });
      const backupBeforeRestorePath = join(restoreBackupRoot, `pre-restore-${backupTimestamp()}.zip`);
      writeFileSync(backupBeforeRestorePath, beforeRestore.buffer);
  
      try {
        db.pragma("wal_checkpoint(FULL)");
        db.close();
      } catch {
        // The API service must be restarted after restore, so failure to close cleanly is reported by the restart requirement.
      }
  
      rmSync(dataDir, { recursive: true, force: true });
      mkdirSync(dataDir, { recursive: true });
      for (const entry of parsed.entries) {
        const targetPath = join(dataDir, entry.relativePath);
        if (!pathWithinRoot(targetPath, dataDir)) throw new Error("invalid_backup_entry");
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, entry.data);
      }
  
      const response: SystemRestoreResponse = {
        ok: true,
        manifest: parsed.manifest,
        restoredAt: new Date().toISOString(),
        backupBeforeRestorePath,
        restartRequired: true,
        warnings: [
          ...parsed.manifest.warnings,
          "系统数据已还原到 apps/api/data。请通过终端重启 API 服务后再继续使用；无需重启前端或 Docker 容器。",
        ],
      };
      return c.json(response);
    } catch (error) {
      emitExternalNotification({
        eventType: "restore_failed",
        severity: "error",
        title: "系统恢复失败",
        message: error instanceof Error ? error.message : "restore_failed",
        sourceType: "restore",
        sourceId: "apply",
      });
      return c.json({ error: error instanceof Error ? error.message : "restore_failed" }, 400);
    }
  });
  
  app.get("/api/settings/codex-runtime", (c) => c.json(codexRuntimeSettings));
  
  app.patch("/api/settings/codex-runtime", async (c) => {
    const body = await c.req.json<UpdateCodexRuntimeSettingsRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_body" }, 400);
    const next = runtimeSettingsStore.codexRuntime.sanitize({
      ...codexRuntimeSettings,
      ...body,
      updatedAt: new Date().toISOString(),
    });
    const risk = codexRuntimeRisk(codexRuntimeSettings, next);
    if (risk) {
      if (approvalAlwaysAllowed("codex-runtime-update", next)) return c.json(applyCodexRuntimeSettings(next));
      const approval = createApproval({
        actionType: "codex-runtime-update",
        risk,
        title: "Codex execution permission change",
        description: risk === "critical"
          ? "Enable Codex sandbox and approval bypass for new tasks."
          : "Enable full filesystem access for new Codex tasks.",
        details: codexRuntimeDetails(next),
        payload: next,
      });
      return c.json({ error: "approval_required", approval: publicApproval(approval) }, 409);
    }
    return c.json(applyCodexRuntimeSettings(next));
  });
  
  app.get("/api/approvals", (c) => {
    expirePreviewAccessRequests();
    const status = c.req.query("status");
    if (status && !["pending", "approved", "denied"].includes(status)) return c.json({ error: "invalid_status" }, 400);
    const archived = c.req.query("archived") === "true";
    const page = listApprovals(status, archived, parsePageLimit(c.req.query("limit")), c.req.query("cursor"));
    return c.json({ ...page, items: page.items.map(publicApproval) });
  });
  
  app.get("/api/approval-grants", (c) => c.json(listApprovalGrants(parsePageLimit(c.req.query("limit")), c.req.query("cursor"))));
  
  app.delete("/api/approval-grants/:id", (c) => {
    const result = db.prepare("delete from approval_grants where id = ?").run(c.req.param("id"));
    if (!result.changes) return c.json({ error: "approval_grant_not_found" }, 404);
    return c.json({ ok: true, id: c.req.param("id") });
  });
  
  app.post("/api/approvals/:id/archive", (c) => {
    const approval = getApproval(c.req.param("id"));
    if (!approval) return c.json({ error: "approval_not_found" }, 404);
    if (approval.status === "pending") return c.json({ error: "approval_pending_cannot_archive", approval: publicApproval(approval) }, 409);
    const archived = archiveApproval(approval.id);
    if (!archived?.archivedAt) return c.json({ error: "approval_archive_failed" }, 400);
    return c.json(publicApproval(archived));
  });
  
  app.post("/api/approvals/:id/restore", (c) => {
    const approval = getApproval(c.req.param("id"));
    if (!approval) return c.json({ error: "approval_not_found" }, 404);
    const restored = restoreApproval(approval.id);
    if (!restored) return c.json({ error: "approval_not_found" }, 404);
    return c.json(publicApproval(restored));
  });
  
  app.post("/api/approvals/:id/approve", (c) => {
    const approval = getApproval(c.req.param("id"));
    if (!approval) return c.json({ error: "approval_not_found" }, 404);
    if (approval.status !== "pending") return c.json({ error: "approval_already_resolved", approval: publicApproval(approval) }, 409);
    if (c.req.query("always") === "true" || c.req.query("expiresIn")) {
      const expiresIn = Number(c.req.query("expiresIn") ?? 0);
      const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + Math.min(expiresIn, 30 * 24 * 60 * 60) * 1000).toISOString() : null;
      saveApprovalGrant(approval, expiresAt);
    }
    let codexRuntime: CodexRuntimeSettings | undefined;
    if (approval.actionType === "codex-runtime-update") {
      codexRuntime = applyCodexRuntimeSettings(runtimeSettingsStore.codexRuntime.sanitize(approval.payload as Partial<CodexRuntimeSettings>));
    }
    let preview: PreviewSummary | undefined;
    if (approval.actionType === "preview-command-run") {
      const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { previewId?: unknown } : {};
      const record = previews.get(String(payload.previewId ?? ""));
      if (!record) return c.json({ error: "preview_not_found" }, 404);
      try {
        startPreviewProcess(record);
        preview = publicPreview(record);
      } catch (error) {
        record.status = "error";
        updatePreview(record);
        return c.json({ error: error instanceof Error ? error.message : "preview_start_failed", preview: publicPreview(record) }, 400);
      }
    }
    if (approval.actionType === "preview-access") {
      const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { requestId?: unknown; previewId?: unknown } : {};
      const request = previewAccessRequests.get(String(payload.requestId ?? ""));
      if (!request) return c.json({ error: "preview_access_request_not_found" }, 404);
      const expiresIn = Number(c.req.query("expiresIn") ?? 15 * 60);
      const ttlSeconds = c.req.query("always") === "true"
        ? 30 * 24 * 60 * 60
        : Number.isFinite(expiresIn) && expiresIn > 0
          ? Math.min(expiresIn, 30 * 24 * 60 * 60)
          : 15 * 60;
      const approvedUntil = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const requests = Array.from((previewAccessRequests as Map<string, { id: string; previewId: string; status: string; approvedUntil?: string; updatedAt?: string }>).values()).filter((item) =>
        item.id === request.id || (payload.previewId && item.previewId === String(payload.previewId) && item.status === "pending")
      );
      for (const item of requests) {
        item.status = "approved";
        item.approvedUntil = approvedUntil;
        item.updatedAt = new Date().toISOString();
        upsertPreviewAccessRequest(item);
      }
    }
    if (approval.actionType === "project-delete-files") {
      const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { projectId?: unknown } : {};
      try {
        deleteProjectRecord(String(payload.projectId ?? ""), true);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "project_delete_failed" }, 400);
      }
    }
    let merge: RoomRunMergeResponse | undefined;
    if (approval.actionType === "room-run-merge") {
      const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { roomId?: unknown; runId?: unknown } : {};
      try {
        const resolvedMerge = applyRoomRunMerge(String(payload.roomId ?? ""), String(payload.runId ?? "")) as RoomRunMergeResponse;
        merge = resolvedMerge;
        if (!resolvedMerge.ok) return c.json({ error: resolvedMerge.message || "merge_failed", merge: resolvedMerge }, 409);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "merge_failed" }, 400);
      }
    }
    let gitOperation: ProjectGitOperationSummary | undefined;
    if (approval.actionType === "project-git-operation") {
      const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { projectId?: unknown; operation?: unknown; args?: unknown } : {};
      const project = appData.projects.find((item: { id: string }) => item.id === String(payload.projectId ?? ""));
      if (!project) return c.json({ error: "project_not_found" }, 404);
      const args = Array.isArray(payload.args) ? payload.args.map(String) : [];
      const operation = String(payload.operation ?? "") as ProjectGitOperationType;
      gitOperation = runProjectGitOperation(project, operation, args);
    }
    const resolved = resolveApproval(approval.id, "approved");
    if (!resolved) return c.json({ error: "approval_not_found" }, 404);
    const response: ApprovalDecisionResponse = { approval: publicApproval(resolved), codexRuntime, preview, merge, gitOperation };
    return c.json(response);
  });
  
  app.post("/api/approvals/:id/deny", (c) => {
    const approval = getApproval(c.req.param("id"));
    if (!approval) return c.json({ error: "approval_not_found" }, 404);
    if (approval.status !== "pending") return c.json({ error: "approval_already_resolved", approval: publicApproval(approval) }, 409);
    const resolved = resolveApproval(approval.id, "denied");
    if (!resolved) return c.json({ error: "approval_not_found" }, 404);
    if (approval.actionType === "room-run-merge") {
      const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { roomId?: unknown; runId?: unknown } : {};
      const roomId = String(payload.roomId ?? "");
      if (roomId) createRoomDecision(roomId, {
        title: "Merge approval denied",
        status: "rejected",
        payload: { approvalId: approval.id, runId: payload.runId ?? null },
        resolvedAt: new Date().toISOString(),
      });
    }
    if (approval.actionType === "preview-access") {
      const payload = approval.payload && typeof approval.payload === "object" ? approval.payload as { requestId?: unknown } : {};
      const request = previewAccessRequests.get(String(payload.requestId ?? ""));
      if (request) {
        request.status = "denied";
        request.updatedAt = new Date().toISOString();
        upsertPreviewAccessRequest(request);
      }
    }
    const response: ApprovalDecisionResponse = { approval: publicApproval(resolved) };
    return c.json(response);
  });
}
