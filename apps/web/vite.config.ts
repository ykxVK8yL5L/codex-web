import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function previewRefererRedirect() {
  return {
    name: "preview-referer-redirect",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || request.method !== "GET") return next();
        const sourceUrl = new URL(request.url, "http://127.0.0.1:5173");
        if (sourceUrl.pathname.startsWith("/api/") || sourceUrl.pathname.startsWith("/preview/")) return next();
        const referer = request.headers.referer;
        if (!referer) return next();
        const refererUrl = new URL(referer, "http://127.0.0.1:5173");
        const parts = refererUrl.pathname.split("/").filter(Boolean);
        if (parts[0] !== "preview" || !parts[1] || !parts[2]) return next();
        response.statusCode = 307;
        response.setHeader("location", `/preview/${parts[1]}/${parts[2]}/${sourceUrl.pathname.replace(/^\/+/, "")}${sourceUrl.search}`);
        response.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [previewRefererRedirect(), react()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        ws: true,
      },
      "/preview": {
        target: "http://127.0.0.1:8787",
        ws: true,
      },
    },
  },
});
