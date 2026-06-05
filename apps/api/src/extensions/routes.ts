import type { Hono } from "hono";
import type {
  CreateMcpServerRequest,
  CreatePluginRequest,
  CreateSkillRequest,
  DeleteMarketplaceItemsRequest,
  DeleteSkillRequest,
  ExtensionSummary,
  ImportMarketplaceCatalogRequest,
  ImportMcpServerRequest,
  ImportSkillRequest,
  InstallMarketplaceItemRequest,
  UpdateSkillRequest,
} from "@codex-web/protocol";
import { parsePageLimit } from "../pagination.js";

type ExtensionRoutesDeps = Record<string, any>;

function paged(c: any, deps: ExtensionRoutesDeps, items: ExtensionSummary[]) {
  if (!c.req.query("limit") && !c.req.query("cursor") && !c.req.query("q")) return c.json(items);
  return c.json(deps.pageExtensions(items, parsePageLimit(c.req.query("limit"), 20), c.req.query("cursor"), c.req.query("q") ?? ""));
}

export function registerExtensionRoutes(app: Hono, deps: ExtensionRoutesDeps) {
  app.get("/api/extensions/skills", (c) => paged(c, deps, deps.listSkills()));

  app.post("/api/extensions/skills", async (c) => {
    const body = await c.req.json<CreateSkillRequest>().catch(() => null);
    if (!body?.name || !body.description || !body.instructions) return c.json({ error: "invalid_skill" }, 400);
    try {
      return c.json(deps.createLocalSkill(body), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "skill_create_failed";
      return c.json({ error: message }, message === "skill_exists" ? 409 : 400);
    }
  });

  app.post("/api/extensions/skills/import", async (c) => {
    const body = await c.req.json<ImportSkillRequest>().catch(() => null);
    if (!body?.url && !body?.content) return c.json({ error: "skill_import_empty" }, 400);
    try {
      return c.json(await deps.importSkill(body), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "skill_import_failed";
      return c.json({ error: message }, message === "skill_exists" ? 409 : 400);
    }
  });

  app.put("/api/extensions/skills", async (c) => {
    const body = await c.req.json<UpdateSkillRequest>().catch(() => null);
    if (!body?.path || !body.name || !body.description || !body.instructions) return c.json({ error: "invalid_skill" }, 400);
    try {
      return c.json(deps.updateLocalSkill(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "skill_update_failed";
      return c.json({ error: message }, message === "skill_not_found" ? 404 : 400);
    }
  });

  app.delete("/api/extensions/skills", async (c) => {
    const body = await c.req.json<DeleteSkillRequest>().catch(() => null);
    if (!body?.path) return c.json({ error: "invalid_skill" }, 400);
    try {
      return c.json(deps.deleteLocalSkill(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "skill_delete_failed";
      return c.json({ error: message }, message === "skill_not_found" ? 404 : 400);
    }
  });

  app.get("/api/extensions/plugins", (c) => paged(c, deps, deps.listPlugins()));

  app.post("/api/extensions/plugins", async (c) => {
    const body = await c.req.json<CreatePluginRequest>().catch(() => null);
    if (!body?.name) return c.json({ error: "invalid_plugin" }, 400);
    try {
      return c.json(deps.createLocalPlugin(body), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "plugin_create_failed";
      return c.json({ error: message }, message === "plugin_exists" ? 409 : 400);
    }
  });

  app.get("/api/extensions/mcp", (c) => paged(c, deps, deps.listMcpServers()));

  app.post("/api/extensions/mcp", async (c) => {
    const body = await c.req.json<CreateMcpServerRequest>().catch(() => null);
    if (!body?.name || !body.command) return c.json({ error: "invalid_mcp_server" }, 400);
    try {
      return c.json(deps.createMcpServer(body), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "mcp_create_failed" }, 400);
    }
  });

  app.post("/api/extensions/mcp/import", async (c) => {
    const body = await c.req.json<ImportMcpServerRequest>().catch(() => null);
    if (!body?.url && !body?.content) return c.json({ error: "mcp_import_empty" }, 400);
    try {
      return c.json(await deps.importMcpServers(body), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "mcp_import_failed" }, 400);
    }
  });

  app.get("/api/extensions/marketplace", (c) => {
    return c.json(deps.loadMarketplaceCatalog());
  });

  app.post("/api/extensions/marketplace/import", async (c) => {
    const body = await c.req.json<ImportMarketplaceCatalogRequest>().catch(() => null);
    if (!body?.url && !body?.content) return c.json({ error: "marketplace_catalog_empty" }, 400);
    try {
      return c.json(deps.saveMarketplaceCatalog(await deps.importMarketplaceCatalog(body)));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "marketplace_catalog_import_failed" }, 400);
    }
  });

  app.post("/api/extensions/marketplace/install", async (c) => {
    const body = await c.req.json<InstallMarketplaceItemRequest>().catch(() => null);
    if (!body?.item) return c.json({ error: "invalid_marketplace_item" }, 400);
    try {
      return c.json(await deps.installMarketplaceItem(body), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "marketplace_install_failed";
      return c.json({ error: message }, message.endsWith("_exists") ? 409 : 400);
    }
  });

  app.delete("/api/extensions/marketplace", async (c) => {
    const body = await c.req.json<DeleteMarketplaceItemsRequest>().catch(() => null);
    if (!body?.ids || !Array.isArray(body.ids)) return c.json({ error: "invalid_marketplace_item_ids" }, 400);
    return c.json(deps.deleteMarketplaceCatalogItems(body.ids));
  });

  app.delete("/api/extensions/marketplace/all", (c) => {
    return c.json(deps.clearMarketplaceCatalogItems());
  });

  app.get("/api/extensions/detail", (c) => {
    try {
      const type = c.req.query("type") as ExtensionSummary["type"] | undefined;
      const name = c.req.query("name") ?? "";
      if (type !== "plugin" && type !== "skill" && type !== "mcp") return c.json({ error: "invalid_extension_type" }, 400);
      return c.json(deps.readExtensionDetail(type, name, c.req.query("path") ?? undefined));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "extension_detail_failed" }, 400);
    }
  });
}
