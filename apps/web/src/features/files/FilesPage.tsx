import React, { useEffect, useRef, useState } from "react";
import { Copy, Download, FilePlus2, FolderOpen, FolderPlus, Globe, MoreHorizontal, Pencil, Play, Save, Terminal as TerminalIcon, Trash2, Upload, X } from "lucide-react";
import { useAppDialog } from "@/components/AppDialog";
import { CodeEditor, preferredCodeEditorMode, type CodeEditorMode } from "@/components/CodeEditor";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { PreviewDirectoryPicker } from "@/components/PreviewDirectoryPicker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatBytes, prettyJson, renderPreviewCommand, rulesForArchiveTemplates } from "@/lib/format";
import { workspaceChangedEvent } from "@/lib/events";
import { openPreviewUrl, parsePreviewProxyPaths } from "@/lib/previews";
import type { TranslationKey } from "@/lib/i18n";
import type { ArchiveIgnoreTemplate, CreateFileMountRequest, CreateFileRequest, CreatePreviewRequest, FileArchivePreviewResponse, FileArchiveRequest, FileContentResponse, FileEntry, FileListResponse, FileMount, PreviewAccess, PreviewSummary, RenameFileRequest, UpdateFileMountRequest } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type UploadProgress = {
  destinationPath: string;
  fileCount: number;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  processing: boolean;
};

