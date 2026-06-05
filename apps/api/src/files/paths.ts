import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { FileMount, ProjectSummary } from "@codex-web/protocol";

type WorkspacePathServiceDeps = {
  getProjects: () => ProjectSummary[];
  projectWorkspaceRoot: string;
  resolveInsideMount: (mount: FileMount, inputPath?: string) => string;
  resolveInsideRoot: (root: string, inputPath?: string) => string;
  resolveMountWorkspace: (mountId?: string | null) => FileMount;
  terminalDefaultCwd: string;
  terminalRoot: string;
  toRelativePath: (absolutePath: string, root: string) => string;
};

export function createWorkspacePathService(deps: WorkspacePathServiceDeps) {
  const { getProjects, projectWorkspaceRoot, resolveInsideMount, resolveInsideRoot, resolveMountWorkspace, terminalDefaultCwd, terminalRoot, toRelativePath } = deps;

  function slugify(value: string) {
    return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || randomUUID();
  }

  function uniqueProjectId(name: string) {
    const base = slugify(name);
    let candidate = base;
    let index = 2;
    while (getProjects().some((project) => project.id === candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    return candidate;
  }

  function defaultProjectWorkspacePath(projectId: string) {
    return resolve(projectWorkspaceRoot, projectId);
  }

  function resolveWorkspacePath(inputPath?: string, mountId?: string | null) {
    return resolveInsideMount(resolveMountWorkspace(mountId), inputPath);
  }

  function resolveTerminalCwd(inputPath?: string) {
    const requestedPath = inputPath?.trim() || terminalDefaultCwd;
    try {
      return resolveInsideRoot(terminalRoot, requestedPath);
    } catch {
      if (inputPath?.trim() && inputPath.trim() !== terminalDefaultCwd) throw new Error("terminal_cwd_outside_workspace");
      return terminalRoot;
    }
  }

  function toTerminalPath(absolutePath: string) {
    return toRelativePath(absolutePath, terminalRoot);
  }

  function resolveChildPath(parentPath: string, name: string, mountId?: string | null) {
    const cleanName = name.trim();
    if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("invalid_name");
    return resolveWorkspacePath(join(parentPath, cleanName), mountId);
  }

  return {
    defaultProjectWorkspacePath,
    resolveChildPath,
    resolveTerminalCwd,
    resolveWorkspacePath,
    slugify,
    toTerminalPath,
    uniqueProjectId,
  };
}
