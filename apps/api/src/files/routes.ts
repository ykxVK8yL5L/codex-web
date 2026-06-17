import type { Hono } from "hono";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
  CreateFileMountRequest,
  CreateFileRequest,
  FileArchiveRequest,
  FileContentResponse,
  FileEntry,
  FileListResponse,
  FileMount,
  RenameFileRequest,
  SaveFileRequest,
  UpdateFileMountRequest,
} from "@codex-web/protocol";

type FileRoutesDeps = {
  archiveIgnoreTemplateDir: string;
  createZipArchive: (root: string, safeName: string, excludes: string[]) => Buffer;
  deleteFileMount: (id: string) => void;
  fileMounts: Map<string, FileMount>;
  listArchiveIgnoreTemplates: (templateDir: string) => unknown;
  normalizeMountPath: (path: string) => string;
  previewZipArchive: (root: string, excludes: string[]) => unknown;
  resolveFileRequestMount: (mountId?: string, rootPath?: string) => FileMount;
  resolveInsideMount: (mount: FileMount, path?: string) => string;
  slugify: (value: string) => string;
  toFileEntry: (path: string, root: string) => FileEntry;
  toRelativePath: (path: string, root: string) => string;
  upsertFileMount: (mount: FileMount) => void;
};

export function registerFileRoutes(app: Hono, deps: FileRoutesDeps) {
  app.get("/api/file-mounts", (c) => {
    return c.json(Array.from(deps.fileMounts.values()));
  });

  app.post("/api/file-mounts", async (c) => {
    const body = await c.req.json<CreateFileMountRequest>().catch(() => null);
    const name = body?.name?.trim() ?? "";
    const requestedRootPath = body?.rootPath?.trim() ?? "";
    if (!name || !requestedRootPath) return c.json({ error: "invalid_mount" }, 400);
    const rootPath = deps.normalizeMountPath(requestedRootPath);
    if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) return c.json({ error: "mount_root_invalid" }, 400);
    const baseId = deps.slugify(name);
    let id = baseId;
    let suffix = 2;
    while (deps.fileMounts.has(id)) id = `${baseId}-${suffix++}`;
    const mount: FileMount = {
      id,
      name,
      rootPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    deps.upsertFileMount(mount);
    return c.json(mount, 201);
  });

  app.patch("/api/file-mounts/:id", async (c) => {
    const mount = deps.fileMounts.get(c.req.param("id"));
    if (!mount) return c.json({ error: "mount_not_found" }, 404);
    const body = await c.req.json<UpdateFileMountRequest>().catch(() => null);
    if (!body) return c.json({ error: "invalid_mount_update" }, 400);
    const requestedName = body.name?.trim();
    const requestedRootPath = body.rootPath?.trim();
    if (body.name !== undefined && !requestedName) return c.json({ error: "invalid_mount_update" }, 400);
    if (body.rootPath !== undefined && !requestedRootPath) return c.json({ error: "invalid_mount_update" }, 400);
    const nextMount: FileMount = {
      ...mount,
      name: requestedName ?? mount.name,
      rootPath: requestedRootPath ? deps.normalizeMountPath(requestedRootPath) : mount.rootPath,
      updatedAt: new Date().toISOString(),
    };
    if (requestedRootPath && (!existsSync(nextMount.rootPath) || !statSync(nextMount.rootPath).isDirectory())) return c.json({ error: "mount_root_invalid" }, 400);
    deps.upsertFileMount(nextMount);
    return c.json(nextMount);
  });

  app.delete("/api/file-mounts/:id", (c) => {
    try {
      deps.deleteFileMount(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "mount_delete_failed" }, 400);
    }
  });

  app.get("/api/files", (c) => {
    try {
      const mount = deps.resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
      const absolutePath = deps.resolveInsideMount(mount, c.req.query("path"));
      const stat = statSync(absolutePath);
      if (!stat.isDirectory()) return c.json({ error: "not_a_directory" }, 400);
      const entries = readdirSync(absolutePath)
        .filter((name) => name !== ".DS_Store")
        .map((name) => deps.toFileEntry(join(absolutePath, name), mount.rootPath))
        .sort((a, b) => a.kind !== b.kind ? a.kind === "directory" ? -1 : 1 : a.name.localeCompare(b.name));
      const response: FileListResponse = {
        mountId: mount.id,
        root: mount.rootPath,
        path: deps.toRelativePath(absolutePath, mount.rootPath),
        parentPath: absolutePath === mount.rootPath ? null : deps.toRelativePath(resolve(absolutePath, ".."), mount.rootPath),
        entries,
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "file_list_failed" }, 400);
    }
  });

  app.get("/api/files/content", (c) => {
    try {
      const mount = deps.resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
      const absolutePath = deps.resolveInsideMount(mount, c.req.query("path"));
      const stat = statSync(absolutePath);
      if (!stat.isFile()) return c.json({ error: "not_a_file" }, 400);
      if (stat.size > 1024 * 1024) return c.json({ error: "file_too_large" }, 413);
      const response: FileContentResponse = {
        path: deps.toRelativePath(absolutePath, mount.rootPath),
        content: readFileSync(absolutePath, "utf8"),
        updatedAt: stat.mtime.toISOString(),
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "file_read_failed" }, 400);
    }
  });

  app.get("/api/files/archive/templates", (c) => c.json(deps.listArchiveIgnoreTemplates(deps.archiveIgnoreTemplateDir)));

  app.post("/api/files/archive/preview", async (c) => {
    try {
      const body = await c.req.json<FileArchiveRequest>().catch(() => null);
      if (!body?.path) return c.json({ error: "invalid_archive_request" }, 400);
      const mount = deps.resolveFileRequestMount(body.mountId ?? undefined, body.rootPath ?? undefined);
      const absolutePath = deps.resolveInsideMount(mount, body.path);
      const stat = statSync(absolutePath);
      if (!stat.isDirectory()) return c.json({ error: "not_a_directory" }, 400);
      return c.json(deps.previewZipArchive(absolutePath, Array.isArray(body.excludes) ? body.excludes : []));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "archive_preview_failed" }, 400);
    }
  });

  app.post("/api/files/archive", async (c) => {
    try {
      const body = await c.req.json<FileArchiveRequest>().catch(() => null);
      if (!body?.path) return c.json({ error: "invalid_archive_request" }, 400);
      const mount = deps.resolveFileRequestMount(body.mountId ?? undefined, body.rootPath ?? undefined);
      const absolutePath = deps.resolveInsideMount(mount, body.path);
      const stat = statSync(absolutePath);
      if (!stat.isDirectory()) return c.json({ error: "not_a_directory" }, 400);
      const safeName = basename(absolutePath).replaceAll(/[^\w.-]+/g, "-") || "archive";
      const archive = deps.createZipArchive(absolutePath, safeName, Array.isArray(body.excludes) ? body.excludes : []);
      c.header("content-type", "application/zip");
      c.header("content-disposition", `attachment; filename="${safeName}.zip"`);
      return c.body(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "archive_failed" }, 400);
    }
  });

  app.put("/api/files/content", async (c) => {
    try {
      const mount = deps.resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
      const absolutePath = deps.resolveInsideMount(mount, c.req.query("path"));
      const stat = statSync(absolutePath);
      if (!stat.isFile()) return c.json({ error: "not_a_file" }, 400);
      const body = await c.req.json<SaveFileRequest>().catch(() => null);
      if (typeof body?.content !== "string") return c.json({ error: "invalid_content" }, 400);
      writeFileSync(absolutePath, body.content, "utf8");
      const response: FileContentResponse = {
        path: deps.toRelativePath(absolutePath, mount.rootPath),
        content: body.content,
        updatedAt: statSync(absolutePath).mtime.toISOString(),
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "file_write_failed" }, 400);
    }
  });

  app.post("/api/files", async (c) => {
    try {
      const body = await c.req.json<CreateFileRequest>().catch(() => null);
      if (!body?.parentPath || !body.name || !body.kind) return c.json({ error: "invalid_create_request" }, 400);
      const mount = deps.resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
      const cleanName = body.name.trim();
      if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("invalid_name");
      const targetPath = deps.resolveInsideMount(mount, join(body.parentPath, cleanName));
      if (existsSync(targetPath)) return c.json({ error: "already_exists" }, 409);
      if (body.kind === "directory") mkdirSync(targetPath);
      else writeFileSync(targetPath, "", { flag: "wx" });
      return c.json(deps.toFileEntry(targetPath, mount.rootPath), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "file_create_failed" }, 400);
    }
  });

  app.post("/api/files/upload", async (c) => {
    try {
      const mount = deps.resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
      const parentPath = deps.resolveInsideMount(mount, c.req.query("path"));
      if (!statSync(parentPath).isDirectory()) return c.json({ error: "not_a_directory" }, 400);
      const form = await c.req.formData();
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      if (!files.length) return c.json({ error: "no_files" }, 400);
      const pending: Array<{ targetPath: string; bytes: Buffer }> = [];
      const names = new Set<string>();
      for (const file of files) {
        const cleanName = file.name.trim();
        if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("invalid_name");
        if (names.has(cleanName)) return c.json({ error: "already_exists" }, 409);
        names.add(cleanName);
        const targetPath = deps.resolveInsideMount(mount, join(deps.toRelativePath(parentPath, mount.rootPath), cleanName));
        if (existsSync(targetPath)) return c.json({ error: "already_exists" }, 409);
        const bytes = Buffer.from(await file.arrayBuffer());
        pending.push({ targetPath, bytes });
      }
      const entries: FileEntry[] = [];
      for (const { targetPath, bytes } of pending) {
        writeFileSync(targetPath, bytes, { flag: "wx" });
        entries.push(deps.toFileEntry(targetPath, mount.rootPath));
      }
      return c.json(entries, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "file_upload_failed" }, 400);
    }
  });

  app.patch("/api/files", async (c) => {
    try {
      const body = await c.req.json<RenameFileRequest>().catch(() => null);
      if (!body?.path || !body.newName) return c.json({ error: "invalid_rename_request" }, 400);
      const mount = deps.resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
      const sourcePath = deps.resolveInsideMount(mount, body.path);
      const cleanName = body.newName.trim();
      if (!cleanName || cleanName.includes("/") || cleanName.includes("\\")) throw new Error("invalid_name");
      const targetPath = deps.resolveInsideMount(mount, join(deps.toRelativePath(dirname(sourcePath), mount.rootPath), cleanName));
      if (sourcePath === mount.rootPath) return c.json({ error: "cannot_rename_root" }, 400);
      if (existsSync(targetPath)) return c.json({ error: "already_exists" }, 409);
      renameSync(sourcePath, targetPath);
      return c.json(deps.toFileEntry(targetPath, mount.rootPath));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "file_rename_failed" }, 400);
    }
  });

  app.delete("/api/files", (c) => {
    try {
      const mount = deps.resolveFileRequestMount(c.req.query("mountId"), c.req.query("rootPath"));
      const targetPath = deps.resolveInsideMount(mount, c.req.query("path"));
      if (targetPath === mount.rootPath) return c.json({ error: "cannot_delete_root" }, 400);
      rmSync(targetPath, { recursive: true });
      return c.json({ ok: true, path: basename(targetPath) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "file_delete_failed" }, 400);
    }
  });
}
