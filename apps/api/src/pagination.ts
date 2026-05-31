import type { PageResponse } from "@codex-web/protocol";

export function parsePageLimit(value: string | undefined, fallback = 20, max = 100) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function encodePageCursor(sortValue: string, id: string) {
  return Buffer.from(JSON.stringify({ sortValue, id })).toString("base64url");
}

export function decodePageCursor(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { sortValue?: unknown; id?: unknown };
    if (typeof parsed.sortValue === "string" && typeof parsed.id === "string") return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    return null;
  }
  return null;
}

export function pageFromRows<T extends { id: string }>(items: T[], limit: number, sortValue: (item: T) => string): PageResponse<T> {
  const pageItems = items.slice(0, limit);
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    hasMore: items.length > limit,
    nextCursor: items.length > limit && last ? encodePageCursor(sortValue(last), last.id) : null,
  };
}

function encodeOffsetCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

export function decodeOffsetCursor(value?: string | null) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset?: unknown };
    return typeof parsed.offset === "number" && Number.isFinite(parsed.offset) && parsed.offset > 0 ? Math.floor(parsed.offset) : 0;
  } catch {
    return 0;
  }
}

export function offsetPageFromRows<T>(items: T[], limit: number, offset: number): PageResponse<T> {
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit,
    nextCursor: items.length > limit ? encodeOffsetCursor(offset + limit) : null,
  };
}
