import type { Locale } from "./i18n";

export type Page = "sessions" | "files" | "terminal" | "projects" | "previews" | "contacts" | "extensions" | "automations" | "providers" | "approvals" | "settings" | "auth";

export const routePages: Page[] = ["sessions", "files", "terminal", "projects", "previews", "contacts", "extensions", "automations", "providers", "approvals", "settings"];

export function routeFromHash() {
  const [pathPart] = window.location.hash.replace(/^#\/?/, "").split("?");
  const [hashPage = "sessions", sessionId] = pathPart.split("/");
  const page = routePages.includes(hashPage as Page) ? hashPage as Page : "sessions";
  return {
    page,
    sessionId: page === "sessions" && sessionId ? decodeURIComponent(sessionId) : "",
  };
}

export function pageFromHash(): Page {
  const hashPage = routeFromHash().page;
  return routePages.includes(hashPage) ? hashPage : "sessions";
}

export function detectInitialLocale(): Locale {
  const storedLocale = localStorage.getItem("codex-web-locale");
  if (storedLocale === "zh-CN" || storedLocale === "en-US") return storedLocale;
  const languages = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
  const browserLocale = languages.find((item) => item.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : languages.length
      ? "en-US"
      : "en-US";
  return browserLocale;
}
