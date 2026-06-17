import { useEffect, useRef, useState } from "react";
import { Copy, Download, Globe, Info, Lock, MoreHorizontal, Pencil, Play, RefreshCw, Square, Trash2, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDialog } from "@/components/AppDialog";
import { FilterSearchInput, FilterToolbar } from "@/components/FilterControls";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { PreviewDetailRow } from "@/components/PreviewDetailRow";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatShortDate, newestTaskRunsFirst, projectDisplayName } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import { formatPreviewProxyPaths, openPreviewUrl, parsePreviewProxyPaths } from "@/lib/previews";
import { copyText, downloadTextFile } from "@/lib/utils";
import type { PageResponse, PreviewAccess, PreviewLogsResponse, PreviewSummary, ProjectSummary, SessionSummary } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";

function newestLinesFirst(log: string) {
  return log.split(/\r?\n/).reverse().join("\n");
}

export function PreviewsPage({
  sessionToken,
  projects,
  sessions,
  t,
  notify,
  onOpenMainNav,
}: {
  sessionToken: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog();
  const [previews, setPreviews] = useState<PreviewSummary[] | null>(null);
  const [previewCursor, setPreviewCursor] = useState<string | null>(null);
  const [previewHasMore, setPreviewHasMore] = useState(false);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewStatusFilter, setPreviewStatusFilter] = useState("");
  const [previewScopeFilter, setPreviewScopeFilter] = useState("");
  const [detailPreview, setDetailPreview] = useState<PreviewSummary | null>(null);
  const [detailLogs, setDetailLogs] = useState<string | null>(null);
  const [detailLogSearch, setDetailLogSearch] = useState("");
  const [message, setMessage] = useState("");
  const previewLogsRef = useRef<HTMLPreElement | null>(null);
  const visibleDetailLogs = detailLogs && detailLogSearch.trim()
    ? detailLogs.split(/\r?\n/).filter((line) => line.toLowerCase().includes(detailLogSearch.trim().toLowerCase())).join("\n")
    : detailLogs;

  const sources = [
    ...projects.map((project) => ({
      key: `project:${project.id}`,
      scopeType: "project" as const,
      scopeId: project.id,
      label: `${t("nav.projects")} · ${projectDisplayName(project, projects)}`,
    })),
    ...sessions.map((session) => ({
      key: `session:${session.id}`,
      scopeType: "session" as const,
      scopeId: session.id,
      label: `${t("nav.sessions")} · ${session.title}`,
    })),
    ...Array.from(new Map((previews ?? [])
      .filter((preview) => preview.scopeType === "folder")
      .map((preview) => [preview.scopeId, {
        key: `folder:${preview.scopeId}`,
        scopeType: "folder" as const,
        scopeId: preview.scopeId,
        label: `${t("nav.files")} · ${preview.scopeId}`,
      }])).values()),
  ];

  useEffect(() => {
    void loadPreviews();
  }, [sessionToken]);

  useEffect(() => {
    if (!previews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadPreviews(false, false), 1500);
    return () => window.clearTimeout(timer);
  }, [previews, sessionToken, previewSearch, previewStatusFilter, previewScopeFilter]);

  useEffect(() => {
    if (!detailPreview) return;
    setDetailLogs(null);
    const eventUrl = `/api/previews/${encodeURIComponent(detailPreview.id)}/logs/events?${new URLSearchParams({ token: sessionToken })}`;
    const source = new EventSource(eventUrl);
    source.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { preview?: PreviewSummary; logs?: string };
      if (data.preview) {
        const nextPreview = data.preview;
        setDetailPreview(nextPreview);
        setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
      }
      setDetailLogs(data.logs ?? "");
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { chunk?: string };
      setDetailLogs((current) => `${current ?? ""}${data.chunk ?? ""}`);
    });
    source.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { preview?: PreviewSummary };
      if (!data.preview) return;
      const nextPreview = data.preview;
      setDetailPreview(nextPreview);
      setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    });
    source.onerror = () => {
      setDetailLogs((current) => current === null ? "" : current);
    };
    return () => source.close();
  }, [detailPreview?.id, sessionToken]);

  useEffect(() => {
    if (!previewLogsRef.current) return;
    previewLogsRef.current.scrollTop = 0;
  }, [detailLogs]);

  async function loadPreviews(older = false, showLoading = true) {
    if (!older && showLoading) setPreviews(null);
    const params = new URLSearchParams({ limit: "20" });
    if (older && previewCursor) params.set("cursor", previewCursor);
    if (previewSearch.trim()) params.set("q", previewSearch.trim());
    if (previewStatusFilter) params.set("status", previewStatusFilter);
    if (previewScopeFilter) {
      const [scopeType, scopeId] = previewScopeFilter.split(":");
      params.set("scopeType", scopeType);
      params.set("scopeId", scopeId);
    }
    const response = await fetch(`/api/previews?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setPreviews([]);
      setMessage(t("project.previewReadFailed"));
      notify(t("project.previewReadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<PreviewSummary>;
    setPreviews((items) => older ? [...(items ?? []), ...page.items] : page.items);
    setPreviewCursor(page.nextCursor);
    setPreviewHasMore(page.hasMore);
  }

  function sourceForPreview(preview: PreviewSummary) {
    const source = sources.find((item) => item.scopeType === preview.scopeType && item.scopeId === preview.scopeId);
    return source?.label ?? `${preview.scopeType}:${preview.scopeId}`;
  }

  async function previewLastError(previewId: string) {
    const response = await fetch(`/api/previews/${previewId}/logs`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return "";
    const result = (await response.json().catch(() => null)) as PreviewLogsResponse | null;
    return (result?.logs ?? "").split(/\r?\n/).reverse().find((line) => line.includes("[error]")) ?? "";
  }

  async function startPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 409 && result?.error === "approval_required") {
        setMessage(t("approval.required"));
        notify(t("approval.required"), "info");
        await loadPreviews();
        return;
      }
      const logError = await previewLastError(preview.id);
      const errorText = result?.error || logError;
      setMessage(errorText ? `${t("project.previewStartFailed")}：${errorText}` : t("project.previewStartFailed"));
      notify(errorText ? `${t("project.previewStartFailed")}：${errorText}` : t("project.previewStartFailed"), "error");
      return;
    }
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
  }

  async function stopPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
  }

  async function deletePreview(preview: PreviewSummary) {
    const confirmed = await dialog.confirm({
      title: t("project.deletePreview"),
      message: `${preview.label}\n${preview.targetHost}:${preview.port}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setMessage(t("project.previewDeleteFailed"));
      notify(t("project.previewDeleteFailed"), "error");
      return;
    }
    setPreviews((items) => (items ?? []).filter((item) => item.id !== preview.id));
  }

  async function renamePreview(preview: PreviewSummary) {
    const label = await dialog.prompt({
      title: t("preview.rename"),
      message: preview.targetHost ? `${preview.targetHost}:${preview.port}` : preview.id,
      placeholder: preview.label,
      defaultValue: preview.label,
      confirmLabel: t("action.save"),
    });
    if (label === null) return;
    const nextLabel = label.trim();
    if (!nextLabel || nextLabel === preview.label) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ label: nextLabel }),
    });
    if (!response.ok) {
      setMessage(t("preview.renameFailed"));
      notify(t("preview.renameFailed"), "error");
      return;
    }
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
    setMessage(t("preview.renamed"));
    notify(t("preview.renamed"), "success");
  }

  async function editPreviewProxyPaths(preview: PreviewSummary) {
    const value = await dialog.prompt({
      title: t("preview.proxyPaths"),
      message: t("preview.proxyPathsHelp"),
      defaultValue: formatPreviewProxyPaths(preview.proxyPaths),
      placeholder: "/api\n/trpc\n/graphql",
      confirmLabel: t("action.save"),
      multiline: true,
    });
    if (value === null) return;
    const proxyPaths = parsePreviewProxyPaths(value);
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ proxyPaths }),
    });
    if (!response.ok) {
      setMessage(t("preview.proxyPathsUpdateFailed"));
      notify(t("preview.proxyPathsUpdateFailed"), "error");
      return;
    }
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
    notify(t("preview.proxyPathsUpdated"), "success");
  }

  async function copyPreviewUrl(preview: PreviewSummary) {
    const copied = await copyText(`${window.location.origin}${preview.url}`);
    setMessage(copied ? t("action.copied") : t("settings.copyFailed"));
    notify(copied ? t("action.copied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function updatePreviewAccess(preview: PreviewSummary, access: PreviewAccess) {
    const response = await fetch(`/api/previews/${preview.id}/access`, {
      method: "PUT",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ access }),
    });
    if (!response.ok) {
      notify(t("preview.accessUpdateFailed"), "error");
      return;
    }
    const nextPreview = (await response.json()) as PreviewSummary;
    setPreviews((items) => (items ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item));
    setDetailPreview((current) => current?.id === nextPreview.id ? nextPreview : current);
  }

  return (
    <main className="management-page contacts-page">
      {dialog.node}
      <PageHeader crumb={`${t("page.global")} / ${t("nav.previews")}`} title={t("page.previews")} action={t("action.refresh")} onAction={() => void loadPreviews()} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.previews")} />
      <FilterToolbar className="preview-filter-toolbar">
        <FilterSearchInput
          value={previewSearch}
          onChange={(event) => setPreviewSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadPreviews();
          }}
          placeholder={t("preview.searchPreviews")}
        />
        <select name="previewstatusfilter" className="filter-select" value={previewStatusFilter} onChange={(event) => setPreviewStatusFilter(event.target.value)}>
          <option value="">{t("session.allStatuses")}</option>
          {["registered", "starting", "running", "stopped", "error"].map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select name="previewscopefilter" className="filter-select" value={previewScopeFilter} onChange={(event) => setPreviewScopeFilter(event.target.value)}>
          <option value="">{t("preview.allSources")}</option>
          {sources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
        </select>
        <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void loadPreviews()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
      </FilterToolbar>
      <section className="preview-list preview-list-full">
        {message && <div className="subtle">{message}</div>}
          {!previews && <div className="subtle">{t("project.loadingPreviews")}</div>}
          {previews?.map((preview) => (
            <article className="preview-item" key={preview.id}>
              <div className="preview-item-main">
                <strong>{preview.label}</strong>
                <span>{sourceForPreview(preview)} · {preview.access}</span>
              </div>
              <div className="preview-item-signal">
                <span className={`preview-status ${preview.status}`}>{preview.status}</span>
                <code>{preview.port}</code>
              </div>
              <button className="ghost-button icon-only" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => setDetailPreview(preview)}><IconText icon={Info}>{t("preview.details")}</IconText></button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ghost-button icon-only" type="button" title={t("preview.actions")} aria-label={t("preview.actions")}><MoreHorizontal size={16} /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={preview.status !== "running"} onSelect={() => void openPreviewUrl(preview, sessionToken, notify, t)}><IconText icon={Globe}>{t("project.openPreview")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void renamePreview(preview)}><IconText icon={Pencil}>{t("action.rename")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void editPreviewProxyPaths(preview)}><IconText icon={Globe}>{t("preview.proxyPaths")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyPreviewUrl(preview)}><IconText icon={Copy}>{t("action.copy")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void updatePreviewAccess(preview, preview.access === "private" ? "public" : "private")}>
                    <IconText icon={preview.access === "private" ? Unlock : Lock}>{preview.access === "private" ? t("preview.makePublic") : t("preview.makePrivate")}</IconText>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={preview.status === "running" || preview.status === "starting"} onSelect={() => void startPreview(preview)}><IconText icon={Play}>{t("preview.start")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem disabled={preview.status !== "running" && preview.status !== "starting"} onSelect={() => void stopPreview(preview)}><IconText icon={Square}>{t("preview.stop")}</IconText></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="danger-menu-item" onSelect={() => void deletePreview(preview)}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </article>
          ))}
          {previewHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadPreviews(true)}>{t("session.loadMore")}</button>}
          {previews && !previews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
      </section>
      {detailPreview && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{detailPreview.label}</strong>
              <span>{sourceForPreview(detailPreview)}</span>
            </div>
            <button className="modal-head-close" type="button" aria-label={t("action.close")} onClick={() => { setDetailPreview(null); setDetailLogs(null); setDetailLogSearch(""); }}><X size={16} /></button>
          </div>
          <div className="preview-detail">
            <PreviewDetailRow label={t("preview.status")} value={detailPreview.status} />
            <PreviewDetailRow label={t("preview.access")} value={detailPreview.access} />
            <PreviewDetailRow label={t("preview.port")} value={String(detailPreview.port)} />
            <PreviewDetailRow label={t("preview.url")} value={`${window.location.origin}${detailPreview.url}`} />
            <PreviewDetailRow label={t("project.previewCommand")} value={detailPreview.command ?? "-"} />
            <PreviewDetailRow label={t("project.previewDirectory")} value={detailPreview.cwd ?? "-"} />
            <PreviewDetailRow label={t("preview.target")} value={`${detailPreview.targetHost}:${detailPreview.port}`} />
            <PreviewDetailRow label={t("preview.proxyPaths")} value={detailPreview.proxyPaths?.length ? detailPreview.proxyPaths.join(", ") : "-"} />
            <PreviewDetailRow label={t("preview.createdAt")} value={formatShortDate(detailPreview.createdAt)} />
            <PreviewDetailRow label={t("preview.updatedAt")} value={formatShortDate(detailPreview.updatedAt)} />
            <div className="preview-detail-row">
              <span>{t("preview.logs")}</span>
              <div className="preview-log-tools">
                <input className="search-input" name="preview-log-search" value={detailLogSearch} onChange={(event) => setDetailLogSearch(event.target.value)} placeholder={t("preview.searchLogs")} />
                <button className="ghost-button" type="button" disabled={!detailLogs} onClick={() => detailPreview && detailLogs !== null && downloadTextFile(`${(detailPreview.label || detailPreview.id).replace(/[\\/:*?"<>|]+/g, "-")}.log`, detailLogs)}><IconText icon={Download}>{t("preview.downloadLogs")}</IconText></button>
              </div>
              <pre ref={previewLogsRef} className="preview-logs">{detailLogs === null ? t("preview.logsLoading") : visibleDetailLogs ? newestLinesFirst(visibleDetailLogs) : t("preview.noLogs")}</pre>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
