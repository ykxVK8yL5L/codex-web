import type {
  NotificationDeliverySummary,
  NotificationEphemeralRuleSummary,
  NotificationAccountSummary,
  NotificationRuleSummary,
  NotificationSettingsResponse,
  NotificationTestSettings,
  PageResponse,
  PlatformSettingsResponse,
  UpdateNotificationTestSettingsRequest,
} from "@codex-web/protocol";

function jsonHeaders(sessionToken: string) {
  return { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };
}

function authHeaders(sessionToken: string) {
  return { authorization: `Bearer ${sessionToken}` };
}

export async function fetchNotificationTestSettings(sessionToken: string) {
  const response = await fetch("/api/settings/notification-test", {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) return null;
  return (await response.json()) as NotificationTestSettings;
}

export async function fetchNotificationSettings(sessionToken: string) {
  const response = await fetch("/api/notifications", { headers: authHeaders(sessionToken) });
  if (!response.ok) return null;
  return (await response.json()) as NotificationSettingsResponse;
}

export async function fetchNotificationPlatformSettings(sessionToken: string) {
  const response = await fetch("/api/notifications/platforms", { headers: authHeaders(sessionToken) });
  if (!response.ok) return null;
  return (await response.json()) as PlatformSettingsResponse;
}

export async function fetchNotificationRulesPage(sessionToken: string, params: URLSearchParams) {
  const response = await fetch(`/api/notifications/rules?${params}`, { headers: authHeaders(sessionToken) });
  if (!response.ok) return null;
  return (await response.json()) as PageResponse<NotificationRuleSummary>;
}

export async function fetchNotificationEphemeralRulesPage(sessionToken: string, params: URLSearchParams) {
  const response = await fetch(`/api/notifications/ephemeral-rules?${params}`, { headers: authHeaders(sessionToken) });
  if (!response.ok) return null;
  return (await response.json()) as PageResponse<NotificationEphemeralRuleSummary>;
}

export async function createNotificationEphemeralRule(sessionToken: string, body: unknown) {
  const response = await fetch("/api/notifications/ephemeral-rules", {
    method: "POST",
    headers: jsonHeaders(sessionToken),
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as { id?: string } | null;
}

export async function fetchNotificationDeliveriesPage(sessionToken: string, params: URLSearchParams) {
  const response = await fetch(`/api/notifications/deliveries?${params}`, { headers: authHeaders(sessionToken) });
  if (!response.ok) return null;
  return (await response.json()) as PageResponse<NotificationDeliverySummary>;
}

export async function upsertNotificationChannel(sessionToken: string, channelId: string, body: unknown) {
  return fetch(channelId ? `/api/notifications/channels/${channelId}` : "/api/notifications/channels", {
    method: channelId ? "PATCH" : "POST",
    headers: jsonHeaders(sessionToken),
    body: JSON.stringify(body),
  });
}

export async function deleteNotificationChannelRequest(sessionToken: string, channelId: string) {
  return fetch(`/api/notifications/channels/${channelId}`, { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function upsertNotificationAccount(sessionToken: string, accountId: string, body: unknown) {
  const response = await fetch(accountId ? `/api/notifications/accounts/${accountId}` : "/api/notifications/accounts", {
    method: accountId ? "PATCH" : "POST",
    headers: jsonHeaders(sessionToken),
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json()) as NotificationAccountSummary;
}

export async function deleteNotificationAccountRequest(sessionToken: string, accountId: string, deleteLinkedRecipients: boolean) {
  const params = new URLSearchParams();
  if (deleteLinkedRecipients) params.set("deleteLinkedRecipients", "true");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetch(`/api/notifications/accounts/${accountId}${suffix}`, { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function testNotificationAccountRequest(sessionToken: string, accountId: string, body: unknown) {
  return fetch(`/api/notifications/accounts/${accountId}/test`, {
    method: "POST",
    headers: jsonHeaders(sessionToken),
    body: JSON.stringify(body),
  });
}

export async function upsertNotificationRecipient(sessionToken: string, recipientId: string, body: unknown) {
  return fetch(recipientId ? `/api/notifications/recipients/${recipientId}` : "/api/notifications/recipients", {
    method: recipientId ? "PATCH" : "POST",
    headers: jsonHeaders(sessionToken),
    body: JSON.stringify(body),
  });
}

export async function deleteNotificationRecipientRequest(sessionToken: string, recipientId: string) {
  return fetch(`/api/notifications/recipients/${recipientId}`, { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function testNotificationRecipientRequest(sessionToken: string, recipientId: string) {
  return fetch(`/api/notifications/recipients/${recipientId}/test`, { method: "POST", headers: authHeaders(sessionToken) });
}

export async function upsertNotificationRule(sessionToken: string, ruleId: string, body: unknown) {
  return fetch(ruleId ? `/api/notifications/rules/${ruleId}` : "/api/notifications/rules", {
    method: ruleId ? "PATCH" : "POST",
    headers: jsonHeaders(sessionToken),
    body: JSON.stringify(body),
  });
}

export async function deleteNotificationRuleRequest(sessionToken: string, ruleId: string) {
  return fetch(`/api/notifications/rules/${ruleId}`, { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function clearNotificationRulesRequest(sessionToken: string) {
  return fetch("/api/notifications/rules", { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function deleteNotificationEphemeralRuleRequest(sessionToken: string, ruleId: string) {
  return fetch(`/api/notifications/ephemeral-rules/${ruleId}`, { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function deleteNotificationDeliveryRequest(sessionToken: string, deliveryId: string) {
  return fetch(`/api/notifications/deliveries/${deliveryId}`, { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function retryNotificationDeliveryRequest(sessionToken: string, deliveryId: string) {
  return fetch(`/api/notifications/deliveries/${deliveryId}/retry`, { method: "POST", headers: authHeaders(sessionToken) });
}

export async function clearNotificationDeliveriesRequest(sessionToken: string) {
  return fetch("/api/notifications/deliveries", { method: "DELETE", headers: authHeaders(sessionToken) });
}

export async function updateNotificationTestSettings(sessionToken: string, body: UpdateNotificationTestSettingsRequest) {
  const response = await fetch("/api/settings/notification-test", {
    method: "PATCH",
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json()) as NotificationTestSettings;
}
