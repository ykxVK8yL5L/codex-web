import React, { useEffect, useMemo, useState } from "react";
import { Activity, Check, Copy, Download, FilePlus2, FolderOpen, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDialog } from "@/components/AppDialog";
import { FilterSearchInput, FilterToolbar } from "@/components/FilterControls";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilesPage } from "@/features/files/FilesPage";
import { formatShortDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import { copyText } from "@/lib/utils";
import type { CreateMcpServerRequest, CreatePluginRequest, CreateSkillRequest, DeleteMarketplaceItemsRequest, DeleteSkillRequest, ExtensionDetail, ExtensionSummary, ImportMarketplaceCatalogRequest, ImportMcpServerRequest, ImportSkillRequest, InstallMarketplaceItemResponse, MarketplaceCapabilityType, MarketplaceCatalogItem, MarketplaceCatalogResponse, PageResponse, UpdateSkillRequest } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";
type ExtensionTab = "skills" | "plugins" | "mcp" | "marketplace";

export function ExtensionsPage({ sessionToken, title, t, notify, onOpenMainNav, TerminalComponent }: { sessionToken: string; title: string; t: TFunction; notify: (message: string, tone?: ToastTone) => void; onOpenMainNav?: () => void; TerminalComponent: React.ComponentType<{ sessionToken: string; t: TFunction; initialCwd?: string; embedded?: boolean }>; }) {
  const dialog = useAppDialog(t);
  type ExtensionTab = ExtensionSummary["type"] | "market";
  const showLegacyExtensionEntryPoints = false;
  const [tab, setTab] = useState<ExtensionTab>("market");
  const [items, setItems] = useState<Record<ExtensionSummary["type"], ExtensionSummary[]>>({ plugin: [], skill: [], mcp: [] });
  const [extensionCursors, setExtensionCursors] = useState<Record<ExtensionSummary["type"], string | null>>({ plugin: null, skill: null, mcp: null });
  const [extensionHasMore, setExtensionHasMore] = useState<Record<ExtensionSummary["type"], boolean>>({ plugin: false, skill: false, mcp: false });
  const [extensionSearch, setExtensionSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedExtension, setSelectedExtension] = useState<ExtensionSummary | null>(null);
  const [extensionDetail, setExtensionDetail] = useState<ExtensionDetail | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<{ name: string; path: string } | null>(null);
  const [skillCreateOpen, setSkillCreateOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<ExtensionSummary | null>(null);
  const [skillForm, setSkillForm] = useState<CreateSkillRequest>({ name: "", description: "", instructions: "" });
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const [skillImportForm, setSkillImportForm] = useState<ImportSkillRequest>({ url: "", content: "" });
  const [skillImporting, setSkillImporting] = useState(false);
  const [pluginCreateOpen, setPluginCreateOpen] = useState(false);
  const [pluginForm, setPluginForm] = useState<CreatePluginRequest>({ name: "", description: "" });
  const [pluginSaving, setPluginSaving] = useState(false);
  const [mcpCreateOpen, setMcpCreateOpen] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: "", command: "", args: "", env: "" });
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpImportOpen, setMcpImportOpen] = useState(false);
  const [mcpImportForm, setMcpImportForm] = useState<ImportMcpServerRequest>({ url: "", content: "" });
  const [mcpImporting, setMcpImporting] = useState(false);
  const [marketCategory, setMarketCategory] = useState("all");
  const [marketType, setMarketType] = useState<MarketplaceCapabilityType | "all">("all");
  const [marketItems, setMarketItems] = useState<MarketplaceCatalogItem[]>([]);
  const [marketSourceName, setMarketSourceName] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketImportOpen, setMarketImportOpen] = useState(false);
  const [marketImportForm, setMarketImportForm] = useState<ImportMarketplaceCatalogRequest>({ url: "", content: "" });
  const [marketImporting, setMarketImporting] = useState(false);
  const [marketSelectedIds, setMarketSelectedIds] = useState<string[]>([]);
  const [marketDeleting, setMarketDeleting] = useState(false);

  function extensionEndpoint(type: ExtensionSummary["type"]) {
    return type === "plugin" ? "plugins" : type === "skill" ? "skills" : "mcp";
  }

  async function loadExtensionType(type: ExtensionSummary["type"], reset = false, q = extensionSearch) {
    const params = new URLSearchParams({ limit: "20" });
    const cursor = extensionCursors[type];
    if (!reset && cursor) params.set("cursor", cursor);
    if (q.trim()) params.set("q", q.trim());
    const response = await fetch(`/api/extensions/${extensionEndpoint(type)}?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) throw new Error("extension_read_failed");
    const page = (await response.json()) as PageResponse<ExtensionSummary>;
    setItems((current) => ({ ...current, [type]: reset ? page.items : [...current[type], ...page.items] }));
    setExtensionCursors((current) => ({ ...current, [type]: page.nextCursor }));
    setExtensionHasMore((current) => ({ ...current, [type]: page.hasMore }));
  }

  async function loadExtensions(reset = true, q = extensionSearch) {
    setLoading(true);
    setMessage("");
    try {
      await Promise.all(extensionTypeTabs.map((item) => loadExtensionType(item.id, reset, q)));
    } catch {
      setMessage(t("extension.readFailed"));
      notify(t("extension.readFailed"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExtensions();
  }, [sessionToken]);

  useEffect(() => {
    if (tab === "market" && !marketItems.length && !marketLoading) void loadMarketplace();
  }, [tab]);

  const extensionTypeTabs: Array<{ id: ExtensionSummary["type"]; label: string }> = [
    { id: "plugin", label: t("extension.plugins") },
    { id: "skill", label: t("extension.skills") },
    { id: "mcp", label: t("extension.mcpServers") },
  ];
  const tabs: Array<{ id: ExtensionTab; label: string }> = [
    { id: "market", label: t("extension.market") },
    ...extensionTypeTabs,
  ];
  const activeItems = tab === "market" ? [] : items[tab];
  const marketCategories = [
    { id: "all", label: t("extension.marketAll") },
    { id: "local", label: t("extension.marketLocal") },
    { id: "productivity", label: t("extension.marketProductivity") },
    { id: "planning", label: t("extension.marketPlanning") },
    { id: "development", label: t("extension.marketDevelopment") },
    { id: "agent", label: t("extension.marketAgent") },
    { id: "browser", label: t("extension.marketBrowser") },
    { id: "web", label: t("extension.marketWeb") },
  ];
  const marketTypes: Array<{ id: MarketplaceCapabilityType | "all"; label: string }> = [
    { id: "all", label: t("extension.marketAllTypes") },
    { id: "skill", label: t("extension.skills") },
    { id: "mcp", label: t("extension.mcpServers") },
    { id: "plugin", label: t("extension.plugins") },
  ];
  const visibleMarketItems = marketItems.filter((item) => {
    const matchesType = marketType === "all" || item.type === marketType;
    const matchesCategory = marketCategory === "all" || item.category === marketCategory;
    const query = extensionSearch.trim().toLowerCase();
    const matchesSearch = !query || [item.name, item.description, item.category, item.source, ...(item.tags ?? [])].some((value) => value?.toLowerCase().includes(query));
    return matchesType && matchesCategory && matchesSearch;
  });
  const visibleMarketItemIds = visibleMarketItems.map((item) => item.id);
  const selectedVisibleMarketCount = visibleMarketItemIds.filter((id) => marketSelectedIds.includes(id)).length;

  function isMarketplaceItemInstalled(item: MarketplaceCatalogItem) {
    if (item.type === "skill" && item.install.kind === "skill") {
      const name = item.install.skill.name.trim().toLowerCase();
      return items.skill.some((entry) => entry.name.trim().toLowerCase() === name);
    }
    if (item.type === "skill" && item.install.kind === "skillUrl") {
      const byName = item.name.trim().toLowerCase();
      return items.skill.some((entry) => entry.name.trim().toLowerCase() === byName);
    }
    if (item.type === "plugin" && item.install.kind === "plugin") {
      const name = item.install.manifest.name.trim().toLowerCase();
      return items.plugin.some((entry) => entry.name.trim().toLowerCase() === name);
    }
    if (item.type === "mcp" && item.install.kind === "mcpServers") {
      const candidateNames = Object.keys(item.install.config?.mcpServers ?? item.install.config ?? {}).map((name) => name.trim().toLowerCase()).filter(Boolean);
      if (!candidateNames.length) return false;
      return candidateNames.every((name) => items.mcp.some((entry) => entry.name.trim().toLowerCase() === name));
    }
    return false;
  }

  function extensionDirectory(item: ExtensionSummary) {
    if (!item.path) return "";
    if (item.path.endsWith(".toml") || item.path.endsWith(".json") || item.path.endsWith(".md")) {
      return item.path.split("/").slice(0, -1).join("/") || "/";
    }
    return item.path;
  }

  async function copyExtensionPath(item: ExtensionSummary) {
    if (!item.path) return;
    const copied = await copyText(item.path);
    setMessage(copied ? t("extension.pathCopied") : t("settings.copyFailed"));
    notify(copied ? t("extension.pathCopied") : t("settings.copyFailed"), copied ? "success" : "error");
  }

  async function openExtensionDetail(item: ExtensionSummary) {
    setSelectedExtension(item);
    setExtensionDetail(null);
    const params = new URLSearchParams({ type: item.type, name: item.name });
    if (item.path) params.set("path", item.path);
    const response = await fetch(`/api/extensions/detail?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setMessage(t("extension.detailReadFailed"));
      notify(t("extension.detailReadFailed"), "error");
      return;
    }
    setExtensionDetail((await response.json()) as ExtensionDetail);
  }

  function extractSkillInstructions(content: string) {
    const withoutFrontMatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/m, "").trim();
    const instructionMatch = withoutFrontMatter.match(/(?:^|\n)## Instructions\s*\n([\s\S]*)/i);
    if (instructionMatch?.[1]) return instructionMatch[1].trim();
    return withoutFrontMatter.replace(/^# .*\n+/, "").trim();
  }

  function openCreateSkill() {
    setEditingSkill(null);
    setSkillForm({ name: "", description: "", instructions: "" });
    setSkillCreateOpen(true);
  }

  async function openEditSkill(item: ExtensionSummary) {
    if (!item.path) return;
    setEditingSkill(item);
    setSkillForm({ name: item.name, description: item.description ?? "", instructions: "" });
    setSkillCreateOpen(true);
    const params = new URLSearchParams({ type: item.type, name: item.name, path: item.path });
    const response = await fetch(`/api/extensions/detail?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("extension.detailReadFailed"), "error");
      return;
    }
    const detail = (await response.json()) as ExtensionDetail;
    setSkillForm({
      name: detail.item.name,
      description: detail.item.description ?? "",
      instructions: extractSkillInstructions(detail.content),
    });
  }

  async function saveSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!skillForm.name.trim() || !skillForm.description.trim() || !skillForm.instructions.trim()) {
      setMessage(t("extension.skillFieldsRequired"));
      notify(t("extension.skillFieldsRequired"), "error");
      return;
    }
    setSkillSaving(true);
    setMessage("");
    try {
      const requestBody: CreateSkillRequest | UpdateSkillRequest = editingSkill?.path ? { ...skillForm, path: editingSkill.path } : skillForm;
      const response = await fetch("/api/extensions/skills", {
        method: editingSkill ? "PUT" : "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as { error?: string }));
        throw new Error(payload.error ?? "skill_create_failed");
      }
      setSkillCreateOpen(false);
      setEditingSkill(null);
      setSkillForm({ name: "", description: "", instructions: "" });
      setTab("skill");
      await loadExtensionType("skill", true, extensionSearch);
      notify(editingSkill ? t("extension.skillUpdated") : t("extension.skillCreated"), "success");
    } catch (error) {
      const errorMessage = error instanceof Error && error.message === "skill_exists" ? t("extension.skillExists") : t("extension.skillCreateFailed");
      setMessage(errorMessage);
      notify(errorMessage, "error");
    } finally {
      setSkillSaving(false);
    }
  }

  async function importSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!skillImportForm.url?.trim() && !skillImportForm.content?.trim()) {
      notify(t("extension.skillImportRequired"), "error");
      return;
    }
    setSkillImporting(true);
    try {
      const response = await fetch("/api/extensions/skills/import", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(skillImportForm),
      });
      if (!response.ok) throw new Error("skill_import_failed");
      setSkillImportOpen(false);
      setSkillImportForm({ url: "", content: "" });
      setTab("skill");
      await loadExtensionType("skill", true, extensionSearch);
      notify(t("extension.skillImported"), "success");
    } catch {
      notify(t("extension.skillImportFailed"), "error");
    } finally {
      setSkillImporting(false);
    }
  }

  async function deleteSkill(item: ExtensionSummary) {
    if (!item.path) return;
    const confirmed = await dialog.confirm({
      title: t("extension.deleteSkill"),
      message: t("extension.skillDeleteConfirm"),
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const body: DeleteSkillRequest = { path: item.path };
    const response = await fetch("/api/extensions/skills", {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      notify(t("extension.skillDeleteFailed"), "error");
      return;
    }
    await loadExtensionType("skill", true, extensionSearch);
    notify(t("extension.skillDeleted"), "success");
  }

  async function createPlugin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pluginForm.name.trim()) {
      notify(t("extension.pluginNameRequired"), "error");
      return;
    }
    setPluginSaving(true);
    try {
      const response = await fetch("/api/extensions/plugins", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(pluginForm),
      });
      if (!response.ok) throw new Error("plugin_create_failed");
      setPluginCreateOpen(false);
      setPluginForm({ name: "", description: "" });
      setTab("plugin");
      await loadExtensionType("plugin", true, extensionSearch);
      notify(t("extension.pluginCreated"), "success");
    } catch {
      notify(t("extension.pluginCreateFailed"), "error");
    } finally {
      setPluginSaving(false);
    }
  }

  function parseMcpEnv(value: string) {
    return value.split(/\r?\n/).reduce<Record<string, string>>((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes("=")) return env;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const val = trimmed.slice(index + 1).trim();
      if (key) env[key] = val;
      return env;
    }, {});
  }

  async function createMcp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mcpForm.name.trim() || !mcpForm.command.trim()) {
      notify(t("extension.mcpFieldsRequired"), "error");
      return;
    }
    const body: CreateMcpServerRequest = {
      name: mcpForm.name.trim(),
      command: mcpForm.command.trim(),
      args: mcpForm.args.trim() ? mcpForm.args.trim().split(/\s+/) : [],
      env: parseMcpEnv(mcpForm.env),
    };
    setMcpSaving(true);
    try {
      const response = await fetch("/api/extensions/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("mcp_create_failed");
      setMcpCreateOpen(false);
      setMcpForm({ name: "", command: "", args: "", env: "" });
      setTab("mcp");
      await loadExtensionType("mcp", true, extensionSearch);
      notify(t("extension.mcpCreated"), "success");
    } catch {
      notify(t("extension.mcpCreateFailed"), "error");
    } finally {
      setMcpSaving(false);
    }
  }

  async function importMcp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mcpImportForm.url?.trim() && !mcpImportForm.content?.trim()) {
      notify(t("extension.mcpImportRequired"), "error");
      return;
    }
    setMcpImporting(true);
    try {
      const response = await fetch("/api/extensions/mcp/import", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(mcpImportForm),
      });
      if (!response.ok) throw new Error("mcp_import_failed");
      const result = (await response.json()) as { imported?: ExtensionSummary[] };
      setMcpImportOpen(false);
      setMcpImportForm({ url: "", content: "" });
      setTab("mcp");
      await loadExtensionType("mcp", true, extensionSearch);
      notify(t("extension.mcpImported").replace("{count}", String(result.imported?.length ?? 0)), "success");
    } catch {
      notify(t("extension.mcpImportFailed"), "error");
    } finally {
      setMcpImporting(false);
    }
  }

  async function loadMarketplace() {
    setMarketLoading(true);
    try {
      const response = await fetch("/api/extensions/marketplace", {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("marketplace_read_failed");
      const payload = (await response.json()) as MarketplaceCatalogResponse;
      setMarketItems(payload.items ?? []);
      setMarketSourceName(payload.source?.name ?? "");
      setMarketSelectedIds((current) => current.filter((id) => (payload.items ?? []).some((item) => item.id === id)));
    } catch {
      notify(t("extension.marketReadFailed"), "error");
    } finally {
      setMarketLoading(false);
    }
  }

  async function importMarketplace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!marketImportForm.url?.trim() && !marketImportForm.content?.trim()) {
      notify(t("extension.marketImportRequired"), "error");
      return;
    }
    setMarketImporting(true);
    try {
      const response = await fetch("/api/extensions/marketplace/import", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(marketImportForm),
      });
      if (!response.ok) throw new Error("marketplace_import_failed");
      const payload = (await response.json()) as MarketplaceCatalogResponse;
      setMarketItems(payload.items ?? []);
      setMarketSourceName(payload.source?.name ?? "");
      setMarketType("all");
      setMarketCategory("all");
      setMarketSelectedIds([]);
      setMarketImportOpen(false);
      setMarketImportForm({ url: "", content: "" });
      setTab("market");
      await loadMarketplace();
      notify(t("extension.marketImported").replace("{count}", String(payload.items?.length ?? 0)), "success");
    } catch {
      notify(t("extension.marketImportFailed"), "error");
    } finally {
      setMarketImporting(false);
    }
  }

  async function installMarketplaceItem(item: MarketplaceCatalogItem) {
    const response = await fetch("/api/extensions/marketplace/install", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ item }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as { error?: string }));
      notify(payload.error?.endsWith("_exists") ? t("extension.marketAlreadyInstalled") : t("extension.marketInstallFailed"), "error");
      return;
    }
    const result = (await response.json()) as InstallMarketplaceItemResponse;
    const installedType = result.installed?.[0]?.type ?? item.type;
    if (installedType === "plugin" || installedType === "skill" || installedType === "mcp") await loadExtensionType(installedType, true, extensionSearch);
    notify(t("extension.marketInstalled").replace("{count}", String(result.installed?.length ?? 1)), "success");
  }

  function toggleMarketplaceItemSelection(id: string) {
    setMarketSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleVisibleMarketplaceSelection() {
    if (!visibleMarketItemIds.length) return;
    const allVisibleSelected = visibleMarketItemIds.every((id) => marketSelectedIds.includes(id));
    setMarketSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleMarketItemIds.includes(id));
      const next = new Set(current);
      visibleMarketItemIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  }

  async function deleteSelectedMarketplaceItems() {
    const selectedIds = marketSelectedIds.filter((id) => marketItems.some((item) => item.id === id));
    if (!selectedIds.length) return;
    const confirmed = await dialog.confirm({
      title: t("extension.marketDeleteSelected"),
      message: t("extension.marketDeleteSelectedConfirm"),
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setMarketDeleting(true);
    try {
      const body: DeleteMarketplaceItemsRequest = { ids: selectedIds };
      const response = await fetch("/api/extensions/marketplace", {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("marketplace_delete_failed");
      const payload = (await response.json()) as MarketplaceCatalogResponse;
      setMarketItems(payload.items ?? []);
      setMarketSourceName(payload.source?.name ?? "");
      setMarketSelectedIds([]);
      notify(t("extension.marketDeletedSelected").replace("{count}", String(selectedIds.length)), "success");
    } catch {
      notify(t("extension.marketDeleteSelectedFailed"), "error");
    } finally {
      setMarketDeleting(false);
    }
  }

  async function clearMarketplaceItems() {
    if (!marketItems.length) return;
    const confirmed = await dialog.confirm({
      title: t("extension.marketClearAll"),
      message: t("extension.marketClearAllConfirm"),
      confirmLabel: t("extension.marketClearAll"),
      danger: true,
    });
    if (!confirmed) return;
    setMarketDeleting(true);
    try {
      const response = await fetch("/api/extensions/marketplace/all", {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error("marketplace_clear_failed");
      const payload = (await response.json()) as MarketplaceCatalogResponse;
      setMarketItems(payload.items ?? []);
      setMarketSourceName(payload.source?.name ?? "");
      setMarketSelectedIds([]);
      notify(t("extension.marketCleared"), "success");
    } catch {
      notify(t("extension.marketClearFailed"), "error");
    } finally {
      setMarketDeleting(false);
    }
  }

  function extensionLabel(value?: string) {
    if (!value) return "";
    return value.split("_").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
  }

  function renderSkillCapabilityMeta(item: ExtensionSummary) {
    const kinds = item.capabilityKinds ?? [];
    const targets = item.assignableTo ?? [];
    const permissions = item.permissions ?? [];
    return (
      <div className="extension-capability-meta">
        <div className="extension-chip-row">
          {item.syncStatus && <span className="pill">{extensionLabel(item.syncStatus)}</span>}
          {item.sourceType && <span className="pill">{extensionLabel(item.sourceType)}</span>}
          {item.managedBy && <span className="pill">{extensionLabel(item.managedBy)}</span>}
          {item.scannedAt && <span className="extension-scan-time">{t("extension.scannedAt")} {formatShortDate(item.scannedAt)}</span>}
        </div>
        {!!kinds.length && (
          <div className="extension-meta-row">
            <span>{t("extension.capabilityKinds")}</span>
            <div className="extension-chip-row">{kinds.map((kind) => <span className="extension-chip" key={kind}>{extensionLabel(kind)}</span>)}</div>
          </div>
        )}
        {!!targets.length && (
          <div className="extension-meta-row">
            <span>{t("extension.assignableTo")}</span>
            <div className="extension-chip-row">{targets.map((target) => <span className="extension-chip" key={target}>{extensionLabel(target)}</span>)}</div>
          </div>
        )}
        {!!permissions.length && (
          <div className="extension-meta-row">
            <span>{t("extension.permissions")}</span>
            <div className="extension-chip-row">{permissions.map((permission) => <span className="extension-chip" key={permission}>{extensionLabel(permission)}</span>)}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="management-page">
      <PageHeader
        crumb={`${t("page.global")} / ${t("nav.extensions")}`}
        title={title}
        action={loading || marketLoading ? t("session.loading") : tab === "market" ? t("extension.marketRefresh") : tab === "skill" ? t("extension.syncLocalCapabilities") : t("action.refresh")}
        onAction={() => tab === "market" ? void loadMarketplace() : void loadExtensions(true)}
        onOpenMainNav={onOpenMainNav}
        menuLabel={title}
      />
      <FilterToolbar className="extension-filter-toolbar">
        <FilterSearchInput
          value={extensionSearch}
          onChange={(event) => setExtensionSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadExtensions(true, extensionSearch);
          }}
          placeholder={t("extension.searchExtensions")}
        />
        <Button
          className="icon-only"
          variant="outline"
          size="sm"
          type="button"
          title={tab === "market" ? t("extension.marketRefresh") : tab === "skill" ? t("extension.syncLocalCapabilities") : t("action.refresh")}
          aria-label={tab === "market" ? t("extension.marketRefresh") : tab === "skill" ? t("extension.syncLocalCapabilities") : t("action.refresh")}
          onClick={() => tab === "market" ? void loadMarketplace() : void loadExtensions(true, extensionSearch)}
        >
          <IconText icon={RefreshCw}>{tab === "market" ? t("extension.marketRefresh") : tab === "skill" ? t("extension.syncLocalCapabilities") : t("action.refresh")}</IconText>
        </Button>
        {tab === "market" && <Button className="market-import-button" variant="default" size="sm" type="button" onClick={() => setMarketImportOpen(true)}>{t("extension.marketImportCatalog")}</Button>}
        {tab === "market" && <Button variant="outline" size="sm" type="button" disabled={!visibleMarketItemIds.length} onClick={toggleVisibleMarketplaceSelection}>{visibleMarketItemIds.length && visibleMarketItemIds.every((id) => marketSelectedIds.includes(id)) ? t("extension.marketClearSelection") : t("extension.marketSelectAll")}</Button>}
        {tab === "market" && <Button variant="outline" size="sm" type="button" disabled={!marketSelectedIds.length || marketDeleting} onClick={() => void deleteSelectedMarketplaceItems()}>{t("extension.marketDeleteSelected")}</Button>}
        {tab === "market" && <Button variant="outline" size="sm" type="button" disabled={!marketItems.length || marketDeleting} onClick={() => void clearMarketplaceItems()}>{t("extension.marketClearAll")}</Button>}
        {showLegacyExtensionEntryPoints && tab === "plugin" && <Button variant="default" size="sm" type="button" onClick={() => setPluginCreateOpen(true)}><IconText icon={Plus}>{t("extension.addPlugin")}</IconText></Button>}
        {showLegacyExtensionEntryPoints && tab === "skill" && <Button variant="outline" size="sm" type="button" onClick={openCreateSkill}><IconText icon={Plus}>{t("extension.addSkill")}</IconText></Button>}
        {showLegacyExtensionEntryPoints && tab === "skill" && <Button variant="default" size="sm" type="button" onClick={() => setSkillImportOpen(true)}><IconText icon={Download}>{t("extension.importSkill")}</IconText></Button>}
        {showLegacyExtensionEntryPoints && tab === "mcp" && <Button variant="outline" size="sm" type="button" onClick={() => setMcpCreateOpen(true)}><IconText icon={Plus}>{t("extension.addMcp")}</IconText></Button>}
        {showLegacyExtensionEntryPoints && tab === "mcp" && <Button variant="default" size="sm" type="button" onClick={() => setMcpImportOpen(true)}><IconText icon={Download}>{t("extension.importMcp")}</IconText></Button>}
      </FilterToolbar>
      <section className="extensions-layout">
        <aside className="extensions-tabs">
          {tabs.map((item) => (
            <button className={`extension-tab ${tab === item.id ? "active" : ""}`} key={item.id} type="button" onClick={() => setTab(item.id)}>
              <strong>{item.label}</strong>
              <span>{item.id === "market" ? marketItems.length : items[item.id].length}</span>
            </button>
          ))}
        </aside>
        <section className="extension-list">
          {tab === "skill" && (
            <div className="extension-module-summary">
              <div>
                <strong>{t("extension.skillModuleTitle")}</strong>
                <span>{t("extension.skillModuleSummary")}</span>
              </div>
              <span>{t("extension.localDiscovery")}</span>
            </div>
          )}
          {tab === "market" && (
            <div className="extension-marketplace">
              <div className="extension-marketplace-head">
                <div>
                  <strong>{t("extension.marketTitle")}</strong>
                  <span>{marketSourceName ? t("extension.marketSource").replace("{source}", marketSourceName) : t("extension.marketSubtitle")}</span>
                </div>
                <div className="extension-marketplace-controls">
                  <div className="extension-marketplace-categories">
                    {marketTypes.map((type) => (
                      <button className={`extension-category-chip ${marketType === type.id ? "active" : ""}`} key={type.id} type="button" onClick={() => setMarketType(type.id)}>
                        {type.label}
                      </button>
                    ))}
                  </div>
                  <div className="extension-marketplace-categories">
                    {marketCategories.map((category) => (
                      <button className={`extension-category-chip ${marketCategory === category.id ? "active" : ""}`} key={category.id} type="button" onClick={() => setMarketCategory(category.id)}>
                        {category.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="extension-marketplace-selection-bar">
                <span>{t("extension.marketSelectedCount").replace("{count}", String(selectedVisibleMarketCount || marketSelectedIds.length))}</span>
              </div>
              <div className="extension-marketplace-grid">
                {visibleMarketItems.map((item) => (
                  <article className={`extension-marketplace-card ${marketSelectedIds.includes(item.id) ? "selected" : ""}`} key={item.id}>
                    <label className="extension-marketplace-select">
                      <input
                        name={`extension-market-selected-${item.id}`}
                        type="checkbox"
                        checked={marketSelectedIds.includes(item.id)}
                        onChange={() => toggleMarketplaceItemSelection(item.id)}
                      />
                      <span>{t("extension.marketDeleteSelected")}</span>
                    </label>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.type.toUpperCase()}</span>
                    </div>
                    <p>{item.description}</p>
                    <div className="extension-chip-row">
                      {isMarketplaceItemInstalled(item) && <span className="pill">{t("extension.marketInstalledBadge")}</span>}
                      {item.category && <span className="extension-chip">{marketCategories.find((category) => category.id === item.category)?.label ?? item.category}</span>}
                      {(item.tags ?? []).slice(0, 3).map((tag) => <span className="extension-chip" key={tag}>{tag}</span>)}
                    </div>
                    <code>{item.install.kind}</code>
                    <Button size="sm" type="button" disabled={isMarketplaceItemInstalled(item)} onClick={() => void installMarketplaceItem(item)}>
                      <IconText icon={isMarketplaceItemInstalled(item) ? Check : Download}>{isMarketplaceItemInstalled(item) ? t("extension.marketInstalledBadge") : t("extension.marketInstall")}</IconText>
                    </Button>
                  </article>
                ))}
              </div>
              {!marketLoading && !visibleMarketItems.length && <span className="extension-marketplace-note">{t("extension.marketNoItems")}</span>}
            </div>
          )}
          {message && <span className="form-error">{message}</span>}
          {tab !== "market" && activeItems.map((item) => (
            <article className="extension-card" key={item.id}>
              <div className="extension-card-head">
                <strong>{item.name}</strong>
                <span>{item.source ?? item.type}</span>
              </div>
              {item.description && <p>{item.description}</p>}
              {item.type === "skill" && renderSkillCapabilityMeta(item)}
              {item.path && <code>{item.path}</code>}
              <div className="extension-card-actions">
                <button className="ghost-button icon-only" type="button" title={t("preview.details")} aria-label={t("preview.details")} onClick={() => void openExtensionDetail(item)}><IconText icon={Activity}>{t("preview.details")}</IconText></button>
                {item.type === "skill" && item.managedBy === "web" && <button className="ghost-button icon-only" type="button" title={t("extension.editSkill")} aria-label={t("extension.editSkill")} onClick={() => void openEditSkill(item)}><IconText icon={Pencil}>{t("extension.editSkill")}</IconText></button>}
                {item.type === "skill" && item.managedBy === "web" && <button className="ghost-button icon-only danger" type="button" title={t("extension.deleteSkill")} aria-label={t("extension.deleteSkill")} onClick={() => void deleteSkill(item)}><IconText icon={Trash2}>{t("extension.deleteSkill")}</IconText></button>}
                {item.path && <button className="ghost-button icon-only" type="button" title={t("extension.openDirectory")} aria-label={t("extension.openDirectory")} onClick={() => setWorkspaceRoot({ name: item.name, path: extensionDirectory(item) })}><IconText icon={FolderOpen}>{t("extension.openDirectory")}</IconText></button>}
                {item.path && <button className="ghost-button icon-only" type="button" title={t("file.copyPath")} aria-label={t("file.copyPath")} onClick={() => void copyExtensionPath(item)}><IconText icon={Copy}>{t("file.copyPath")}</IconText></button>}
              </div>
            </article>
          ))}
          {tab !== "market" && extensionHasMore[tab] && <button className="ghost-button load-more" type="button" disabled={loading} onClick={() => void loadExtensionType(tab, false, extensionSearch)}>{t("session.loadMore")}</button>}
          {tab !== "market" && !loading && !activeItems.length && <div className="empty-state">{t("extension.noItems")}</div>}
        </section>
      </section>
      {selectedExtension && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{selectedExtension.name}</strong>
              <span>{selectedExtension.type} · {selectedExtension.source ?? t("extension.local")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => {
              setSelectedExtension(null);
              setExtensionDetail(null);
            }}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            {(extensionDetail?.item.description ?? selectedExtension.description) && <p>{extensionDetail?.item.description ?? selectedExtension.description}</p>}
            {(extensionDetail?.item.path ?? selectedExtension.path) && <code>{extensionDetail?.item.path ?? selectedExtension.path}</code>}
            <pre className="extension-detail-content">{extensionDetail?.content ?? t("extension.readingDetail")}</pre>
          </div>
        </div>
      )}
      {marketImportOpen && (
        <div className="workspace-modal compact-modal skill-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("extension.marketImportCatalog")}</strong>
              <span>{t("extension.marketImportSubtitle")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setMarketImportOpen(false)}>{t("action.close")}</button>
          </div>
          <form className="management-form" onSubmit={importMarketplace}>
            <label>
              <span>{t("extension.marketImportUrl")}</span>
              <input name="extension-market-import-url" value={marketImportForm.url ?? ""} onChange={(event) => setMarketImportForm((current) => ({ ...current, url: event.target.value }))} placeholder={t("extension.marketImportUrlPlaceholder")} />
            </label>
            <label>
              <span>{t("extension.marketImportContent")}</span>
              <textarea name="extension-market-import-content" value={marketImportForm.content ?? ""} onChange={(event) => setMarketImportForm((current) => ({ ...current, content: event.target.value }))} placeholder={t("extension.marketImportContentPlaceholder")} rows={10} />
            </label>
            <div className="settings-actions">
              <Button variant="outline" type="button" onClick={() => setMarketImportOpen(false)}>{t("action.cancel")}</Button>
              <Button type="submit" disabled={marketImporting}>{marketImporting ? t("session.loading") : t("extension.marketImportCatalog")}</Button>
            </div>
          </form>
        </div>
      )}
      {showLegacyExtensionEntryPoints && skillCreateOpen && (
        <div className="workspace-modal compact-modal skill-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{editingSkill ? t("extension.editSkill") : t("extension.addSkill")}</strong>
              <span>{editingSkill ? t("extension.editSkillSubtitle") : t("extension.addSkillSubtitle")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => {
              setSkillCreateOpen(false);
              setEditingSkill(null);
            }}>{t("action.close")}</button>
          </div>
          <form className="management-form" onSubmit={saveSkill}>
            <label>
              <span>{t("extension.skillName")}</span>
              <input name="extension-skill-name" value={skillForm.name} onChange={(event) => setSkillForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("extension.skillNamePlaceholder")} required />
            </label>
            <label>
              <span>{t("extension.skillDescription")}</span>
              <input name="extension-skill-description" value={skillForm.description} onChange={(event) => setSkillForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("extension.skillDescriptionPlaceholder")} required />
            </label>
            <label>
              <span>{t("extension.skillInstructions")}</span>
              <textarea name="extension-skill-instructions" value={skillForm.instructions} onChange={(event) => setSkillForm((current) => ({ ...current, instructions: event.target.value }))} placeholder={t("extension.skillInstructionsPlaceholder")} rows={8} required />
            </label>
            <div className="settings-actions">
              <Button variant="outline" type="button" onClick={() => {
                setSkillCreateOpen(false);
                setEditingSkill(null);
              }}>{t("action.cancel")}</Button>
              <Button type="submit" disabled={skillSaving}><IconText icon={Save}>{skillSaving ? t("session.loading") : t("action.save")}</IconText></Button>
            </div>
          </form>
        </div>
      )}
      {showLegacyExtensionEntryPoints && skillImportOpen && (
        <div className="workspace-modal compact-modal skill-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("extension.importSkill")}</strong>
              <span>{t("extension.importSkillSubtitle")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setSkillImportOpen(false)}>{t("action.close")}</button>
          </div>
          <form className="management-form" onSubmit={importSkill}>
            <label>
              <span>{t("extension.skillImportUrl")}</span>
              <input name="extension-skill-import-url" value={skillImportForm.url ?? ""} onChange={(event) => setSkillImportForm((current) => ({ ...current, url: event.target.value }))} placeholder={t("extension.skillImportUrlPlaceholder")} />
            </label>
            <label>
              <span>{t("extension.skillImportContent")}</span>
              <textarea name="extension-skill-import-content" value={skillImportForm.content ?? ""} onChange={(event) => setSkillImportForm((current) => ({ ...current, content: event.target.value }))} placeholder={t("extension.skillImportContentPlaceholder")} rows={8} />
            </label>
            <div className="settings-actions">
              <Button variant="outline" type="button" onClick={() => setSkillImportOpen(false)}>{t("action.cancel")}</Button>
              <Button type="submit" disabled={skillImporting}><IconText icon={Download}>{skillImporting ? t("session.loading") : t("extension.importSkill")}</IconText></Button>
            </div>
          </form>
        </div>
      )}
      {showLegacyExtensionEntryPoints && pluginCreateOpen && (
        <div className="workspace-modal compact-modal skill-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("extension.addPlugin")}</strong>
              <span>{t("extension.addPluginSubtitle")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setPluginCreateOpen(false)}>{t("action.close")}</button>
          </div>
          <form className="management-form" onSubmit={createPlugin}>
            <label>
              <span>{t("extension.pluginName")}</span>
              <input name="extension-plugin-name" value={pluginForm.name} onChange={(event) => setPluginForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("extension.pluginNamePlaceholder")} required />
            </label>
            <label>
              <span>{t("extension.pluginDescription")}</span>
              <input name="extension-plugin-description" value={pluginForm.description ?? ""} onChange={(event) => setPluginForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("extension.pluginDescriptionPlaceholder")} />
            </label>
            <div className="settings-actions">
              <Button variant="outline" type="button" onClick={() => setPluginCreateOpen(false)}>{t("action.cancel")}</Button>
              <Button type="submit" disabled={pluginSaving}><IconText icon={Save}>{pluginSaving ? t("session.loading") : t("action.save")}</IconText></Button>
            </div>
          </form>
        </div>
      )}
      {showLegacyExtensionEntryPoints && mcpCreateOpen && (
        <div className="workspace-modal compact-modal skill-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("extension.addMcp")}</strong>
              <span>{t("extension.addMcpSubtitle")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setMcpCreateOpen(false)}>{t("action.close")}</button>
          </div>
          <form className="management-form" onSubmit={createMcp}>
            <label>
              <span>{t("extension.mcpName")}</span>
              <input name="extension-mcp-name" value={mcpForm.name} onChange={(event) => setMcpForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("extension.mcpNamePlaceholder")} required />
            </label>
            <label>
              <span>{t("extension.mcpCommand")}</span>
              <input name="extension-mcp-command" value={mcpForm.command} onChange={(event) => setMcpForm((current) => ({ ...current, command: event.target.value }))} placeholder={t("extension.mcpCommandPlaceholder")} required />
            </label>
            <label>
              <span>{t("extension.mcpArgs")}</span>
              <input name="extension-mcp-args" value={mcpForm.args} onChange={(event) => setMcpForm((current) => ({ ...current, args: event.target.value }))} placeholder={t("extension.mcpArgsPlaceholder")} />
            </label>
            <label>
              <span>{t("extension.mcpEnv")}</span>
              <textarea name="extension-mcp-env" value={mcpForm.env} onChange={(event) => setMcpForm((current) => ({ ...current, env: event.target.value }))} placeholder={t("extension.mcpEnvPlaceholder")} rows={4} />
            </label>
            <div className="settings-actions">
              <Button variant="outline" type="button" onClick={() => setMcpCreateOpen(false)}>{t("action.cancel")}</Button>
              <Button type="submit" disabled={mcpSaving}><IconText icon={Save}>{mcpSaving ? t("session.loading") : t("action.save")}</IconText></Button>
            </div>
          </form>
        </div>
      )}
      {showLegacyExtensionEntryPoints && mcpImportOpen && (
        <div className="workspace-modal compact-modal skill-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("extension.importMcp")}</strong>
              <span>{t("extension.importMcpSubtitle")}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setMcpImportOpen(false)}>{t("action.close")}</button>
          </div>
          <form className="management-form" onSubmit={importMcp}>
            <label>
              <span>{t("extension.mcpImportUrl")}</span>
              <input name="extension-mcp-import-url" value={mcpImportForm.url ?? ""} onChange={(event) => setMcpImportForm((current) => ({ ...current, url: event.target.value }))} placeholder={t("extension.mcpImportUrlPlaceholder")} />
            </label>
            <label>
              <span>{t("extension.mcpImportContent")}</span>
              <textarea name="extension-mcp-import-content" value={mcpImportForm.content ?? ""} onChange={(event) => setMcpImportForm((current) => ({ ...current, content: event.target.value }))} placeholder={t("extension.mcpImportContentPlaceholder")} rows={8} />
            </label>
            <div className="settings-actions">
              <Button variant="outline" type="button" onClick={() => setMcpImportOpen(false)}>{t("action.cancel")}</Button>
              <Button type="submit" disabled={mcpImporting}><IconText icon={Download}>{mcpImporting ? t("session.loading") : t("extension.importMcp")}</IconText></Button>
            </div>
          </form>
        </div>
      )}
      {workspaceRoot && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{workspaceRoot.name}</strong>
              <span>{workspaceRoot.path}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setWorkspaceRoot(null)}>{t("action.close")}</button>
          </div>
          <div className="workspace-modal-body">
            <FilesPage sessionToken={sessionToken} t={(key) => key} initialRootPath={workspaceRoot.path} initialMountName={workspaceRoot.name} embedded TerminalComponent={TerminalComponent} />
          </div>
        </div>
      )}
      {dialog.node}
    </main>
  );
}
