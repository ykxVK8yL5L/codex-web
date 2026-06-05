import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type {
  EnvironmentBulkActionRequest,
  EnvironmentOverview,
  EnvironmentRestoreMissingRequest,
  InstallEnvironmentPackageRequest,
  InstallEnvironmentToolRequest,
  RegisterEnvironmentToolRequest,
  UninstallEnvironmentPackageRequest,
} from "@codex-web/protocol";
import {
  buildEnvironmentOverview,
  buildEnvironmentRestoreExecutionPlan,
  clearRestoreRuns,
  deleteEnvironmentTool,
  deleteRestoreRun,
  detectMiseStatus,
  getEnvironmentToolPackages,
  inspectEnvironmentPackage,
  installEnvironmentPackage,
  installEnvironmentTool,
  installMissingPackages,
  installMise,
  listEnvironmentToolRegistry,
  listEnvironmentToolVersions,
  probeEnvironmentTool,
  recordDetectedPackages,
  registerEnvironmentTool,
  runEnvironmentRestoreMissing,
  saveEnvironmentOverview,
  setDefaultEnvironmentTool,
  uninstallEnvironmentPackage,
  uninstallEnvironmentTool,
} from "./index.js";

type EnvironmentRoutesDeps = {
  getOverview: () => EnvironmentOverview;
  setOverview: (overview: EnvironmentOverview) => void;
};

