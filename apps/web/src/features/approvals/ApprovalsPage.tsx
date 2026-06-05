import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShortDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import type { ApprovalDecisionResponse, ApprovalGrantSummary, ApprovalSummary, PageResponse } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";

export function ApprovalsPage({
  sessionToken,
  t,
  notify,
  onPendingChange,
  onOpenMainNav,
}: {
  sessionToken: string;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onPendingChange: (count: number) => void;
  onOpenMainNav?: () => void;
}) {
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [approvalCursor, setApprovalCursor] = useState<string | null>(null);
  const [approvalHasMore, setApprovalHasMore] = useState(false);
  const [grants, setGrants] = useState<ApprovalGrantSummary[]>([]);
  const [grantCursor, setGrantCursor] = useState<string | null>(null);
  const [grantHasMore, setGrantHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"pending" | "all" | "archived" | "grants">("pending");
  const [busy, setBusy] = useState("");

  async function loadApprovals(filter = statusFilter, older = false) {
    const params = new URLSearchParams({ limit: "20" });
    if (filter === "pending") params.set("status", "pending");
    if (filter === "archived") params.set("archived", "true");
    if (older && approvalCursor) params.set("cursor", approvalCursor);
    const response = await fetch(`/api/approvals?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("approval.loadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<ApprovalSummary>;
    setApprovals((current) => older ? [...current, ...page.items] : page.items);
    setApprovalCursor(page.nextCursor);
    setApprovalHasMore(page.hasMore);
    if (filter === "pending") onPendingChange(page.items.length + (page.hasMore ? 1 : 0));
  }

  async function loadGrants(older = false) {
    const params = new URLSearchParams({ limit: "20" });
    if (older && grantCursor) params.set("cursor", grantCursor);
    const response = await fetch(`/api/approval-grants?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) {
      notify(t("approval.loadFailed"), "error");
      return;
    }
    const page = (await response.json()) as PageResponse<ApprovalGrantSummary>;
    setGrants((current) => older ? [...current, ...page.items] : page.items);
    setGrantCursor(page.nextCursor);
    setGrantHasMore(page.hasMore);
  }

  useEffect(() => {
    if (statusFilter === "grants") void loadGrants();
    else void loadApprovals(statusFilter);
  }, [sessionToken, statusFilter]);

  async function decide(approvalId: string, decision: "approve" | "deny", always = false, expiresIn?: number) {
    setBusy(approvalId);
    try {
      const params = new URLSearchParams();
      if (always && decision === "approve") params.set("always", "true");
      if (expiresIn && decision === "approve") params.set("expiresIn", String(expiresIn));
      const response = await fetch(`/api/approvals/${approvalId}/${decision}${params.size ? `?${params}` : ""}`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      const result = await response.json().catch(() => null) as ApprovalDecisionResponse | { error?: string } | null;
      if (!response.ok || !result || !("approval" in result)) {
        notify(t("approval.decisionFailed"), "error");
        return;
      }
      notify(decision === "approve" ? (always ? t("approval.approvedAlways") : expiresIn ? t("approval.approvedTemporarily") : t("approval.approved")) : t("approval.denied"), decision === "approve" ? "success" : "info");
      await loadApprovals();
    } catch {
      notify(t("approval.decisionFailed"), "error");
    } finally {
      setBusy("");
    }
  }

  async function archiveApprovalRecord(approvalId: string) {
    setBusy(approvalId);
    try {
      const response = await fetch(`/api/approvals/${approvalId}/archive`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        notify(t("approval.archiveFailed"), "error");
        return;
      }
      notify(t("approval.archived"), "success");
      await loadApprovals(statusFilter);
    } finally {
      setBusy("");
    }
  }

  async function restoreApprovalRecord(approvalId: string) {
    setBusy(approvalId);
    try {
      const response = await fetch(`/api/approvals/${approvalId}/restore`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        notify(t("approval.restoreFailed"), "error");
        return;
      }
      notify(t("approval.restored"), "success");
      await loadApprovals(statusFilter);
    } finally {
      setBusy("");
    }
  }

  async function revokeGrant(grantId: string) {
    setBusy(grantId);
    try {
      const response = await fetch(`/api/approval-grants/${grantId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        notify(t("approval.grantRevokeFailed"), "error");
        return;
      }
      notify(t("approval.grantRevoked"), "success");
      await loadGrants();
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="management-page">
      <PageHeader crumb={`${t("page.global")} / ${t("nav.approvals")}`} title={t("page.approvals")} action={t("action.refresh")} onAction={() => statusFilter === "grants" ? void loadGrants() : void loadApprovals(statusFilter)} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.approvals")} />
      <Tabs className="approvals-root" value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
        <TabsList className="settings-tabs" aria-label={t("page.approvals")}>
          <TabsTrigger className="settings-tab" value="pending">{t("approval.pending")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="all">{t("approval.all")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="archived">{t("approval.archivedTab")}</TabsTrigger>
          <TabsTrigger className="settings-tab" value="grants">{t("approval.grants")}</TabsTrigger>
        </TabsList>
        <TabsContent className="extension-list approval-list" value="pending">
          {statusFilter === "pending" && approvals.map((approval) => (
            <article className="provider-card" key={approval.id}>
              <div className="item-row">
                <div>
                  <strong>{approval.title}</strong>
                  <span>{approval.description}</span>
                </div>
                <span className={`pill ${approval.risk === "critical" || approval.risk === "high" ? "danger" : ""}`}>{approval.risk}</span>
              </div>
              <pre className="approval-details">{approval.details}</pre>
              {approval.related !== undefined && <pre className="approval-details">{JSON.stringify(approval.related, null, 2)}</pre>}
              <div className="item-row">
                <span className="subtle">{approval.status} · {formatShortDate(approval.createdAt)}</span>
                {approval.status === "pending" && (
                  <div className="settings-actions">
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "deny")}>{t("approval.deny")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve")}>{t("approval.allowOnce")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", false, 24 * 60 * 60)}>{t("approval.allow24h")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", true)}>{t("approval.allowAlways")}</button>
                  </div>
                )}
                {approval.status !== "pending" && (
                  <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void archiveApprovalRecord(approval.id)}>{t("approval.archive")}</button>
                )}
              </div>
            </article>
          ))}
          {statusFilter === "pending" && approvalHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadApprovals(statusFilter, true)}>{t("session.loadMore")}</button>}
          {statusFilter === "pending" && !approvals.length && <div className="empty-state">{t("approval.empty")}</div>}
        </TabsContent>
        <TabsContent className="extension-list approval-list" value="all">
          {approvals.map((approval) => (
            <article className="provider-card" key={approval.id}>
              <div className="item-row">
                <div>
                  <strong>{approval.title}</strong>
                  <span>{approval.description}</span>
                </div>
                <span className={`pill ${approval.risk === "critical" || approval.risk === "high" ? "danger" : ""}`}>{approval.risk}</span>
              </div>
              <pre className="approval-details">{approval.details}</pre>
              {approval.related !== undefined && <pre className="approval-details">{JSON.stringify(approval.related, null, 2)}</pre>}
              <div className="item-row">
                <span className="subtle">{approval.status} · {formatShortDate(approval.createdAt)}</span>
                {approval.status === "pending" && (
                  <div className="settings-actions">
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "deny")}>{t("approval.deny")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve")}>{t("approval.allowOnce")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", false, 24 * 60 * 60)}>{t("approval.allow24h")}</button>
                    <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approve", true)}>{t("approval.allowAlways")}</button>
                  </div>
                )}
                {approval.status !== "pending" && (
                  <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void archiveApprovalRecord(approval.id)}>{t("approval.archive")}</button>
                )}
              </div>
            </article>
          ))}
          {approvalHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadApprovals(statusFilter, true)}>{t("session.loadMore")}</button>}
          {!approvals.length && <div className="empty-state">{t("approval.empty")}</div>}
        </TabsContent>
        <TabsContent className="extension-list approval-list" value="archived">
          {approvals.map((approval) => (
            <article className="provider-card" key={approval.id}>
              <div className="item-row">
                <div>
                  <strong>{approval.title}</strong>
                  <span>{approval.description}</span>
                </div>
                <span className={`pill ${approval.risk === "critical" || approval.risk === "high" ? "danger" : ""}`}>{approval.risk}</span>
              </div>
              <pre className="approval-details">{approval.details}</pre>
              {approval.related !== undefined && <pre className="approval-details">{JSON.stringify(approval.related, null, 2)}</pre>}
              <div className="item-row">
                <span className="subtle">{approval.status} · {approval.archivedAt ? `${t("approval.archivedAt")} ${formatShortDate(approval.archivedAt)}` : formatShortDate(approval.createdAt)}</span>
                <button className="ghost-button" type="button" disabled={busy === approval.id} onClick={() => void restoreApprovalRecord(approval.id)}>{t("approval.restore")}</button>
              </div>
            </article>
          ))}
          {approvalHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadApprovals(statusFilter, true)}>{t("session.loadMore")}</button>}
          {!approvals.length && <div className="empty-state">{t("approval.archivedEmpty")}</div>}
        </TabsContent>
        <TabsContent className="extension-list approval-list" value="grants">
          {grants.map((grant) => (
            <article className="provider-card" key={grant.id}>
              <div className="item-row">
                <div>
                  <strong>{grant.title}</strong>
                  <span>{grant.actionType} · {formatShortDate(grant.createdAt)} · {grant.expiresAt ? `${t("approval.expiresAt")} ${formatShortDate(grant.expiresAt)}` : t("approval.neverExpires")}</span>
                </div>
                <button className="ghost-button danger-button" type="button" disabled={busy === grant.id} onClick={() => void revokeGrant(grant.id)}>{t("approval.revokeGrant")}</button>
              </div>
              <pre className="approval-details">{grant.details}</pre>
            </article>
          ))}
          {grantHasMore && <button className="ghost-button load-more" type="button" onClick={() => void loadGrants(true)}>{t("session.loadMore")}</button>}
          {!grants.length && <div className="empty-state">{t("approval.grantsEmpty")}</div>}
        </TabsContent>
      </Tabs>
    </main>
  );
}