export function FilesPage({
  sessionToken,
  t,
  initialRootPath,
  initialMountName,
  initialPath,
  embedded = false,
  onOpenMainNav,
  TerminalComponent,
}: {
  sessionToken: string;
  t: TFunction;
  initialRootPath?: string;
  initialMountName?: string;
  initialPath?: string;
  embedded?: boolean;
  onOpenMainNav?: () => void;
  TerminalComponent: React.ComponentType<{ sessionToken: string; t: TFunction; initialCwd?: string; embedded?: boolean }>;
}) {
  const dialog = useAppDialog();
  const [mounts, setMounts] = useState<FileMount[]>([]);
  const [activeMountId, setActiveMountId] = useState("");
  const [currentPath, setCurrentPath] = useState(".");
  const [fileList, setFileList] = useState<FileListResponse | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileContentResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [fileVisibleCount, setFileVisibleCount] = useState(100);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [terminalCwd, setTerminalCwd] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<CodeEditorMode>(() => preferredCodeEditorMode());
  const [mountsPanelOpen, setMountsPanelOpen] = useState(false);
  const [transientRootPath, setTransientRootPath] = useState<string | null>(null);
  const [transientMountName, setTransientMountName] = useState<string | null>(null);
  const [archivePanel, setArchivePanel] = useState<{ path: string; displayPath: string } | null>(null);
  const [archiveTemplateItems, setArchiveTemplateItems] = useState<ArchiveIgnoreTemplate[]>([]);
  const [archiveTemplates, setArchiveTemplates] = useState<string[]>(["common", "sensitive"]);
  const [archiveRules, setArchiveRules] = useState("");
  const [archivePreview, setArchivePreview] = useState<FileArchivePreviewResponse | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [folderPreviewPanel, setFolderPreviewPanel] = useState<{ path: string; displayPath: string; previews: PreviewSummary[] | null } | null>(null);
  const [folderPreviewCommand, setFolderPreviewCommand] = useState("python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}");
  const [folderPreviewPort, setFolderPreviewPort] = useState("4179");
  const [folderPreviewAccess, setFolderPreviewAccess] = useState<PreviewAccess>("private");
  const [folderPreviewProxyPaths, setFolderPreviewProxyPaths] = useState("/api");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const authHeaders = { authorization: `Bearer ${sessionToken}` };
  const activeMount = mounts.find((mount) => mount.id === activeMountId) ?? mounts[0] ?? null;
  const lockedRootPath = embedded ? initialRootPath : undefined;
  const activeRootPath = lockedRootPath ?? transientRootPath ?? undefined;
  const hasFileRoot = Boolean(activeRootPath || activeMountId);
  const fileQuery = (path: string, mountIdOverride = activeMountId, rootPathOverride = activeRootPath) => new URLSearchParams({
    path,
    ...(rootPathOverride ? { rootPath: rootPathOverride } : mountIdOverride ? { mountId: mountIdOverride } : {}),
  });

  function requestedFileParamsFromHash() {
    const [, query = ""] = window.location.hash.split("?");
    const params = new URLSearchParams(query);
    return {
      path: params.get("path"),
      rootPath: params.get("rootPath"),
      mountName: params.get("mountName"),
    };
  }

  async function loadMounts() {
    const response = await fetch("/api/file-mounts", { headers: authHeaders });
    if (!response.ok) throw new Error("mounts_failed");
    const nextMounts = (await response.json()) as FileMount[];
    setMounts(nextMounts);
    setActiveMountId((current) => current && nextMounts.some((mount) => mount.id === current) ? current : nextMounts[0]?.id ?? "");
    return nextMounts;
  }

  useEffect(() => {
    if (activeRootPath) return;
    loadMounts().catch(() => setMessage(t("file.readMountsFailed")));
  }, [activeRootPath, sessionToken]);

  useEffect(() => {
    fetch("/api/files/archive/templates", { headers: authHeaders })
      .then((response) => response.ok ? response.json() : [])
      .then((templates: ArchiveIgnoreTemplate[]) => {
        setArchiveTemplateItems(templates);
        const defaultIds = templates.filter((template) => ["common", "sensitive"].includes(template.id)).map((template) => template.id);
        setArchiveTemplates(defaultIds);
        setArchiveRules(rulesForArchiveTemplates(templates, defaultIds));
      })
      .catch(() => undefined);
  }, [sessionToken]);

  useEffect(() => {
    if (!activeRootPath && !activeMountId) return;
    setMessage("");
    fetch(`/api/files?${fileQuery(currentPath)}`, { headers: authHeaders })
      .then((response) => {
        if (!response.ok) throw new Error("file_list_failed");
        return response.json();
      })
      .then((nextList: FileListResponse) => {
        setFileList(nextList);
        if (!pendingOpenPath) {
          setSelectedEntry(null);
          setSelectedFile(null);
          setDraft("");
          setDirty(false);
        }
      })
      .catch(() => {
        setFileList({ mountId: activeMountId, root: activeRootPath ?? activeMount?.rootPath ?? "", path: currentPath, parentPath: null, entries: [] });
        setMessage(t("file.readDirectoryFailed"));
      });
  }, [activeMountId, activeRootPath, currentPath, reloadKey, sessionToken, pendingOpenPath]);

  useEffect(() => {
    setFileVisibleCount(100);
  }, [activeMountId, activeRootPath, currentPath, fileFilter, reloadKey]);

  useEffect(() => {
    function handleWorkspaceChanged() {
      if (dirty) return;
      setReloadKey((key) => key + 1);
    }
    window.addEventListener(workspaceChangedEvent, handleWorkspaceChanged);
    return () => window.removeEventListener(workspaceChangedEvent, handleWorkspaceChanged);
  }, [dirty]);

  useEffect(() => {
    if (!uploading) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [uploading]);

  function switchMount(mountId: string) {
    setTransientRootPath(null);
    setTransientMountName(null);
    setActiveMountId(mountId);
    setMountsPanelOpen(false);
    setCurrentPath(".");
    setFileList(null);
    setSelectedEntry(null);
    setSelectedFile(null);
    setDraft("");
    setDirty(false);
  }

  async function openEntry(entry: FileEntry) {
    setMessage("");
    if (entry.kind === "directory") {
      if (selectedEntry?.kind === "directory" && selectedEntry.path === entry.path) {
        setCurrentPath(entry.path);
        return;
      }
      setSelectedEntry(entry);
      if (!dirty) {
        setSelectedFile(null);
        setDraft("");
      }
      return;
    }

    if (selectedEntry?.kind === "file" && selectedEntry.path === entry.path) {
      setSelectedEntry(entry);
    } else {
      setSelectedEntry(entry);
      if (!dirty) {
        setSelectedFile(null);
        setDraft("");
      }
      return;
    }
    const response = await fetch(`/api/files/content?${fileQuery(entry.path)}`, {
      headers: authHeaders,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(`${t("file.readFileFailed")}：${error?.error ?? t("file.readFileLimitHint")}`);
      return;
    }

    const nextFile = (await response.json()) as FileContentResponse;
    setSelectedFile(nextFile);
    setDraft(nextFile.content);
    setDirty(false);
  }

  async function openPath(path: string, mountIdOverride = activeMountId, rootPathOverride = activeRootPath) {
    const parent = path.includes("/") ? path.split("/").slice(0, -1).join("/") || "." : ".";
    setPendingOpenPath(path);
    setCurrentPath(parent);
    await openFilePath(path, mountIdOverride, rootPathOverride);
    setPendingOpenPath(null);
  }

  async function openFilePath(path: string, mountIdOverride = activeMountId, rootPathOverride = activeRootPath) {
    const response = await fetch(`/api/files/content?${fileQuery(path, mountIdOverride, rootPathOverride)}`, {
      headers: authHeaders,
    });
    if (!response.ok) return;
    const nextFile = (await response.json()) as FileContentResponse;
    setSelectedEntry({ name: path.split("/").at(-1) ?? path, path, kind: "file", size: nextFile.content.length, updatedAt: nextFile.updatedAt });
    setSelectedFile(nextFile);
    setDraft(nextFile.content);
    setDirty(false);
  }

  useEffect(() => {
    const hashParams = requestedFileParamsFromHash();
    const path = lockedRootPath ? initialPath ?? null : hashParams.path;
    const rootPath = lockedRootPath ?? hashParams.rootPath;
    const mountName = initialMountName ?? hashParams.mountName;
    if (lockedRootPath) {
      if (path) {
        void openPath(path);
        return;
      }
      setCurrentPath(".");
      setFileList(null);
      setSelectedEntry(null);
      setSelectedFile(null);
      setDraft("");
      setDirty(false);
      setReloadKey((key) => key + 1);
      return;
    }
    if (rootPath) {
      setTransientRootPath(rootPath);
      setTransientMountName(mountName ?? "Session Workspace");
      setCurrentPath(".");
      setFileList(null);
      setSelectedEntry(null);
      setSelectedFile(null);
      setDraft("");
      setDirty(false);
      if (path) window.setTimeout(() => void openPath(path, "", rootPath), 0);
      else setReloadKey((key) => key + 1);
      return;
    }
    if (path) void openPath(path);
  }, [initialMountName, initialPath, lockedRootPath, sessionToken]);

  async function createEntry(kind: CreateFileRequest["kind"]) {
    const name = await dialog.prompt({
      title: kind === "directory" ? t("file.newDirectory") : t("file.newFile"),
      message: t("file.createInPath").replace("{path}", absoluteFilePath(fileList?.path ?? currentPath)),
      placeholder: kind === "directory" ? t("file.directoryName") : t("file.fileName"),
      confirmLabel: t("action.create"),
    });
    if (!name) return;
    setMessage("");
    const body: CreateFileRequest = {
      parentPath: fileList?.path ?? currentPath,
      name,
      kind,
    };
    const response = await fetch(`/api/files?${new URLSearchParams(activeRootPath ? { rootPath: activeRootPath } : activeMountId ? { mountId: activeMountId } : {})}`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.createFailed"));
      return;
    }
    setReloadKey((key) => key + 1);
  }

  async function uploadFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) return;
    const destinationPath = selectedDirectoryRelativePath();
    const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    setUploading(true);
    setUploadProgress({
      destinationPath,
      fileCount: selectedFiles.length,
      loadedBytes: 0,
      totalBytes,
      percent: 0,
      processing: false,
    });
    setMessage("");
    try {
      const form = new FormData();
      selectedFiles.forEach((file) => form.append("files", file, file.name));
      const response = await uploadFormData(`/api/files/upload?${fileQuery(destinationPath)}`, form, ({ loaded, total, processing }) => {
        const denominator = total || totalBytes;
        const loadedBytes = denominator > 0 && totalBytes > 0
          ? Math.min(totalBytes, Math.round((loaded / denominator) * totalBytes))
          : loaded;
        const percent = denominator > 0
          ? Math.min(processing ? 100 : 99, Math.round((loaded / denominator) * 100))
          : 0;
        setUploadProgress({
          destinationPath,
          fileCount: selectedFiles.length,
          loadedBytes: processing ? totalBytes : loadedBytes,
          totalBytes,
          percent,
          processing,
        });
      });
      if (!response.ok) {
        const error = parseJson<{ error?: string }>(response.text);
        setMessage(error?.error === "already_exists" ? t("file.uploadConflict") : t("file.uploadFailed"));
        return;
      }
      setSelectedEntry(null);
      setSelectedFile(null);
      setDraft("");
      setDirty(false);
      setMessage(t("file.uploaded").replace("{count}", String(selectedFiles.length)));
      if ((fileList?.path ?? currentPath) !== destinationPath) setCurrentPath(destinationPath);
      else setReloadKey((key) => key + 1);
    } catch {
      setMessage(t("file.uploadFailed"));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  function uploadFormData(url: string, form: FormData, onProgress: (progress: { loaded: number; total: number; processing: boolean }) => void) {
    return new Promise<{ ok: boolean; status: number; text: string }>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", url);
      request.setRequestHeader("authorization", authHeaders.authorization);
      request.upload.onprogress = (event) => {
        onProgress({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : 0,
          processing: false,
        });
      };
      request.upload.onload = () => onProgress({ loaded: 1, total: 1, processing: true });
      request.onload = () => {
        onProgress({ loaded: 1, total: 1, processing: true });
        resolve({ ok: request.status >= 200 && request.status < 300, status: request.status, text: request.responseText });
      };
      request.onerror = () => reject(new Error("upload_failed"));
      request.onabort = () => reject(new Error("upload_aborted"));
      request.send(form);
    });
  }

  function parseJson<T>(text: string): T | null {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async function renameEntry() {
    if (!selectedEntry) return;
    const newName = await dialog.prompt({
      title: t("action.rename"),
      message: absoluteFilePath(selectedEntry.path),
      defaultValue: selectedEntry.name,
      placeholder: t("action.rename"),
      confirmLabel: t("action.rename"),
    });
    if (!newName || newName === selectedEntry.name) return;
    setMessage("");
    const body: RenameFileRequest = {
      path: selectedEntry.path,
      newName,
    };
    const response = await fetch(`/api/files?${new URLSearchParams(activeRootPath ? { rootPath: activeRootPath } : activeMountId ? { mountId: activeMountId } : {})}`, {
      method: "PATCH",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.renameFailed"));
      return;
    }
    setSelectedFile(null);
    setSelectedEntry(null);
    setDraft("");
    setDirty(false);
    setReloadKey((key) => key + 1);
  }

  async function deleteEntry() {
    if (!selectedEntry) return;
    const targetPath = absoluteFilePath(selectedEntry.path);
    const confirmed = await dialog.confirm({
      title: selectedEntry.kind === "directory" ? t("file.deleteDirectory") : t("file.deleteFile"),
      message: selectedEntry.kind === "directory"
        ? t("file.deleteDirectoryMessage").replace("{path}", targetPath)
        : targetPath,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    setMessage("");
    const response = await fetch(`/api/files?${fileQuery(selectedEntry.path)}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      setMessage(t("file.deleteFailed"));
      return;
    }
    setSelectedFile(null);
    setSelectedEntry(null);
    setDraft("");
    setDirty(false);
    setReloadKey((key) => key + 1);
  }

  async function saveFile() {
    if (!selectedFile) return;
    setMessage("");
    const response = await fetch(`/api/files/content?${fileQuery(selectedFile.path)}`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: draft }),
    });
    if (!response.ok) {
      setMessage(t("file.saveFailed"));
      return;
    }

    const nextFile = (await response.json()) as FileContentResponse;
    setSelectedFile(nextFile);
    setDraft(nextFile.content);
    setDirty(false);
    setMessage(t("file.saved"));
  }

  function absoluteFilePath(path: string) {
    const root = fileList?.root ?? activeRootPath ?? activeMount?.rootPath ?? "";
    if (!root) return path;
    if (path === ".") return root;
    return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  function selectedDirectoryPath() {
    if (selectedEntry?.kind === "directory") return absoluteFilePath(selectedEntry.path);
    if (selectedEntry?.kind === "file") {
      const parent = selectedEntry.path.includes("/") ? selectedEntry.path.split("/").slice(0, -1).join("/") || "." : ".";
      return absoluteFilePath(parent);
    }
    return absoluteFilePath(fileList?.path ?? currentPath);
  }

  function selectedDirectoryRelativePath() {
    if (selectedEntry?.kind === "directory") return selectedEntry.path;
    if (selectedEntry?.kind === "file") return selectedEntry.path.includes("/") ? selectedEntry.path.split("/").slice(0, -1).join("/") || "." : ".";
    return fileList?.path ?? currentPath;
  }

  async function closeSelectedFile() {
    if (dirty) {
      const confirmed = await dialog.confirm({
        title: t("file.unsavedChanges"),
        message: selectedFile?.path ?? selectedEntry?.path ?? "",
        confirmLabel: t("action.close"),
        danger: true,
      });
      if (!confirmed) return;
    }
    setSelectedEntry(null);
    setSelectedFile(null);
    setDraft("");
    setDirty(false);
  }

  async function copyCurrentPath() {
    await navigator.clipboard?.writeText(selectedEntry ? absoluteFilePath(selectedEntry.path) : absoluteFilePath(fileList?.path ?? currentPath)).catch(() => undefined);
    setMessage(t("file.pathCopied"));
  }

  function openTerminalHere() {
    setTerminalCwd(selectedDirectoryPath());
  }

  function openArchivePanel() {
    const path = selectedEntry?.kind === "directory" ? selectedEntry.path : fileList?.path ?? currentPath;
    setArchivePanel({ path, displayPath: absoluteFilePath(path) });
    setArchivePreview(null);
  }

  async function openFolderPreviewPanel() {
    const path = selectedDirectoryRelativePath();
    const displayPath = absoluteFilePath(path);
    setFolderPreviewPanel({ path: displayPath, displayPath, previews: null });
    await loadFolderPreviews(displayPath);
  }

  async function loadFolderPreviews(displayPath: string) {
    const params = new URLSearchParams({ scopeType: "folder", scopeId: displayPath });
    const response = await fetch(`/api/previews?${params}`, { headers: authHeaders });
    if (!response.ok) {
      setMessage(t("project.previewReadFailed"));
      setFolderPreviewPanel((current) => current?.path === displayPath ? { ...current, previews: [] } : current);
      return;
    }
    const previews = (await response.json()) as PreviewSummary[];
    setFolderPreviewPanel((current) => current?.path === displayPath ? { ...current, previews } : current);
  }

  async function createFolderPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!folderPreviewPanel) return;
    const folderName = folderPreviewPanel.displayPath.split("/").filter(Boolean).at(-1) ?? "folder";
    const body: CreatePreviewRequest = {
      scopeType: "folder",
      scopeId: folderPreviewPanel.displayPath,
      label: `${folderName}:${folderPreviewPort}`,
      targetHost: "127.0.0.1",
      port: Number(folderPreviewPort),
      command: renderPreviewCommand(folderPreviewCommand, folderPreviewPort, "."),
      cwd: ".",
      access: folderPreviewAccess,
      proxyPaths: parsePreviewProxyPaths(folderPreviewProxyPaths),
      autoStart: true,
    };
    const response = await fetch("/api/previews", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(result?.error ? `${t("project.previewStartFailed")}：${result.error}` : t("project.previewStartFailed"));
      if (response.status === 409 && result?.error === "approval_required") await loadFolderPreviews(folderPreviewPanel.displayPath);
      return;
    }
    const preview = (await response.json()) as PreviewSummary;
    setFolderPreviewPanel((current) => current ? { ...current, previews: [preview, ...(current.previews ?? []).filter((item) => item.id !== preview.id)] } : current);
    setMessage(t("project.previewStarted"));
  }

  async function stopFolderPreview(preview: PreviewSummary) {
    const response = await fetch(`/api/previews/${preview.id}/stop`, {
      method: "POST",
      headers: authHeaders,
    });
    if (!response.ok) return;
    const nextPreview = (await response.json()) as PreviewSummary;
    setFolderPreviewPanel((current) => current ? { ...current, previews: (current.previews ?? []).map((item) => item.id === nextPreview.id ? nextPreview : item) } : current);
  }

  async function deleteFolderPreview(preview: PreviewSummary) {
    const confirmed = await dialog.confirm({
      title: t("project.deletePreview"),
      message: `${preview.label}\n${preview.targetHost}:${preview.port}`,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/previews/${preview.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      setMessage(t("project.previewDeleteFailed"));
      return;
    }
    setFolderPreviewPanel((current) => current ? { ...current, previews: (current.previews ?? []).filter((item) => item.id !== preview.id) } : current);
    setMessage(t("project.previewDeleted"));
  }

  useEffect(() => {
    if (!folderPreviewPanel?.previews?.some((preview) => preview.status === "starting")) return;
    const timer = window.setTimeout(() => void loadFolderPreviews(folderPreviewPanel.displayPath), 1500);
    return () => window.clearTimeout(timer);
  }, [folderPreviewPanel, sessionToken]);

  function toggleArchiveTemplate(templateId: string) {
    setArchiveTemplates((current) => {
      const next = current.includes(templateId) ? current.filter((id) => id !== templateId) : [...current, templateId];
      setArchiveRules(rulesForArchiveTemplates(archiveTemplateItems, next));
      setArchivePreview(null);
      return next;
    });
  }

  function archiveRequestBody(): FileArchiveRequest | null {
    if (!archivePanel) return null;
    return {
      path: archivePanel.path,
      ...(activeRootPath ? { rootPath: activeRootPath } : activeMountId ? { mountId: activeMountId } : {}),
      excludes: archiveRules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    };
  }

  async function previewArchive() {
    const body = archiveRequestBody();
    if (!body) return;
    setArchiveBusy(true);
    try {
      const response = await fetch("/api/files/archive/preview", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage(t("file.archivePreviewFailed"));
        return;
      }
      setArchivePreview((await response.json()) as FileArchivePreviewResponse);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function downloadArchive() {
    const body = archiveRequestBody();
    if (!body) return;
    if (archivePreview && archivePreview.bytes > 500 * 1024 * 1024 && !window.confirm(t("file.archiveLargeConfirm").replace("{size}", formatBytes(archivePreview.bytes)))) return;
    setArchiveBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/files/archive", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage(t("file.archiveFailed"));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const filename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "archive.zip";
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setArchivePanel(null);
      setMessage(t("file.archiveStarted"));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function createMount() {
    const name = await dialog.prompt({ title: t("file.addMount"), placeholder: t("file.mountName"), confirmLabel: t("file.next") });
    if (!name) return;
    const rootPath = await dialog.prompt({
      title: t("file.mountPath"),
      message: t("file.mountNameMessage").replace("{name}", name),
      defaultValue: "",
      placeholder: t("file.localPath"),
      confirmLabel: t("file.addMount"),
    });
    if (rootPath === null) return;
    const trimmedRootPath = rootPath.trim();
    if (!trimmedRootPath) {
      setMessage(t("file.mountPathRequired"));
      return;
    }
    setMessage("");
    const body: CreateFileMountRequest = { name, rootPath: trimmedRootPath };
    const response = await fetch("/api/file-mounts", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.addMountFailed"));
      return;
    }
    const mount = (await response.json()) as FileMount;
    await loadMounts();
    switchMount(mount.id);
  }

  async function editMount(mount: FileMount) {
    const name = await dialog.prompt({ title: t("file.editMountName"), defaultValue: mount.name, placeholder: t("file.mountName") });
    if (!name) return;
    const rootPath = await dialog.prompt({ title: t("file.editMountPath"), defaultValue: mount.rootPath, placeholder: t("file.localPath") });
    if (!rootPath) return;
    setMessage("");
    const body: UpdateFileMountRequest = { name, rootPath };
    const response = await fetch(`/api/file-mounts/${mount.id}`, {
      method: "PATCH",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      setMessage(t("file.updateMountFailed"));
      return;
    }
    await loadMounts();
    setReloadKey((key) => key + 1);
  }

  async function deleteMount(mount: FileMount) {
    const confirmed = await dialog.confirm({
      title: t("file.removeMount"),
      message: `${mount.name} · ${mount.rootPath}\n${t("file.removeMountHint")}`,
      confirmLabel: t("file.removeMount"),
      danger: true,
    });
    if (!confirmed) return;
    setMessage("");
    const response = await fetch(`/api/file-mounts/${mount.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!response.ok) {
      setMessage(t("file.removeMountFailed"));
      return;
    }
    await loadMounts();
    setCurrentPath(".");
    setFileList(null);
    setSelectedEntry(null);
    setSelectedFile(null);
    setDraft("");
    setDirty(false);
  }

  const selectedPath = selectedEntry?.path ?? selectedFile?.path;
  const filteredFileEntries = fileList?.entries.filter((entry) => entry.name.toLowerCase().includes(fileFilter.trim().toLowerCase())) ?? [];
  const visibleFileEntries = filteredFileEntries.slice(0, fileVisibleCount);
  const fileCountText = fileList
    ? fileFilter.trim()
      ? t("file.filteredItemCount").replace("{visible}", String(Math.min(visibleFileEntries.length, filteredFileEntries.length))).replace("{filtered}", String(filteredFileEntries.length)).replace("{total}", String(fileList.entries.length))
      : t("file.itemCount").replace("{visible}", String(Math.min(visibleFileEntries.length, filteredFileEntries.length))).replace("{total}", String(fileList.entries.length))
    : t("file.itemCount").replace("{visible}", "0").replace("{total}", "0");
  const groupedArchiveTemplates = archiveTemplateItems.reduce<Array<{ group: string; templates: ArchiveIgnoreTemplate[] }>>((groups, template) => {
    const group = groups.find((item) => item.group === template.group);
    if (group) group.templates.push(template);
    else groups.push({ group: template.group, templates: [template] });
    return groups;
  }, []);

  function renderMounts() {
    return (
      <>
        <div className="pane-title">{t("file.mounts")}</div>
        <button className="ghost-button mount-add icon-only" type="button" title={t("file.addMount")} aria-label={t("file.addMount")} onClick={createMount}><IconText icon={FolderPlus}>{t("file.addMount")}</IconText></button>
        {mounts.map((mount) => (
          <div className={`mount-row ${mount.id === activeMountId ? "active" : ""}`} key={mount.id}>
            <button className="mount" onClick={() => switchMount(mount.id)}>
              <strong>{mount.name}</strong><span>{mount.rootPath}</span>
            </button>
            <div className="mount-actions">
              <button type="button" onClick={() => editMount(mount)}>{t("action.edit")}</button>
              <button type="button" onClick={() => deleteMount(mount)}>{t("file.removeMount")}</button>
            </div>
          </div>
        ))}
        {!mounts.length && <div className="empty-state">{t("file.noMounts")}</div>}
      </>
    );
  }

  return (
    <main className={`files-page ${embedded ? "embedded-page" : ""}`}>
      {dialog.node}
      {!embedded && <PageHeader crumb={`${t("page.global")} / ${t("nav.files")}`} title={t("page.files")} action={t("action.refresh")} onAction={() => setReloadKey((key) => key + 1)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.files")} />}
      <section className={`file-workbench ${activeRootPath ? "locked-workspace" : ""} ${embedded && !selectedFile ? "no-preview" : ""}`}>
        {!activeRootPath && (
          <aside className="mounts-pane">
            {renderMounts()}
          </aside>
        )}
        <section className="file-list-pane">
          <div className="file-toolbar">
            <div><strong>{transientMountName ? `${transientMountName} · ${fileList?.path ?? currentPath}` : fileList?.path ?? currentPath}</strong><span className="subtle"> · {fileCountText}</span></div>
            <div className="file-actions">
              {!activeRootPath && <button className="ghost-button icon-only file-mobile-mounts" type="button" title={t("file.mounts")} aria-label={t("file.mounts")} onClick={() => setMountsPanelOpen(true)}><IconText icon={FolderOpen}>{t("file.mounts")}</IconText></button>}
              <button className="ghost-button icon-only" type="button" title={t("file.uploadFiles")} aria-label={t("file.uploadFiles")} disabled={!hasFileRoot || uploading} onClick={() => uploadInputRef.current?.click()}><IconText icon={Upload}>{t("file.uploadFiles")}</IconText></button>
              <input ref={uploadInputRef} name="fileupload" type="file" multiple hidden onChange={(event) => { void uploadFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
              <button className="ghost-button icon-only" type="button" title={t("file.newFile")} aria-label={t("file.newFile")} disabled={!hasFileRoot} onClick={() => createEntry("file")}><IconText icon={FilePlus2}>{t("file.newFile")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("file.newDirectory")} aria-label={t("file.newDirectory")} disabled={!hasFileRoot} onClick={() => createEntry("directory")}><IconText icon={FolderPlus}>{t("file.newDirectory")}</IconText></button>
              {!embedded && <button className="ghost-button icon-only" type="button" title={t("file.openTerminal")} aria-label={t("file.openTerminal")} disabled={!hasFileRoot} onClick={openTerminalHere}><IconText icon={TerminalIcon}>{t("file.openTerminal")}</IconText></button>}
              <button className="ghost-button icon-only" type="button" title={t("file.copyPath")} aria-label={t("file.copyPath")} disabled={!hasFileRoot} onClick={() => void copyCurrentPath()}><IconText icon={Copy}>{t("file.copyPath")}</IconText></button>
              <button className="ghost-button icon-only" type="button" title={t("action.rename")} aria-label={t("action.rename")} disabled={!selectedEntry} onClick={renameEntry}><IconText icon={Pencil}>{t("action.rename")}</IconText></button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ghost-button icon-only" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!hasFileRoot} onSelect={() => void openFolderPreviewPanel()}><IconText icon={Globe}>{t("file.preview")}</IconText></DropdownMenuItem>
                  <DropdownMenuItem disabled={!hasFileRoot} onSelect={() => openArchivePanel()}><IconText icon={Download}>{t("file.archiveDownload")}</IconText></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="danger-menu-item" disabled={!selectedEntry} onSelect={() => void deleteEntry()}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {uploadProgress && (
            <div className="file-upload-progress" role="status" aria-live="polite">
              <div className="file-upload-progress-head">
                <strong>{uploadProgress.processing ? t("file.uploadProcessing") : t("file.uploading").replace("{count}", String(uploadProgress.fileCount)).replace("{path}", uploadProgress.destinationPath)}</strong>
                <span>{t("file.uploadProgress").replace("{percent}", String(uploadProgress.percent)).replace("{loaded}", formatBytes(uploadProgress.loadedBytes)).replace("{total}", formatBytes(uploadProgress.totalBytes))}</span>
              </div>
              <div className="file-upload-progress-track" aria-hidden="true">
                <span style={{ width: `${uploadProgress.percent}%` }} />
              </div>
              <div className="subtle">{t("file.uploadKeepPage")}</div>
            </div>
          )}
          <input name="filefilter" className="search-input file-search-input" value={fileFilter} onChange={(event) => setFileFilter(event.target.value)} placeholder={t("file.searchCurrentDirectory")} />
          {fileList?.parentPath && (
            <button className="file-list-item" onClick={() => setCurrentPath(fileList.parentPath ?? ".")}>
              <span>↩ {t("file.parentDirectory")}</span>
              <em>{fileList.parentPath}</em>
            </button>
          )}
          {visibleFileEntries.map((entry) => (
            <button className={`file-list-item ${selectedPath === entry.path ? "active" : ""}`} key={entry.path} onClick={() => openEntry(entry)}>
              <span>{entry.kind === "directory" ? "▸" : "◇"} {entry.name}</span>
              <em>{entry.kind === "directory" ? t("file.directoryShort") : t("file.sizeKb").replace("{size}", String(Math.ceil(entry.size / 1024)))}</em>
            </button>
          ))}
          {filteredFileEntries.length > visibleFileEntries.length && (
            <button className="ghost-button load-more" type="button" onClick={() => setFileVisibleCount((count) => count + 100)}>{t("session.loadMore")}</button>
          )}
          {fileList && fileFilter && !filteredFileEntries.length && <div className="empty-state">{t("file.searchEmpty")}</div>}
          {!fileList && <div className="subtle">{hasFileRoot ? t("file.loadingFiles") : t("file.noMounts")}</div>}
        </section>
        {(!embedded || selectedFile) && <section className={`file-preview-pane ${selectedFile ? "has-file" : ""}`}>
          <div className="file-preview-head">
            <div className="file-preview-title">
              <div className="file-preview-title-line">
                <strong>{selectedFile?.path ?? t("file.selectFile")}</strong>
                <div className="file-actions preview-actions">
                  {selectedFile && (
                    <div className="editor-mode-switch" role="group" aria-label={t("file.editorMode")}>
                      {(["monaco", "codemirror", "textarea"] as CodeEditorMode[]).map((mode) => (
                        <button
                          className={`editor-mode-button ${editorMode === mode ? "active" : ""}`}
                          type="button"
                          key={mode}
                          onClick={() => setEditorMode(mode)}
                          title={mode === "monaco" ? t("file.editorMonaco") : mode === "codemirror" ? t("file.editorCodeMirror") : t("file.editorPlainText")}
                        >
                          {mode === "monaco" ? t("file.editorMonacoShort") : mode === "codemirror" ? t("file.editorCodeMirrorShort") : t("file.editorPlainTextShort")}
                        </button>
                      ))}
                    </div>
                  )}
                  <button className="ghost-button icon-only file-preview-close" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={() => void closeSelectedFile()}><IconText icon={X}>{t("action.close")}</IconText></button>
                  <button className="ghost-button icon-only" title={t("action.save")} aria-label={t("action.save")} disabled={!selectedFile || !dirty} onClick={saveFile}><IconText icon={Save}>{t("action.save")}</IconText></button>
                </div>
              </div>
              <div className="subtle">{message || (dirty ? t("file.unsavedChanges") : t("file.globalFileView"))}</div>
            </div>
          </div>
          {selectedFile ? (
            <CodeEditor
              mode={editorMode}
              value={draft}
              path={selectedFile.path}
              onChange={(value) => {
                setDraft(value);
                setDirty(true);
              }}
            />
          ) : (
            <div className="empty-state">{t("file.chooseTextFile")}</div>
          )}
        </section>}
      </section>
      {!activeRootPath && mountsPanelOpen && (
        <div className="workspace-modal compact-modal file-mounts-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("file.mounts")}</strong>
              <span>{activeMount?.name ?? ""}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setMountsPanelOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <div className="mounts-pane modal-mounts-pane">
            {renderMounts()}
          </div>
        </div>
      )}
      {archivePanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("file.archiveDownload")}</strong>
              <span>{archivePanel.displayPath}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setArchivePanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail archive-dialog">
            {groupedArchiveTemplates.map((group) => (
              <section className="archive-template-group" key={group.group}>
                <strong>{group.group}</strong>
                <div className="archive-template-grid">
                  {group.templates.map((template) => (
                    <label className="checkbox-row" key={template.id}>
                      <input name="archivetemplates-includes-template-id" type="checkbox" checked={archiveTemplates.includes(template.id)} onChange={() => toggleArchiveTemplate(template.id)} />
                      <span>{template.name}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
            <label className="archive-rules-field">
              <span>{t("file.archiveExcludeRules")}</span>
              <textarea name="archiverules" className="large-code archive-rules" value={archiveRules} spellCheck={false} onChange={(event) => {
                setArchiveRules(event.target.value);
                setArchivePreview(null);
              }} />
            </label>
            {archivePreview && (
              <section className="archive-preview-summary">
                <strong>{t("file.archivePreview")}</strong>
                <span>{t("file.archivePreviewStats").replace("{files}", String(archivePreview.files)).replace("{size}", formatBytes(archivePreview.bytes)).replace("{excluded}", String(archivePreview.excluded))}</span>
                {archivePreview.excludedExamples.length > 0 && (
                  <code>{archivePreview.excludedExamples.join("\n")}</code>
                )}
              </section>
            )}
            <div className="settings-actions">
              <button className="ghost-button" type="button" onClick={() => setArchivePanel(null)}>{t("action.cancel")}</button>
              <button className="ghost-button" type="button" disabled={archiveBusy} onClick={() => void previewArchive()}>{t("file.archivePreview")}</button>
              <button className="dark-button" type="button" disabled={archiveBusy} onClick={() => void downloadArchive()}><IconText icon={Download}>{t("file.archiveDownload")}</IconText></button>
            </div>
          </div>
        </div>
      )}
      {folderPreviewPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("file.previewFolder")}</strong>
              <span>{folderPreviewPanel.displayPath}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setFolderPreviewPanel(null)}>{t("action.close")}</button>
          </div>
          <div className="extension-detail">
            <form className="preview-form" onSubmit={createFolderPreview}>
              <label>
                <span>{t("project.previewCommand")}</span>
                <input name="folder-preview-command" value={folderPreviewCommand} onChange={(event) => setFolderPreviewCommand(event.target.value)} placeholder="python3 -m http.server {port} --bind 127.0.0.1 --directory {dir}" required />
              </label>
              <label>
                <span>{t("project.previewDirectory")}</span>
                <input name="folder-preview-directory" value={folderPreviewPanel.displayPath} readOnly />
              </label>
              <label>
                <span>{t("project.previewPort")}</span>
                <input name="folder-preview-port" value={folderPreviewPort} onChange={(event) => setFolderPreviewPort(event.target.value)} inputMode="numeric" placeholder="4179" required />
              </label>
              <label>
                <span>{t("preview.access")}</span>
                <select name="folder-preview-access" value={folderPreviewAccess} onChange={(event) => setFolderPreviewAccess(event.target.value as PreviewAccess)}>
                  <option value="private">{t("preview.private")}</option>
                  <option value="public">{t("preview.public")}</option>
                </select>
              </label>
              <label>
                <span>{t("preview.proxyPaths")}</span>
                <textarea name="folder-preview-proxy-paths" value={folderPreviewProxyPaths} onChange={(event) => setFolderPreviewProxyPaths(event.target.value)} placeholder="/api&#10;/trpc" rows={3} />
              </label>
              <button className="ghost-button" type="submit"><IconText icon={Play}>{t("project.startPreview")}</IconText></button>
            </form>
            {!folderPreviewPanel.previews && <div className="subtle">{t("project.loadingPreviews")}</div>}
            {folderPreviewPanel.previews?.map((preview) => (
              <div className="preview-row" key={preview.id}>
                <div>
                  <strong>{preview.label}</strong>
                  <span>{preview.status} · {preview.access} · {preview.targetHost}:{preview.port}</span>
                  {preview.command && <code>{preview.command}</code>}
                </div>
                <div className="preview-actions">
                  <button className="ghost-button" type="button" onClick={() => void openPreviewUrl(preview, sessionToken, undefined, t)}>{t("project.openPreview")}</button>
                  <button className="ghost-button" type="button" disabled={preview.status !== "running" && preview.status !== "starting"} onClick={() => void stopFolderPreview(preview)}>{t("action.disconnect")}</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void deleteFolderPreview(preview)}>{t("action.delete")}</button>
                </div>
              </div>
            ))}
            {folderPreviewPanel.previews && !folderPreviewPanel.previews.length && <div className="empty-state">{t("project.noPreviews")}</div>}
          </div>
        </div>
      )}
      {terminalCwd && (
        <div className="workspace-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("page.terminal")}</strong>
              <span>{terminalCwd}</span>
            </div>
            <button className="ghost-button" type="button" onClick={() => setTerminalCwd(null)}>{t("action.close")}</button>
          </div>
          <div className="workspace-modal-body">
            <TerminalComponent sessionToken={sessionToken} t={t} initialCwd={terminalCwd} embedded />
          </div>
        </div>
      )}
    </main>
  );
}
