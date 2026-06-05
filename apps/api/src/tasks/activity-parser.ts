import type { TaskEvent } from "./events.js";

function stringifyReadable(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function readAssistantText(line: string) {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    const item = event.item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.type === "agent_message") {
        return stringifyReadable(record.text ?? record.content ?? record.message);
      }
    }
    if (event.type === "agent_message") {
      return stringifyReadable(event.text ?? event.content ?? event.message);
    }
  } catch {
    return "";
  }
  return "";
}

export function readTextField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function shortenActivityDetail(value: string) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

export function readActivityId(item: Record<string, unknown>, event: Record<string, unknown>) {
  return readTextField(item, ["id", "call_id"]) || readTextField(event, ["id", "item_id"]);
}

export function readActivityStatus(item: Record<string, unknown>, event: Record<string, unknown>) {
  const explicitStatus = readTextField(item, ["status"]) || readTextField(event, ["status"]);
  if (explicitStatus) return explicitStatus;
  const eventType = String(event.type ?? "");
  if (eventType.endsWith(".started")) return "in_progress";
  if (eventType.endsWith(".completed")) return "completed";
  return "";
}

export function activityLabel(kind: "command" | "file" | "tool", status: string) {
  const done = status === "completed";
  const failed = status === "failed";
  if (kind === "command") return failed ? "命令运行失败" : done ? "运行命令完成" : "正在运行命令";
  if (kind === "file") return failed ? "文件操作失败" : done ? "文件操作完成" : "正在编辑文件";
  return failed ? "工具调用失败" : done ? "工具调用完成" : "正在调用工具";
}

export function readFileActivityPath(item: Record<string, unknown>) {
  const direct = readTextField(item, ["path", "file", "file_path", "filename", "target_file"]);
  if (direct) return direct;
  const changes = item.changes;
  if (!Array.isArray(changes)) return "";
  const first = changes.find((change) => change && typeof change === "object") as Record<string, unknown> | undefined;
  return first ? readTextField(first, ["path", "file", "file_path", "filename", "target_file"]) : "";
}

export function readActivityEvent(line: string): TaskEvent | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    if (line.includes("patch rejected") || line.includes("writing is blocked")) {
      return {
        type: "activity",
        kind: "file",
        label: "文件写入被沙箱拦截",
        detail: shortenActivityDetail(line),
        status: "failed",
        at: new Date().toISOString(),
      };
    }
    return null;
  }
  const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : event;
  const itemType = String(item.type ?? event.type ?? "");
  const status = readActivityStatus(item, event);
  const id = readActivityId(item, event);
  if (itemType === "command_execution") {
    const command = readTextField(item, ["command"]);
    if (!command) return null;
    return {
      type: "activity",
      id,
      kind: "command",
      label: activityLabel("command", status),
      detail: shortenActivityDetail(command),
      status,
      at: new Date().toISOString(),
    };
  }
  const filePath = readFileActivityPath(item);
  if (filePath || ["file_change", "file_operation", "apply_patch", "patch"].includes(itemType)) {
    return {
      type: "activity",
      id,
      kind: "file",
      label: activityLabel("file", status),
      detail: shortenActivityDetail(filePath || itemType),
      status,
      at: new Date().toISOString(),
    };
  }
  const toolName = readTextField(item, ["tool", "name", "tool_name"]);
  if (toolName || itemType.includes("tool")) {
    return {
      type: "activity",
      id,
      kind: "tool",
      label: activityLabel("tool", status),
      detail: shortenActivityDetail(toolName || itemType),
      status,
      at: new Date().toISOString(),
    };
  }
  return null;
}