export function registerEnvironmentRoutes(app: Hono, deps: EnvironmentRoutesDeps) {
  const rebuildOverview = () => {
    const overview = buildEnvironmentOverview();
    saveEnvironmentOverview(overview);
    deps.setOverview(overview);
    return overview;
  };
  const setOverview = (overview: EnvironmentOverview) => {
    deps.setOverview(overview);
    return overview;
  };

  app.get("/api/settings/environment", (c) => c.json(rebuildOverview()));

  app.post("/api/settings/environment/scan", (c) => c.json(rebuildOverview()));

  app.post("/api/settings/environment/restore-preview", async (c) => {
    const body = await c.req.json<EnvironmentRestoreMissingRequest>().catch(() => ({}));
    return c.json(buildEnvironmentRestoreExecutionPlan(body));
  });

  app.post("/api/settings/environment/restore-missing", async (c) => {
    const body = await c.req.json<EnvironmentRestoreMissingRequest>().catch(() => ({}));
    return c.json(setOverview(runEnvironmentRestoreMissing(deps.getOverview(), body)));
  });

  app.post("/api/settings/environment/mise/install", (c) => {
    try {
      return c.json(setOverview(installMise(deps.getOverview())));
    } catch (error) {
      const overview = rebuildOverview();
      return c.json({ error: "mise_install_failed", detail: error instanceof Error ? error.message : String(error), overview }, 400);
    }
  });

  app.get("/api/settings/environment/tool-registry", (c) => {
    try {
      const items = listEnvironmentToolRegistry(c.req.query("q")).map((item) => ({
        name: String(item.name),
        description: item.description ?? null,
        backend: item.backend ?? null,
      }));
      return c.json({ items, mise: detectMiseStatus() });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "environment_registry_failed", items: [], mise: detectMiseStatus() }, 500);
    }
  });

  app.get("/api/settings/environment/tool-versions", (c) => {
    try {
      const tool = c.req.query("tool") ?? "";
      const result = listEnvironmentToolVersions(tool);
      return c.json({ ...result, mise: detectMiseStatus() }, result.error ? 200 : 200);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "environment_versions_failed", items: [], mise: detectMiseStatus() }, 500);
    }
  });

  app.get("/api/settings/environment/tool-probe", (c) => {
    try {
      const tool = c.req.query("tool") ?? "";
      if (!tool.trim()) return c.json({ error: "tool_required" }, 400);
      return c.json({ probe: probeEnvironmentTool(tool), mise: detectMiseStatus() });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "environment_probe_failed" }, 500);
    }
  });

  app.post("/api/settings/environment/tools/install", async (c) => {
    const body = await c.req.json<InstallEnvironmentToolRequest>().catch(() => null);
    if (!body?.tool?.trim() || !body.version?.trim()) return c.json({ error: "invalid_environment_tool" }, 400);
    try {
      return c.json(setOverview(installEnvironmentTool(deps.getOverview(), body)), 201);
    } catch (error) {
      const overview = rebuildOverview();
      return c.json({ error: "environment_tool_install_failed", detail: error instanceof Error ? error.message : String(error), overview }, 400);
    }
  });

  app.post("/api/settings/environment/tools/register", async (c) => {
    const body = await c.req.json<RegisterEnvironmentToolRequest>().catch(() => null);
    if (!body?.tool?.trim() || !body.version?.trim()) return c.json({ error: "invalid_environment_tool" }, 400);
    return c.json(setOverview(registerEnvironmentTool(deps.getOverview(), body)), 201);
  });

  app.delete("/api/settings/environment/tools/:id", (c) => c.json(setOverview(deleteEnvironmentTool(deps.getOverview(), c.req.param("id")))));

  app.delete("/api/settings/environment/tools/:id/uninstall", (c) => {
    try {
      return c.json(setOverview(uninstallEnvironmentTool(deps.getOverview(), c.req.param("id"))));
    } catch (error) {
      const overview = rebuildOverview();
      return c.json({ error: error instanceof Error ? error.message : String(error), overview }, 400);
    }
  });

  app.post("/api/settings/environment/tools/:id/set-default", (c) => {
    try {
      return c.json(setOverview(setDefaultEnvironmentTool(deps.getOverview(), c.req.param("id"))));
    } catch (error) {
      const overview = rebuildOverview();
      return c.json({ error: error instanceof Error ? error.message : String(error), overview }, 400);
    }
  });

  app.get("/api/settings/environment/tools/:id/packages", (c) => {
    try {
      return c.json(getEnvironmentToolPackages(deps.getOverview(), c.req.param("id")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });

  app.get("/api/settings/environment/tools/:id/packages/probe", (c) => {
    const id = c.req.param("id");
    const toolRecord = deps.getOverview().tools.find((item) => item.id === id) ?? null;
    if (!toolRecord) return c.json({ error: "environment_tool_not_found" }, 404);
    const manager = c.req.query("manager")?.trim() ?? "";
    const packageName = c.req.query("package")?.trim() ?? "";
    if (!manager || !packageName) return c.json({ error: "invalid_environment_package_probe" }, 400);
    const probe = inspectEnvironmentPackage(manager, packageName);
    return c.json({ ...probe, manager, packageName });
  });

  app.post("/api/settings/environment/bulk", async (c) => {
    const body = await c.req.json<EnvironmentBulkActionRequest>().catch(() => null);
    if (!body?.action) return c.json({ error: "invalid_environment_bulk_action" }, 400);
    const now = new Date().toISOString();
    if (body.action === "cleanup_stale_records") {
      const before = deps.getOverview().packageRecords.length;
      const next = buildEnvironmentOverview();
      next.packageRecords = next.packageRecords.filter((pkg) => pkg.status !== "missing");
      next.restoreRuns = [
        {
          id: `env-restore-${randomUUID()}`,
          status: "success" as const,
          summary: `Cleaned up ${before - next.packageRecords.length} stale package records`,
          createdAt: now,
        },
        ...next.restoreRuns,
      ].slice(0, 20);
      next.updatedAt = now;
      saveEnvironmentOverview(next);
      return c.json(setOverview(next));
    }
    const toolRecord = body.toolRecordId ? deps.getOverview().tools.find((item) => item.id === body.toolRecordId) ?? null : null;
    if (!toolRecord) return c.json({ error: "environment_tool_not_found" }, 404);
    if (body.action === "record_detected_packages" && toolRecord) {
      return c.json(setOverview(recordDetectedPackages(deps.getOverview(), toolRecord.id)));
    }
    if (body.action === "install_missing_packages" && toolRecord) {
      return c.json(setOverview(installMissingPackages(deps.getOverview(), toolRecord.id, body.packageIds ?? [])));
    }
    return c.json({ error: "environment_bulk_action_not_supported" }, 400);
  });

  app.post("/api/settings/environment/packages/install", async (c) => {
    const body = await c.req.json<InstallEnvironmentPackageRequest>().catch(() => null);
    if (!body?.toolRecordId || !body.packageName?.trim() || !body.manager?.trim()) return c.json({ error: "invalid_environment_package" }, 400);
    const toolRecord = deps.getOverview().tools.find((item) => item.id === body.toolRecordId) ?? null;
    if (!toolRecord) return c.json({ error: "environment_tool_not_found" }, 404);
    try {
      return c.json(setOverview(installEnvironmentPackage(deps.getOverview(), body)), 201);
    } catch (error) {
      const overview = rebuildOverview();
      return c.json({ error: "environment_package_install_failed", detail: error instanceof Error ? error.message : String(error), overview }, 400);
    }
  });

  app.delete("/api/settings/environment/packages/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<UninstallEnvironmentPackageRequest>().catch(() => null);
    try {
      return c.json(setOverview(uninstallEnvironmentPackage(deps.getOverview(), id, body?.manager)));
    } catch (error) {
      const overview = rebuildOverview();
      return c.json({ error: error instanceof Error ? error.message : String(error), overview }, 400);
    }
  });

  app.delete("/api/settings/environment/restore-runs/:id", (c) => c.json(setOverview(deleteRestoreRun(deps.getOverview(), c.req.param("id")))));

  app.delete("/api/settings/environment/restore-runs", (c) => c.json(setOverview(clearRestoreRuns(deps.getOverview()))));
}
