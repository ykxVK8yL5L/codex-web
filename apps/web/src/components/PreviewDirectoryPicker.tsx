import { useState } from "react";
import { FolderOpen, X } from "lucide-react";
import type { FileListResponse } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export function PreviewDirectoryPicker({
  sessionToken,
  rootPath,
  value,
  onChange,
  placeholder,
  t,
}: {
  sessionToken: string;
  rootPath: string | null | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState(".");
  const [fileList, setFileList] = useState<FileListResponse | null>(null);
  const [error, setError] = useState("");

  async function loadDirectory(path: string) {
    if (!rootPath) return;
    setCurrentPath(path || ".");
    setFileList(null);
    setError("");
    const params = new URLSearchParams({ rootPath, path: path || "." });
    const response = await fetch(`/api/files?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      setError(t("project.directoryReadFailed"));
      setFileList(null);
      return;
    }
    setFileList((await response.json()) as FileListResponse);
  }

  function openPicker() {
    const nextPath = value.trim() || ".";
    setOpen(true);
    void loadDirectory(nextPath);
  }

  function selectCurrentDirectory() {
    onChange(fileList?.path || currentPath || ".");
    setOpen(false);
  }

  const directories = fileList?.entries.filter((entry) => entry.kind === "directory") ?? [];

  return (
    <>
      <div className="directory-picker-row">
        <input name="value" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <button className="ghost-button" type="button" disabled={!rootPath} onClick={openPicker}>
          <FolderOpen size={16} />
          <span>{t("project.chooseDirectory")}</span>
        </button>
      </div>
      {open && (
        <div className="workspace-modal compact-modal directory-picker-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("project.chooseDirectory")}</strong>
              <span>{rootPath}</span>
            </div>
            <button className="modal-head-close" type="button" aria-label={t("action.close")} onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <div className="directory-picker-body">
            <div className="directory-picker-current">
              <span>{t("project.currentDirectory")}</span>
              <code>{fileList?.path || currentPath || "."}</code>
            </div>
            <div className="directory-picker-actions">
              {fileList?.parentPath && (
                <button className="ghost-button" type="button" onClick={() => void loadDirectory(fileList.parentPath ?? ".")}>{t("file.parentDirectory")}</button>
              )}
              <button className="dark-button" type="button" disabled={!fileList} onClick={selectCurrentDirectory}>{t("project.selectDirectory")}</button>
            </div>
            {error && <div className="form-error">{error}</div>}
            {!fileList && !error && <div className="subtle">{t("file.loadingFiles")}</div>}
            {fileList && (
              <div className="directory-picker-list">
                {directories.map((entry) => (
                  <button className="directory-picker-item" type="button" key={entry.path} onClick={() => void loadDirectory(entry.path)}>
                    <FolderOpen size={16} />
                    <span>{entry.name}</span>
                  </button>
                ))}
                {!directories.length && <div className="empty-state">{t("project.noDirectories")}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
