# TS vs Rust Route Audit

- TS route entries: 317
- Rust route entries (approx): 353
- Missing TS routes in Rust: 0
- Rust extra routes: 25

## TS routes

| Status | Method | TS path | TS file | Rust match |
|---|---:|---|---|---|
| OK | DELETE | `*` | `apps/api/src/server/routes.ts` | * (apps/api-rs/src/http/mod.rs#fallback) |
| OK | GET | `*` | `apps/api/src/server/routes.ts` | * (apps/api-rs/src/http/mod.rs#fallback) |
| OK | PATCH | `*` | `apps/api/src/server/routes.ts` | * (apps/api-rs/src/http/mod.rs#fallback) |
| OK | POST | `*` | `apps/api/src/server/routes.ts` | * (apps/api-rs/src/http/mod.rs#fallback) |
| OK | PUT | `*` | `apps/api/src/server/routes.ts` | * (apps/api-rs/src/http/mod.rs#fallback) |
| OK | GET | `/api/agent-circles` | `apps/api/src/agents/routes.ts` | /api/agent-circles (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agent-circles` | `apps/api/src/agents/routes.ts` | /api/agent-circles (apps/api-rs/src/api/agents/mod.rs) |
| OK | DELETE | `/api/agent-circles/:id` | `apps/api/src/agents/routes.ts` | /api/agent-circles/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | PATCH | `/api/agent-circles/:id` | `apps/api/src/agents/routes.ts` | /api/agent-circles/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agent-circles/:id/groups` | `apps/api/src/agents/routes.ts` | /api/agent-circles/:id/groups (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agent-circles/:id/rooms` | `apps/api/src/agents/routes.ts` | /api/agent-circles/:id/rooms (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agent-groups` | `apps/api/src/agents/routes.ts` | /api/agent-groups (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agent-groups` | `apps/api/src/agents/routes.ts` | /api/agent-groups (apps/api-rs/src/api/agents/mod.rs) |
| OK | DELETE | `/api/agent-groups/:id` | `apps/api/src/agents/routes.ts` | /api/agent-groups/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | PATCH | `/api/agent-groups/:id` | `apps/api/src/agents/routes.ts` | /api/agent-groups/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agent-groups/:id/rooms` | `apps/api/src/agents/routes.ts` | /api/agent-groups/:id/rooms (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agent-role-templates` | `apps/api/src/agents/routes.ts` | /api/agent-role-templates (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agent-roles` | `apps/api/src/agents/routes.ts` | /api/agent-roles (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agent-roles` | `apps/api/src/agents/routes.ts` | /api/agent-roles (apps/api-rs/src/api/agents/mod.rs) |
| OK | DELETE | `/api/agent-roles/:id` | `apps/api/src/agents/routes.ts` | /api/agent-roles/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | PATCH | `/api/agent-roles/:id` | `apps/api/src/agents/routes.ts` | /api/agent-roles/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agent-roles/from-template` | `apps/api/src/agents/routes.ts` | /api/agent-roles/from-template (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agent-roles/import-file` | `apps/api/src/agents/routes.ts` | /api/agent-roles/import-file (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agents` | `apps/api/src/agents/routes.ts` | /api/agents (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agents` | `apps/api/src/agents/routes.ts` | /api/agents (apps/api-rs/src/api/agents/mod.rs) |
| OK | DELETE | `/api/agents/:id` | `apps/api/src/agents/routes.ts` | /api/agents/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | PATCH | `/api/agents/:id` | `apps/api/src/agents/routes.ts` | /api/agents/:id (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agents/:id/sessions` | `apps/api/src/agents/routes.ts` | /api/agents/:id/sessions (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agents/:id/sessions` | `apps/api/src/agents/routes.ts` | /api/agents/:id/sessions (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/agents/:id/stats` | `apps/api/src/agents/routes.ts` | /api/agents/:id/stats (apps/api-rs/src/api/agents/mod.rs) |
| OK | POST | `/api/agents/batch` | `apps/api/src/agents/routes.ts` | /api/agents/batch (apps/api-rs/src/api/agents/mod.rs) |
| OK | DELETE | `/api/app-notifications` | `apps/api/src/notifications/app-routes.ts` | /api/app-notifications (apps/api-rs/src/api/app_notifications/mod.rs) |
| OK | GET | `/api/app-notifications` | `apps/api/src/notifications/app-routes.ts` | /api/app-notifications (apps/api-rs/src/api/app_notifications/mod.rs) |
| OK | GET | `/api/app-notifications/events` | `apps/api/src/notifications/app-routes.ts` | /api/app-notifications/events (apps/api-rs/src/api/app_notifications/mod.rs) |
| OK | PATCH | `/api/app-notifications/read` | `apps/api/src/notifications/app-routes.ts` | /api/app-notifications/read (apps/api-rs/src/api/app_notifications/mod.rs) |
| OK | GET | `/api/approval-grants` | `apps/api/src/settings/routes.ts` | /api/approval-grants (apps/api-rs/src/api/approvals/mod.rs#pub fn grants_router) |
| OK | DELETE | `/api/approval-grants/:id` | `apps/api/src/settings/routes.ts` | /api/approval-grants/:id (apps/api-rs/src/api/approvals/mod.rs#pub fn grants_router) |
| OK | GET | `/api/approvals` | `apps/api/src/settings/routes.ts` | /api/approvals (apps/api-rs/src/api/approvals/mod.rs)<br>/api/approvals (apps/api-rs/src/api/approvals/mod.rs) |
| OK | POST | `/api/approvals/:id/approve` | `apps/api/src/settings/routes.ts` | /api/approvals/:id/approve (apps/api-rs/src/api/approvals/mod.rs) |
| OK | POST | `/api/approvals/:id/archive` | `apps/api/src/settings/routes.ts` | /api/approvals/:id/archive (apps/api-rs/src/api/approvals/mod.rs) |
| OK | POST | `/api/approvals/:id/deny` | `apps/api/src/settings/routes.ts` | /api/approvals/:id/deny (apps/api-rs/src/api/approvals/mod.rs) |
| OK | POST | `/api/approvals/:id/restore` | `apps/api/src/settings/routes.ts` | /api/approvals/:id/restore (apps/api-rs/src/api/approvals/mod.rs) |
| OK | POST | `/api/auth/access-token` | `apps/api/src/auth/routes.ts` | /api/auth/access-token (apps/api-rs/src/api/auth/mod.rs) |
| OK | GET | `/api/auth/api-key-permissions` | `apps/api/src/auth/routes.ts` | /api/auth/api-key-permissions (apps/api-rs/src/api/auth/mod.rs) |
| OK | GET | `/api/auth/api-keys` | `apps/api/src/auth/routes.ts` | /api/auth/api-keys (apps/api-rs/src/api/auth/mod.rs) |
| OK | POST | `/api/auth/api-keys` | `apps/api/src/auth/routes.ts` | /api/auth/api-keys (apps/api-rs/src/api/auth/mod.rs) |
| OK | DELETE | `/api/auth/api-keys/:id` | `apps/api/src/auth/routes.ts` | /api/auth/api-keys/:id (apps/api-rs/src/api/auth/mod.rs) |
| OK | PATCH | `/api/auth/api-keys/:id` | `apps/api/src/auth/routes.ts` | /api/auth/api-keys/:id (apps/api-rs/src/api/auth/mod.rs) |
| OK | DELETE | `/api/auth/api-keys/:id/record` | `apps/api/src/auth/routes.ts` | /api/auth/api-keys/:id/record (apps/api-rs/src/api/auth/mod.rs) |
| OK | POST | `/api/auth/login` | `apps/api/src/auth/routes.ts` | /api/auth/login (apps/api-rs/src/api/auth/mod.rs) |
| OK | POST | `/api/auth/logout` | `apps/api/src/auth/routes.ts` | /api/auth/logout (apps/api-rs/src/api/auth/mod.rs) |
| OK | POST | `/api/auth/otp/reset` | `apps/api/src/auth/routes.ts` | /api/auth/otp/reset (apps/api-rs/src/api/auth/mod.rs) |
| OK | POST | `/api/auth/otp/reset/confirm` | `apps/api/src/auth/routes.ts` | /api/auth/otp/reset/confirm (apps/api-rs/src/api/auth/mod.rs) |
| OK | POST | `/api/auth/setup/complete` | `apps/api/src/auth/routes.ts` | /api/auth/setup/complete (apps/api-rs/src/api/auth/mod.rs) |
| OK | POST | `/api/auth/setup/start` | `apps/api/src/auth/routes.ts` | /api/auth/setup/start (apps/api-rs/src/api/auth/mod.rs) |
| OK | GET | `/api/auth/state` | `apps/api/src/auth/routes.ts` | /api/auth/state (apps/api-rs/src/api/auth/mod.rs) |
| OK | GET | `/api/automations` | `apps/api/src/automations/routes.ts` | /api/automations (apps/api-rs/src/api/automations/mod.rs) |
| OK | POST | `/api/automations` | `apps/api/src/automations/routes.ts` | /api/automations (apps/api-rs/src/api/automations/mod.rs) |
| OK | DELETE | `/api/automations/:id` | `apps/api/src/automations/routes.ts` | /api/automations/:id (apps/api-rs/src/api/automations/mod.rs) |
| OK | PATCH | `/api/automations/:id` | `apps/api/src/automations/routes.ts` | /api/automations/:id (apps/api-rs/src/api/automations/mod.rs) |
| OK | POST | `/api/automations/:id/run` | `apps/api/src/automations/routes.ts` | /api/automations/:id/run (apps/api-rs/src/api/automations/mod.rs) |
| OK | DELETE | `/api/automations/:id/runs` | `apps/api/src/automations/routes.ts` | /api/automations/:id/runs (apps/api-rs/src/api/automations/mod.rs) |
| OK | GET | `/api/automations/:id/runs` | `apps/api/src/automations/routes.ts` | /api/automations/:id/runs (apps/api-rs/src/api/automations/mod.rs) |
| OK | POST | `/api/automations/:id/runs/cancel-queued` | `apps/api/src/automations/routes.ts` | /api/automations/:id/runs/cancel-queued (apps/api-rs/src/api/automations/mod.rs) |
| OK | POST | `/api/automations/:id/runs/stop-running` | `apps/api/src/automations/routes.ts` | /api/automations/:id/runs/stop-running (apps/api-rs/src/api/automations/mod.rs) |
| OK | POST | `/api/codex/tasks` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/activity` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/activity (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/changes` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/changes (apps/api-rs/src/api/tasks/mod.rs) |
| OK | POST | `/api/codex/tasks/:id/changes/revert-file` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/changes/revert-file (apps/api-rs/src/api/tasks/mod.rs) |
| OK | POST | `/api/codex/tasks/:id/changes/stage-file` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/changes/stage-file (apps/api-rs/src/api/tasks/mod.rs) |
| OK | POST | `/api/codex/tasks/:id/changes/unstage-file` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/changes/unstage-file (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/context` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/context (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/context/:file` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/context/:file (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/diff` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/diff (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/events` | `apps/api/src/server/routes.ts` | /api/codex/tasks/:id/events (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/log` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/log (apps/api-rs/src/api/tasks/mod.rs) |
| OK | POST | `/api/codex/tasks/:id/messages` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/messages (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/queue` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/queue (apps/api-rs/src/api/tasks/mod.rs) |
| OK | PATCH | `/api/codex/tasks/:id/queue` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/queue (apps/api-rs/src/api/tasks/mod.rs) |
| OK | POST | `/api/codex/tasks/:id/queue` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/queue (apps/api-rs/src/api/tasks/mod.rs) |
| OK | DELETE | `/api/codex/tasks/:id/queue/:queueId` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/queue/:queue_id (apps/api-rs/src/api/tasks/mod.rs) |
| OK | PATCH | `/api/codex/tasks/:id/queue/:queueId` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/queue/:queue_id (apps/api-rs/src/api/tasks/mod.rs) |
| OK | POST | `/api/codex/tasks/:id/recover` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/recover (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/codex/tasks/:id/runs` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/runs (apps/api-rs/src/api/tasks/mod.rs) |
| OK | POST | `/api/codex/tasks/:id/stop` | `apps/api/src/tasks/routes.ts` | /api/codex/tasks/:id/stop (apps/api-rs/src/api/tasks/mod.rs) |
| OK | GET | `/api/execution-contexts` | `apps/api/src/tasks/routes.ts` | /api/execution-contexts (apps/api-rs/src/api/execution_contexts.rs) |
| OK | GET | `/api/extensions/detail` | `apps/api/src/extensions/routes.ts` | /api/extensions/detail (apps/api-rs/src/api/extensions/mod.rs) |
| OK | DELETE | `/api/extensions/marketplace` | `apps/api/src/extensions/routes.ts` | /api/extensions/marketplace (apps/api-rs/src/api/extensions/mod.rs) |
| OK | GET | `/api/extensions/marketplace` | `apps/api/src/extensions/routes.ts` | /api/extensions/marketplace (apps/api-rs/src/api/extensions/mod.rs) |
| OK | DELETE | `/api/extensions/marketplace/all` | `apps/api/src/extensions/routes.ts` | /api/extensions/marketplace/all (apps/api-rs/src/api/extensions/mod.rs) |
| OK | POST | `/api/extensions/marketplace/import` | `apps/api/src/extensions/routes.ts` | /api/extensions/marketplace/import (apps/api-rs/src/api/extensions/mod.rs) |
| OK | POST | `/api/extensions/marketplace/install` | `apps/api/src/extensions/routes.ts` | /api/extensions/marketplace/install (apps/api-rs/src/api/extensions/mod.rs) |
| OK | GET | `/api/extensions/mcp` | `apps/api/src/extensions/routes.ts` | /api/extensions/mcp (apps/api-rs/src/api/extensions/mod.rs) |
| OK | POST | `/api/extensions/mcp` | `apps/api/src/extensions/routes.ts` | /api/extensions/mcp (apps/api-rs/src/api/extensions/mod.rs) |
| OK | POST | `/api/extensions/mcp/import` | `apps/api/src/extensions/routes.ts` | /api/extensions/mcp/import (apps/api-rs/src/api/extensions/mod.rs) |
| OK | GET | `/api/extensions/plugins` | `apps/api/src/extensions/routes.ts` | /api/extensions/plugins (apps/api-rs/src/api/extensions/mod.rs) |
| OK | POST | `/api/extensions/plugins` | `apps/api/src/extensions/routes.ts` | /api/extensions/plugins (apps/api-rs/src/api/extensions/mod.rs) |
| OK | DELETE | `/api/extensions/skills` | `apps/api/src/extensions/routes.ts` | /api/extensions/skills (apps/api-rs/src/api/extensions/mod.rs) |
| OK | GET | `/api/extensions/skills` | `apps/api/src/extensions/routes.ts` | /api/extensions/skills (apps/api-rs/src/api/extensions/mod.rs) |
| OK | POST | `/api/extensions/skills` | `apps/api/src/extensions/routes.ts` | /api/extensions/skills (apps/api-rs/src/api/extensions/mod.rs) |
| OK | PUT | `/api/extensions/skills` | `apps/api/src/extensions/routes.ts` | /api/extensions/skills (apps/api-rs/src/api/extensions/mod.rs) |
| OK | POST | `/api/extensions/skills/import` | `apps/api/src/extensions/routes.ts` | /api/extensions/skills/import (apps/api-rs/src/api/extensions/mod.rs) |
| OK | GET | `/api/file-mounts` | `apps/api/src/files/routes.ts` | /api/file-mounts (apps/api-rs/src/api/files/mod.rs) |
| OK | POST | `/api/file-mounts` | `apps/api/src/files/routes.ts` | /api/file-mounts (apps/api-rs/src/api/files/mod.rs) |
| OK | DELETE | `/api/file-mounts/:id` | `apps/api/src/files/routes.ts` | /api/file-mounts/:id (apps/api-rs/src/api/files/mod.rs) |
| OK | PATCH | `/api/file-mounts/:id` | `apps/api/src/files/routes.ts` | /api/file-mounts/:id (apps/api-rs/src/api/files/mod.rs) |
| OK | DELETE | `/api/files` | `apps/api/src/files/routes.ts` | /api/files (apps/api-rs/src/api/files/mod.rs) |
| OK | GET | `/api/files` | `apps/api/src/files/routes.ts` | /api/files (apps/api-rs/src/api/files/mod.rs) |
| OK | PATCH | `/api/files` | `apps/api/src/files/routes.ts` | /api/files (apps/api-rs/src/api/files/mod.rs) |
| OK | POST | `/api/files` | `apps/api/src/files/routes.ts` | /api/files (apps/api-rs/src/api/files/mod.rs) |
| OK | POST | `/api/files/archive` | `apps/api/src/files/routes.ts` | /api/files/archive (apps/api-rs/src/api/files/mod.rs) |
| OK | POST | `/api/files/archive/preview` | `apps/api/src/files/routes.ts` | /api/files/archive/preview (apps/api-rs/src/api/files/mod.rs) |
| OK | GET | `/api/files/archive/templates` | `apps/api/src/files/routes.ts` | /api/files/archive/templates (apps/api-rs/src/api/files/mod.rs) |
| OK | GET | `/api/files/content` | `apps/api/src/files/routes.ts` | /api/files/content (apps/api-rs/src/api/files/mod.rs) |
| OK | PUT | `/api/files/content` | `apps/api/src/files/routes.ts` | /api/files/content (apps/api-rs/src/api/files/mod.rs) |
| OK | GET | `/api/goals` | `apps/api/src/goals/routes.ts` | /api/goals (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals` | `apps/api/src/goals/routes.ts` | /api/goals (apps/api-rs/src/api/goals/mod.rs) |
| OK | DELETE | `/api/goals/:id` | `apps/api/src/goals/routes.ts` | /api/goals/:id (apps/api-rs/src/api/goals/mod.rs) |
| OK | GET | `/api/goals/:id` | `apps/api/src/goals/routes.ts` | /api/goals/:id (apps/api-rs/src/api/goals/mod.rs) |
| OK | PATCH | `/api/goals/:id` | `apps/api/src/goals/routes.ts` | /api/goals/:id (apps/api-rs/src/api/goals/mod.rs) |
| OK | GET | `/api/goals/:id/events` | `apps/api/src/goals/routes.ts` | /api/goals/:id/events (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals/:id/focuses` | `apps/api/src/goals/routes.ts` | /api/goals/:id/focuses (apps/api-rs/src/api/goals/mod.rs) |
| OK | PATCH | `/api/goals/:id/focuses/:focusId` | `apps/api/src/goals/routes.ts` | /api/goals/:id/focuses/:focus_id (apps/api-rs/src/api/goals/mod.rs) |
| OK | GET | `/api/goals/:id/items` | `apps/api/src/goals/routes.ts` | /api/goals/:id/items (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals/:id/items` | `apps/api/src/goals/routes.ts` | /api/goals/:id/items (apps/api-rs/src/api/goals/mod.rs) |
| OK | DELETE | `/api/goals/:id/items/:itemId` | `apps/api/src/goals/routes.ts` | /api/goals/:id/items/:item_id (apps/api-rs/src/api/goals/mod.rs) |
| OK | PATCH | `/api/goals/:id/items/:itemId` | `apps/api/src/goals/routes.ts` | /api/goals/:id/items/:item_id (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals/:id/orchestrate` | `apps/api/src/goals/routes.ts` | /api/goals/:id/orchestrate (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals/:id/plan` | `apps/api/src/goals/routes.ts` | /api/goals/:id/plan (apps/api-rs/src/api/goals/mod.rs) |
| OK | GET | `/api/goals/:id/proposals` | `apps/api/src/goals/routes.ts` | /api/goals/:id/proposals (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals/:id/proposals` | `apps/api/src/goals/routes.ts` | /api/goals/:id/proposals (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals/:id/proposals/:proposalId/approve` | `apps/api/src/goals/routes.ts` | /api/goals/:id/proposals/:proposal_id/approve (apps/api-rs/src/api/goals/mod.rs) |
| OK | POST | `/api/goals/:id/proposals/:proposalId/reject` | `apps/api/src/goals/routes.ts` | /api/goals/:id/proposals/:proposal_id/reject (apps/api-rs/src/api/goals/mod.rs) |
| OK | GET | `/api/notifications` | `apps/api/src/notifications/routes.ts` | /api/notifications (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/accounts` | `apps/api/src/notifications/routes.ts` | /api/notifications/accounts (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/accounts` | `apps/api/src/notifications/routes.ts` | /api/notifications/accounts (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/accounts/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/accounts/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | PATCH | `/api/notifications/accounts/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/accounts/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/accounts/:id/test` | `apps/api/src/notifications/routes.ts` | /api/notifications/accounts/:id/test (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/accounts/:id/weixin/qr/start` | `apps/api/src/notifications/routes.ts` | /api/notifications/accounts/:id/weixin/qr/start (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/accounts/:id/weixin/qr/status` | `apps/api/src/notifications/routes.ts` | /api/notifications/accounts/:id/weixin/qr/status (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/channels` | `apps/api/src/notifications/routes.ts` | /api/notifications/channels (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/channels` | `apps/api/src/notifications/routes.ts` | /api/notifications/channels (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/channels/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/channels/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | PATCH | `/api/notifications/channels/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/channels/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/deliveries` | `apps/api/src/notifications/routes.ts` | /api/notifications/deliveries (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/deliveries` | `apps/api/src/notifications/routes.ts` | /api/notifications/deliveries (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/deliveries/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/deliveries/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/deliveries/:id/retry` | `apps/api/src/notifications/routes.ts` | /api/notifications/deliveries/:id/retry (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/ephemeral-rules` | `apps/api/src/notifications/routes.ts` | /api/notifications/ephemeral-rules (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/ephemeral-rules` | `apps/api/src/notifications/routes.ts` | /api/notifications/ephemeral-rules (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/ephemeral-rules/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/ephemeral-rules/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | PATCH | `/api/notifications/ephemeral-rules/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/ephemeral-rules/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/platforms` | `apps/api/src/notifications/routes.ts` | /api/notifications/platforms (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/recipients` | `apps/api/src/notifications/routes.ts` | /api/notifications/recipients (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/recipients` | `apps/api/src/notifications/routes.ts` | /api/notifications/recipients (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/recipients/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/recipients/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | PATCH | `/api/notifications/recipients/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/recipients/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/recipients/:id/test` | `apps/api/src/notifications/routes.ts` | /api/notifications/recipients/:id/test (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/rules` | `apps/api/src/notifications/routes.ts` | /api/notifications/rules (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/rules` | `apps/api/src/notifications/routes.ts` | /api/notifications/rules (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/rules` | `apps/api/src/notifications/routes.ts` | /api/notifications/rules (apps/api-rs/src/api/notifications/mod.rs) |
| OK | DELETE | `/api/notifications/rules/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/rules/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | PATCH | `/api/notifications/rules/:id` | `apps/api/src/notifications/routes.ts` | /api/notifications/rules/:id (apps/api-rs/src/api/notifications/mod.rs) |
| OK | POST | `/api/notifications/weixin/qr/start` | `apps/api/src/notifications/routes.ts` | /api/notifications/weixin/qr/start (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/notifications/weixin/qr/status` | `apps/api/src/notifications/routes.ts` | /api/notifications/weixin/qr/status (apps/api-rs/src/api/notifications/mod.rs) |
| OK | GET | `/api/permission-profiles` | `apps/api/src/agents/routes.ts` | /api/permission-profiles (apps/api-rs/src/api/agents/mod.rs) |
| OK | GET | `/api/previews` | `apps/api/src/previews/routes.ts` | /api/previews (apps/api-rs/src/api/previews/mod.rs) |
| OK | POST | `/api/previews` | `apps/api/src/previews/routes.ts` | /api/previews (apps/api-rs/src/api/previews/mod.rs) |
| OK | DELETE | `/api/previews/:id` | `apps/api/src/previews/routes.ts` | /api/previews/:id (apps/api-rs/src/api/previews/mod.rs) |
| OK | POST | `/api/previews/:id/access` | `apps/api/src/previews/routes.ts` | /api/previews/:id/access (apps/api-rs/src/api/previews/mod.rs) |
| OK | PUT | `/api/previews/:id/access` | `apps/api/src/previews/routes.ts` | /api/previews/:id/access (apps/api-rs/src/api/previews/mod.rs) |
| OK | GET | `/api/previews/:id/logs` | `apps/api/src/previews/routes.ts` | /api/previews/:id/logs (apps/api-rs/src/api/previews/mod.rs) |
| OK | GET | `/api/previews/:id/logs/events` | `apps/api/src/previews/routes.ts` | /api/previews/:id/logs/events (apps/api-rs/src/api/previews/mod.rs) |
| OK | POST | `/api/previews/:id/start` | `apps/api/src/previews/routes.ts` | /api/previews/:id/start (apps/api-rs/src/api/previews/mod.rs) |
| OK | POST | `/api/previews/:id/stop` | `apps/api/src/previews/routes.ts` | /api/previews/:id/stop (apps/api-rs/src/api/previews/mod.rs) |
| OK | GET | `/api/projects` | `apps/api/src/projects/routes.ts` | /api/projects (apps/api-rs/src/api/projects/mod.rs) |
| OK | POST | `/api/projects` | `apps/api/src/projects/routes.ts` | /api/projects (apps/api-rs/src/api/projects/mod.rs) |
| OK | DELETE | `/api/projects/:id` | `apps/api/src/projects/routes.ts` | /api/projects/:id (apps/api-rs/src/api/projects/mod.rs) |
| OK | PATCH | `/api/projects/:id` | `apps/api/src/projects/routes.ts` | /api/projects/:id (apps/api-rs/src/api/projects/mod.rs) |
| OK | GET | `/api/projects/:id/changes` | `apps/api/src/projects/routes.ts` | /api/projects/:id/changes (apps/api-rs/src/api/projects/mod.rs) |
| OK | POST | `/api/projects/:id/changes/revert-file` | `apps/api/src/projects/routes.ts` | /api/projects/:id/changes/revert-file (apps/api-rs/src/api/projects/mod.rs) |
| OK | POST | `/api/projects/:id/changes/stage-file` | `apps/api/src/projects/routes.ts` | /api/projects/:id/changes/stage-file (apps/api-rs/src/api/projects/mod.rs) |
| OK | POST | `/api/projects/:id/changes/unstage-file` | `apps/api/src/projects/routes.ts` | /api/projects/:id/changes/unstage-file (apps/api-rs/src/api/projects/mod.rs) |
| OK | POST | `/api/projects/:id/check` | `apps/api/src/projects/routes.ts` | /api/projects/:id/check (apps/api-rs/src/api/projects/mod.rs) |
| OK | GET | `/api/projects/:id/check-runs` | `apps/api/src/projects/routes.ts` | /api/projects/:id/check-runs (apps/api-rs/src/api/projects/mod.rs) |
| OK | POST | `/api/projects/:id/git` | `apps/api/src/projects/routes.ts` | /api/projects/:id/git (apps/api-rs/src/api/projects/mod.rs) |
| OK | GET | `/api/projects/:id/git-operations` | `apps/api/src/projects/routes.ts` | /api/projects/:id/git-operations (apps/api-rs/src/api/projects/mod.rs) |
| OK | GET | `/api/projects/:id/sessions` | `apps/api/src/projects/routes.ts` | /api/projects/:id/sessions (apps/api-rs/src/api/projects/mod.rs) |
| OK | GET | `/api/projects/:id/stats` | `apps/api/src/projects/routes.ts` | /api/projects/:id/stats (apps/api-rs/src/api/projects/mod.rs) |
| OK | GET | `/api/providers` | `apps/api/src/providers/routes.ts` | /api/providers (apps/api-rs/src/api/providers/mod.rs) |
| OK | POST | `/api/providers` | `apps/api/src/providers/routes.ts` | /api/providers (apps/api-rs/src/api/providers/mod.rs) |
| OK | DELETE | `/api/providers/:id` | `apps/api/src/providers/routes.ts` | /api/providers/:id (apps/api-rs/src/api/providers/mod.rs) |
| OK | PATCH | `/api/providers/:id` | `apps/api/src/providers/routes.ts` | /api/providers/:id (apps/api-rs/src/api/providers/mod.rs) |
| OK | POST | `/api/providers/:id/detect` | `apps/api/src/providers/routes.ts` | /api/providers/:id/detect (apps/api-rs/src/api/providers/mod.rs) |
| OK | DELETE | `/api/providers/:id/health` | `apps/api/src/providers/routes.ts` | /api/providers/:id/health (apps/api-rs/src/api/providers/mod.rs) |
| OK | GET | `/api/providers/:id/health` | `apps/api/src/providers/routes.ts` | /api/providers/:id/health (apps/api-rs/src/api/providers/mod.rs) |
| OK | GET | `/api/providers/:id/models` | `apps/api/src/providers/routes.ts` | /api/providers/:id/models (apps/api-rs/src/api/providers/mod.rs) |
| OK | POST | `/api/providers/:id/test` | `apps/api/src/providers/routes.ts` | /api/providers/:id/test (apps/api-rs/src/api/providers/mod.rs) |
| OK | POST | `/api/providers/detect` | `apps/api/src/providers/routes.ts` | /api/providers/detect (apps/api-rs/src/api/providers/mod.rs) |
| OK | POST | `/api/providers/models` | `apps/api/src/providers/routes.ts` | /api/providers/models (apps/api-rs/src/api/providers/mod.rs) |
| OK | GET | `/api/rooms` | `apps/api/src/rooms/routes.ts` | /api/rooms (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms` | `apps/api/src/rooms/routes.ts` | /api/rooms (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id (apps/api-rs/src/api/rooms/mod.rs) |
| OK | PATCH | `/api/rooms/:id` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/agents` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/agents (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/agents` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/agents (apps/api-rs/src/api/rooms/mod.rs) |
| OK | PATCH | `/api/rooms/:id/agents/:agentId` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/agents/:agentId (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/artifacts` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/artifacts (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/artifacts` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/artifacts (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/decisions` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/decisions (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/decisions` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/decisions (apps/api-rs/src/api/rooms/mod.rs) |
| OK | PATCH | `/api/rooms/:id/decisions/:decisionId` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/decisions/:decisionId (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/events` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/events (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/events/stream` | `apps/api/src/server/routes.ts` | /api/rooms/:id/events/stream (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/handoffs` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/handoffs (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/handoffs` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/handoffs (apps/api-rs/src/api/rooms/mod.rs) |
| OK | PATCH | `/api/rooms/:id/handoffs/:handoffId` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/handoffs/:handoffId (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/messages` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/messages (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/runs` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/runs (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/runs/:runId/diff` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/runs/:runId/diff (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/runs/:runId/merge` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/runs/:runId/merge (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/runs/:runId/reject` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/runs/:runId/reject (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/schedules` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/schedules (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/schedules` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/schedules (apps/api-rs/src/api/rooms/mod.rs) |
| OK | DELETE | `/api/rooms/:id/schedules/:scheduleId` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/schedules/:scheduleId (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/rooms/:id/tasks` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/tasks` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks (apps/api-rs/src/api/rooms/mod.rs) |
| OK | DELETE | `/api/rooms/:id/tasks/:taskId` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks/:taskId (apps/api-rs/src/api/rooms/mod.rs) |
| OK | PATCH | `/api/rooms/:id/tasks/:taskId` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks/:taskId (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/tasks/:taskId/cancel` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks/:taskId/cancel (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/tasks/:taskId/retry` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks/:taskId/retry (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/tasks/:taskId/start` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks/:taskId/start (apps/api-rs/src/api/rooms/mod.rs) |
| OK | POST | `/api/rooms/:id/tasks/retry-failed` | `apps/api/src/rooms/routes.ts` | /api/rooms/:id/tasks/retry-failed (apps/api-rs/src/api/rooms/mod.rs) |
| OK | GET | `/api/sessions` | `apps/api/src/tasks/routes.ts` | /api/sessions (apps/api-rs/src/api/sessions/mod.rs) |
| OK | POST | `/api/sessions` | `apps/api/src/tasks/routes.ts` | /api/sessions (apps/api-rs/src/api/sessions/mod.rs) |
| OK | DELETE | `/api/sessions/:id` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id (apps/api-rs/src/api/sessions/mod.rs) |
| OK | GET | `/api/sessions/:id` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id (apps/api-rs/src/api/sessions/mod.rs) |
| OK | PATCH | `/api/sessions/:id` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id (apps/api-rs/src/api/sessions/mod.rs) |
| OK | GET | `/api/sessions/:id/cards` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/cards (apps/api-rs/src/api/sessions/mod.rs) |
| OK | DELETE | `/api/sessions/:id/cards/:cardId` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/cards/:card_id (apps/api-rs/src/api/sessions/mod.rs) |
| OK | POST | `/api/sessions/:id/compact` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/compact (apps/api-rs/src/api/sessions/mod.rs) |
| OK | GET | `/api/sessions/:id/compaction` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/compaction (apps/api-rs/src/api/sessions/mod.rs) |
| OK | PATCH | `/api/sessions/:id/compaction` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/compaction (apps/api-rs/src/api/sessions/mod.rs) |
| OK | GET | `/api/sessions/:id/compactions` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/compactions (apps/api-rs/src/api/sessions/mod.rs) |
| OK | POST | `/api/sessions/:id/compactions/:compactionId/restore` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/compactions/:compaction_id/restore (apps/api-rs/src/api/sessions/mod.rs) |
| OK | GET | `/api/sessions/:id/messages` | `apps/api/src/tasks/routes.ts` | /api/sessions/:id/messages (apps/api-rs/src/api/sessions/mod.rs) |
| OK | POST | `/api/settings/approvals/reset` | `apps/api/src/settings/routes.ts` | /api/settings/approvals/reset (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/backup` | `apps/api/src/settings/routes.ts` | /api/settings/backup (apps/api-rs/src/api/settings/mod.rs) |
| OK | PATCH | `/api/settings/backup` | `apps/api/src/settings/routes.ts` | /api/settings/backup (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/backup/download` | `apps/api/src/settings/routes.ts` | /api/settings/backup/download (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/backup/preview` | `apps/api/src/settings/routes.ts` | /api/settings/backup/preview (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/codex-runtime` | `apps/api/src/settings/routes.ts` | /api/settings/codex-runtime (apps/api-rs/src/api/settings/mod.rs) |
| OK | PATCH | `/api/settings/codex-runtime` | `apps/api/src/settings/routes.ts` | /api/settings/codex-runtime (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/environment` | `apps/api/src/environment/routes.ts` | /api/settings/environment (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/bulk` | `apps/api/src/environment/routes.ts` | /api/settings/environment/bulk (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/mise/install` | `apps/api/src/environment/routes.ts` | /api/settings/environment/mise/install (apps/api-rs/src/api/settings/mod.rs) |
| OK | DELETE | `/api/settings/environment/packages/:id` | `apps/api/src/environment/routes.ts` | /api/settings/environment/packages/:id (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/packages/install` | `apps/api/src/environment/routes.ts` | /api/settings/environment/packages/install (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/restore-missing` | `apps/api/src/environment/routes.ts` | /api/settings/environment/restore-missing (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/restore-preview` | `apps/api/src/environment/routes.ts` | /api/settings/environment/restore-preview (apps/api-rs/src/api/settings/mod.rs) |
| OK | DELETE | `/api/settings/environment/restore-runs` | `apps/api/src/environment/routes.ts` | /api/settings/environment/restore-runs (apps/api-rs/src/api/settings/mod.rs) |
| OK | DELETE | `/api/settings/environment/restore-runs/:id` | `apps/api/src/environment/routes.ts` | /api/settings/environment/restore-runs/:id (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/scan` | `apps/api/src/environment/routes.ts` | /api/settings/environment/scan (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/environment/tool-probe` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tool-probe (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/environment/tool-registry` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tool-registry (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/environment/tool-versions` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tool-versions (apps/api-rs/src/api/settings/mod.rs) |
| OK | DELETE | `/api/settings/environment/tools/:id` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tools/:id (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/environment/tools/:id/packages` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tools/:id/packages (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/environment/tools/:id/packages/probe` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tools/:id/packages/probe (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/tools/:id/set-default` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tools/:id/set-default (apps/api-rs/src/api/settings/mod.rs) |
| OK | DELETE | `/api/settings/environment/tools/:id/uninstall` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tools/:id/uninstall (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/tools/install` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tools/install (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/environment/tools/register` | `apps/api/src/environment/routes.ts` | /api/settings/environment/tools/register (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/maintenance/cleanup` | `apps/api/src/settings/routes.ts` | /api/settings/maintenance/cleanup (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/notification-test` | `apps/api/src/settings/routes.ts` | /api/settings/notification-test (apps/api-rs/src/api/settings/mod.rs) |
| OK | PATCH | `/api/settings/notification-test` | `apps/api/src/settings/routes.ts` | /api/settings/notification-test (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/preview-access` | `apps/api/src/settings/routes.ts` | /api/settings/preview-access (apps/api-rs/src/api/settings/mod.rs) |
| OK | PATCH | `/api/settings/preview-access` | `apps/api/src/settings/routes.ts` | /api/settings/preview-access (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/rate-limit` | `apps/api/src/settings/routes.ts` | /api/settings/rate-limit (apps/api-rs/src/api/settings/mod.rs) |
| OK | PATCH | `/api/settings/rate-limit` | `apps/api/src/settings/routes.ts` | /api/settings/rate-limit (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/restore` | `apps/api/src/settings/routes.ts` | /api/settings/restore (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/restore/preview` | `apps/api/src/settings/routes.ts` | /api/settings/restore/preview (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/session-compaction` | `apps/api/src/settings/routes.ts` | /api/settings/session-compaction (apps/api-rs/src/api/settings/mod.rs) |
| OK | PATCH | `/api/settings/session-compaction` | `apps/api/src/settings/routes.ts` | /api/settings/session-compaction (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/storage` | `apps/api/src/storage/routes.ts` | /api/settings/storage (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/storage/delete` | `apps/api/src/storage/routes.ts` | /api/settings/storage/delete (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/storage/delete-batch` | `apps/api/src/storage/routes.ts` | /api/settings/storage/delete-batch (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/settings/task-health` | `apps/api/src/settings/routes.ts` | /api/settings/task-health (apps/api-rs/src/api/settings/mod.rs) |
| OK | POST | `/api/settings/task-health/repair` | `apps/api/src/settings/routes.ts` | /api/settings/task-health/repair (apps/api-rs/src/api/settings/mod.rs) |
| OK | GET | `/api/task-runs` | `apps/api/src/tasks/routes.ts` | /api/task-runs (apps/api-rs/src/api/tasks/mod.rs#pub fn task_runs_router) |
| OK | GET | `/api/terminal/defaults` | `apps/api/src/terminal/routes.ts` | /api/terminal/defaults (apps/api-rs/src/api/terminal/mod.rs) |
| OK | POST | `/api/terminal/exec` | `apps/api/src/terminal/routes.ts` | /api/terminal/exec (apps/api-rs/src/api/terminal/mod.rs) |
| OK | GET | `/api/terminal/sessions` | `apps/api/src/terminal/routes.ts` | /api/terminal/sessions (apps/api-rs/src/api/terminal/mod.rs) |
| OK | POST | `/api/terminal/sessions` | `apps/api/src/terminal/routes.ts` | /api/terminal/sessions (apps/api-rs/src/api/terminal/mod.rs) |
| OK | DELETE | `/api/terminal/sessions/:id` | `apps/api/src/terminal/routes.ts` | /api/terminal/sessions/:id (apps/api-rs/src/api/terminal/mod.rs) |
| OK | PATCH | `/api/terminal/sessions/:id` | `apps/api/src/terminal/routes.ts` | /api/terminal/sessions/:id (apps/api-rs/src/api/terminal/mod.rs) |
| OK | GET | `/api/webhook-routes` | `apps/api/src/webhooks/routes.ts` | /api/webhook-routes (apps/api-rs/src/api/webhooks/mod.rs) |
| OK | POST | `/api/webhook-routes` | `apps/api/src/webhooks/routes.ts` | /api/webhook-routes (apps/api-rs/src/api/webhooks/mod.rs) |
| OK | DELETE | `/api/webhook-routes/:id` | `apps/api/src/webhooks/routes.ts` | /api/webhook-routes/:id (apps/api-rs/src/api/webhooks/mod.rs) |
| OK | PATCH | `/api/webhook-routes/:id` | `apps/api/src/webhooks/routes.ts` | /api/webhook-routes/:id (apps/api-rs/src/api/webhooks/mod.rs) |
| OK | DELETE | `/api/webhook/:routeKey` | `apps/api/src/webhooks/routes.ts` | /api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | GET | `/api/webhook/:routeKey` | `apps/api/src/webhooks/routes.ts` | /api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | PATCH | `/api/webhook/:routeKey` | `apps/api/src/webhooks/routes.ts` | /api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | POST | `/api/webhook/:routeKey` | `apps/api/src/webhooks/routes.ts` | /api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | PUT | `/api/webhook/:routeKey` | `apps/api/src/webhooks/routes.ts` | /api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/api/webhook/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | GET | `/health` | `apps/api/src/server/routes.ts` | /health (apps/api-rs/src/http/mod.rs) |
| OK | GET | `/preview/:id/:token/*` | `apps/api/src/server/routes.ts` | /preview/:id/:token/*path (apps/api-rs/src/http/mod.rs) |
| OK | POST | `/preview/:id/:token/access-requests` | `apps/api/src/server/routes.ts` | /preview/:id/:token/access-requests (apps/api-rs/src/http/mod.rs) |
| OK | GET | `/preview/:id/:token/access-requests/:requestId` | `apps/api/src/server/routes.ts` | /preview/:id/:token/access-requests/:requestId (apps/api-rs/src/http/mod.rs) |
| OK | POST | `/provider-proxy/:providerId/:proxyToken/v1/responses` | `apps/api/src/server/routes.ts` | /provider-proxy/:provider_id/:proxy_token/v1/responses (apps/api-rs/src/api/mod.rs) |
| OK | DELETE | `/webhooks/:routeKey` | `apps/api/src/webhooks/routes.ts` | /webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | GET | `/webhooks/:routeKey` | `apps/api/src/webhooks/routes.ts` | /webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | PATCH | `/webhooks/:routeKey` | `apps/api/src/webhooks/routes.ts` | /webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | POST | `/webhooks/:routeKey` | `apps/api/src/webhooks/routes.ts` | /webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |
| OK | PUT | `/webhooks/:routeKey` | `apps/api/src/webhooks/routes.ts` | /webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs)<br>/webhooks/:route_key (apps/api-rs/src/api/webhooks/mod.rs#inbound_router) |

## Rust extra routes (not direct TS route matches)

| Method | Rust path | Rust file |
|---:|---|---|
| GET | `/api/goals/:id/focuses` | `apps/api-rs/src/api/goals/mod.rs` |
| POST | `/api/app-notifications` | `apps/api-rs/src/api/app_notifications/mod.rs` |
| DELETE | `/api/approvals/:id` | `apps/api-rs/src/api/approvals/mod.rs` |
| POST | `/api/extensions/marketplace` | `apps/api-rs/src/api/extensions/mod.rs` |
| POST | `/api/providers/:id/proxy/responses` | `apps/api-rs/src/api/providers/mod.rs` |
| GET | `/api/projects/:id` | `apps/api-rs/src/api/projects/mod.rs` |
| POST | `/api/sessions/:id/messages` | `apps/api-rs/src/api/sessions/mod.rs` |
| GET | `/api/sessions/:id/queue` | `apps/api-rs/src/api/sessions/mod.rs` |
| POST | `/api/sessions/:id/queue` | `apps/api-rs/src/api/sessions/mod.rs` |
| PATCH | `/api/sessions/:id/queue` | `apps/api-rs/src/api/sessions/mod.rs` |
| PATCH | `/api/sessions/:id/queue/:queue_id` | `apps/api-rs/src/api/sessions/mod.rs` |
| DELETE | `/api/sessions/:id/queue/:queue_id` | `apps/api-rs/src/api/sessions/mod.rs` |
| GET | `/api/codex/tasks/runs` | `apps/api-rs/src/api/tasks/mod.rs` |
| POST | `/api/codex/tasks/runs/:run_id/finish` | `apps/api-rs/src/api/tasks/mod.rs` |
| GET | `/api/codex/tasks` | `apps/api-rs/src/api/tasks/mod.rs` |
| GET | `/api/terminal/ws` | `apps/api-rs/src/api/terminal/mod.rs` |
| GET | `/preview/:id/:token` | `apps/api-rs/src/http/mod.rs` |
| POST | `/preview/:id/:token` | `apps/api-rs/src/http/mod.rs` |
| PATCH | `/preview/:id/:token` | `apps/api-rs/src/http/mod.rs` |
| DELETE | `/preview/:id/:token` | `apps/api-rs/src/http/mod.rs` |
| PUT | `/preview/:id/:token` | `apps/api-rs/src/http/mod.rs` |
| POST | `/preview/:id/:token/*path` | `apps/api-rs/src/http/mod.rs` |
| PATCH | `/preview/:id/:token/*path` | `apps/api-rs/src/http/mod.rs` |
| DELETE | `/preview/:id/:token/*path` | `apps/api-rs/src/http/mod.rs` |
| PUT | `/preview/:id/:token/*path` | `apps/api-rs/src/http/mod.rs` |