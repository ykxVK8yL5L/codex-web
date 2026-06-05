import type { Hono } from "hono";
import type { StorageScanResponse } from "@codex-web/protocol";

type StorageRoutesDeps = {
  deleteStorageItem: (type: string, path: string, force?: boolean) => void;
  listStorageItems: () => StorageScanResponse;
};

export function registerStorageRoutes(app: Hono, deps: StorageRoutesDeps) {
  app.get("/api/settings/storage", (c) => c.json(deps.listStorageItems()));

  app.post("/api/settings/storage/delete", async (c) => {
    const body = await c.req.json<{ type?: string; path?: string; force?: boolean }>().catch(() => null);
    if (!body?.type || !body.path) return c.json({ error: "invalid_storage_item" }, 400);
    try {
      deps.deleteStorageItem(body.type, body.path, body.force === true);
      return c.json(deps.listStorageItems());
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "storage_delete_failed" }, 400);
    }
  });

  app.post("/api/settings/storage/delete-batch", async (c) => {
    const body = await c.req.json<{ items?: Array<{ type?: string; path?: string }>; force?: boolean }>().catch(() => null);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return c.json({ error: "invalid_storage_items" }, 400);
    const currentItems = deps.listStorageItems().items;
    if (body?.force !== true && items.some((item) => currentItems.some((entry) => entry.type === item.type && entry.path === item.path && entry.status === "active"))) {
      return c.json({ error: "storage_item_active", deleted: 0 }, 400);
    }
    let deleted = 0;
    try {
      for (const item of items) {
        if (!item.type || !item.path) continue;
        deps.deleteStorageItem(item.type, item.path, body?.force === true);
        deleted += 1;
      }
      return c.json({ ...deps.listStorageItems(), deleted });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "storage_delete_failed", deleted }, 400);
    }
  });
}
