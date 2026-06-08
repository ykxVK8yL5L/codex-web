# api-rs 重构进度（TS apps/api → Rust apps/api-rs）

> 由 AI 协作维护。源真值：`apps/api/src/`（Hono）。目标：`apps/api-rs/src/`（axum）。
> 每完成一块跑 `cargo check` 验证。

## ✅ 已完成（本轮）
- **auth**: `POST /access-token`、`POST /otp/reset`、`POST /otp/reset/confirm`
  - state.rs 增加 pending_reset_otp_secret；models 增加 UpdateAccessTokenRequest / ConfirmOtpResetRequest / ResetOtpResponse
- **storage**: `POST /storage/delete`、`POST /storage/delete-batch`（storage.rs::delete_item，含 active/force、allowed roots、preview-log SQL 删除、孤儿 room-agent 级联）
- **terminal**: `POST /terminal/exec`（runtime::run_command，zsh -lc + 30s 超时 + 64KB 截断）
- **projects**: `GET /:id/sessions`（过滤+游标分页）、`GET /:id/stats`

## 🔜 待办（按优先级）
### 小项（独立、低风险）— 已清空大半
- [ ] notifications: `GET /platforms`、ephemeral-rules 写接口、retry_delivery 实装
- [ ] settings/approvals: task-health(+repair)、codex-runtime(GET/PATCH)、maintenance/cleanup、approvals reset/approve、approval-grants
- [ ] environment: mise/install、tool-versions、tools install/uninstall、packages install/delete、bulk、restore-runs 删除
- [ ] sessions/tasks: activity、diff、changes(+revert/stage/unstage)、execution-contexts、compaction 全套、cards
- [ ] app-notifications SSE、previews log SSE

### 大块
- [ ] **agents** 写接口（roles/agents/groups/circles 增删改 + sessions/stats）
- [ ] **goals** 写接口 + plan/orchestrate
- [ ] **rooms** 写接口 + 多智能体编排运行时（tasks/runs merge/调度/handoff/decisions/artifacts）
- [ ] **webhooks** 整个模块（CRUD + 入站派发）
- [ ] **消息平台投递**（email + 微信/企微/钉钉/飞书/QQ；目前仅 telegram + 通用 webhook）
- [ ] **SSE 事件流**（tasks events、rooms events stream）
- [ ] 顶层 preview access-requests + referer 回退代理

## 约定
- 路由风格见 `src/api/automations/mod.rs`；错误用 `json_error(StatusCode, "code")`。
- 错误码字符串与 TS 版保持一致。

### notifications (子任务)
- `GET /api/notifications/platforms` — 端口自 TS `platformOverview`（platforms.ts）：返回 baselineCapabilities / capabilityLabels / platforms / routes / webhookRoutes，从 `*_chat_routes` 与 `webhook_routes` 表聚合，host 来自 `state.config.host`。
- `POST /api/notifications/ephemeral-rules`、`PATCH /api/notifications/ephemeral-rules/:id`、`DELETE /api/notifications/ephemeral-rules/:id` — 新增写入处理器 + `store::{create,update,delete}_ephemeral_rule`，含 automation 范围 upsert 逻辑与 target 清洗；错误码 `invalid_notification_ephemeral_rule` / `notification_ephemeral_rule_not_found`。
- weixin QR 路由全部注册：`POST /accounts/:id/weixin/qr/start`、`POST /weixin/qr/start`、`GET /accounts/:id/weixin/qr/status`、`GET /weixin/qr/status`。账号校验 + 返回忠实响应形状（错误码 `notification_account_not_found` / `weixin_qr_session_not_found`）。
  - 限制：未实现实时微信扫码轮询（无外部 WeChat API 调用 / 无 QR 会话存储），start 返回 `status:"pending"`，status 始终返回 `weixin_qr_session_not_found`。标注 `// TODO: live weixin QR polling`。
- `POST /api/notifications/deliveries/:id/retry` — 实现 `runtime::retry_delivery`：按 metadata.target / recipient 解析目标，复用 `deliver_to_recipient` / `deliver_to_account` 重新投递并写入新 delivery 行，镜像 service.ts retry 逻辑。错误码 `notification_delivery_not_found` / `notification_recipient_not_found` / `notification_account_not_found`(404)、`notification_delivery_target_missing`(400)。
- `cargo check` 通过（无错误、无新增警告）。

### settings/approvals/environment (子任务)
- settings 维护/运行时路由：
  - `POST /api/settings/maintenance/cleanup` — `maintenance::cleanup`，忠实执行 SQL 级孤儿清理（messages/preview_logs/message_queue/task_activities/project_check_runs/automation_runs/closed terminal_sessions/archived approvals/approval audit log）。TODO：detachedSessions / orphanAgentSessions / orphanRoomRecords / previews / providerHealthChecks 依赖尚未移植的内存 appData 与 preview 进程注册表，对应计数返回 0。
  - `GET /api/settings/task-health`、`POST /api/settings/task-health/repair` — `maintenance::list_task_health` / `repair_task_health`，基于 `task_runs` running 行 + `kill -0` 存活检测；TODO：runnerRunning/runnerExitCode/childPid/logBytes 来自尚未移植的 task meta 与会话注册表，repair 仅处理 `runner_pid_missing`。
  - `POST /api/settings/approvals/reset` — `maintenance::reset_approval_grants`，删除全部 `approval_grants`，返回 `{ ok, deletedGrants }`。
  - `GET /api/settings/codex-runtime`、`PATCH /api/settings/codex-runtime` — `store::{codex_runtime, merge_codex_runtime, save_codex_runtime, codex_runtime_risk}`，含 sandboxMode/approvalPolicy 白名单 sanitize + 环境变量默认值。风险变更返回 409 `approval_required`（合成 approval 摘要）。TODO：approvalAlwaysAllowed 授权短路与 createApproval 持久化未移植。
- approvals：
  - `POST /api/approvals/:id/approve` — `store::approve`，resolve 为 approved；codex-runtime-update 时应用 payload；`always`/`expiresIn` 时 `save_grant`（含 stableJson grant_key）。响应 `{ approval, codexRuntime }`。TODO：preview-command-run / preview-access / project-delete-files / room-run-merge / project-git-operation 副作用未移植。
  - `GET /api/approval-grants`、`DELETE /api/approval-grants/:id` — 新增 `approvals::grants_router`，挂载于 `/api/approval-grants`（api/mod.rs），并在 guard.rs 增补权限映射（GET→approvals.read，其余→approvals.decide）。错误码 `approval_grant_not_found`(404)。
- environment（settings/environment.rs，注册于 /environment/...）：
  - `POST /environment/mise/install`（`install_mise`，curl https://mise.run）；`GET /environment/tool-versions`（`list_tool_versions`，`mise ls-remote` + recommend 子集）。
  - `POST /environment/tools/install`（`install_tool`，`mise use -g`，201）；`DELETE /environment/tools/:id/uninstall`（`uninstall_tool`，`mise uninstall`，仅 source=mise）。
  - `GET /environment/tools/:id/packages`（`tool_packages`，返回持久化包+manager 选项）；`GET /environment/tools/:id/packages/probe`（`inspect_package`）。TODO：scanEnvironmentPackages 逐生态探测未移植；inspect 暂返回 not-installed。
  - `POST /environment/bulk`（`bulk_action`：cleanup_stale_records 忠实；record_detected_packages/install_missing_packages 部分依赖包扫描，install_missing 对持久 missing 记录执行 mise exec 安装）。
  - `POST /environment/packages/install`（`install_package`，201）、`DELETE /environment/packages/:id`（`uninstall_package`），命令构造镜像 packages.ts（pip/uv/pnpm/npm/bun/cargo/gem/composer/go-install）。
  - `DELETE /environment/restore-runs/:id`、`DELETE /environment/restore-runs`（`delete_restore_run` / `clear_restore_runs`）。
  - 失败的 shell-out 操作镜像 TS 错误形状 `{ error, detail?, overview }`（400）。
- `cargo check` 通过（无错误、无新增警告）。

### sessions/tasks (子任务)

补齐 TS（apps/api/src/tasks、apps/api/src/sessions、apps/api/src/agents）缺失路由，Rust 实现位于 `src/api/tasks/`、`src/api/sessions/`、`src/api/execution_contexts.rs`。

- 任务活动/差异/变更/事件（`src/api/tasks/`，挂载于 `/api/codex/tasks`）：
  - `GET /api/codex/tasks/:id/activity`（`activity.rs`）：移植 activity-parser.ts（command/file/tool 解析、`activity_label` 中文文案、`shorten_detail` 180 字符截断、状态推断、`patch rejected`/`writing is blocked` 文本兜底），无活动时从任务日志尾部 512KiB backfill 到 `task_activities` 表（含 `ensure_schema` 与 `session+kind+activity_id` 唯一索引 upsert）。返回 `{ sessionId, items, nextCursor, hasMore }`，游标用 base64(`updated_at\nid`)。
  - `GET /api/codex/tasks/:id/diff`（`diff.rs`）：`git status --short` / `diff --relative --stat` / `diff`，返回 `CodexTaskDiff { ok, cwd, status, stat, diff, error? }`，错误码 `git_status_failed`/`git_diff_failed`。
  - `GET /api/codex/tasks/:id/changes`、`POST .../changes/{revert-file,stage-file,unstage-file}`：复用 `crate::api::projects::changes`（已将其改为 `pub(crate)`），传入 session.workspace_path；缺 path 返回 `path_required`。
  - `GET /api/codex/tasks/:id/events`（`events.rs`，SSE）：使用 `axum::response::sse::{Sse,Event}` + `async_stream`。**轮询实现**（每 1s）：先发 `started`，日志增长时解析新行成 `activity` 事件并发 `output { bytes, at }`，状态变更映射 `done { exitCode }`/`error { error }`，事件负载对齐 events.ts。`// TODO: switch to broadcast when task runtime emits events` —— TaskRuntimeState 目前无事件广播通道。
- 会话压缩（`src/api/sessions/compaction.rs`，挂载于 `/api/sessions`）：移植 compaction.ts。新增 `session_compactions` 表 `ensure_schema`。
  - `GET /:id/compaction`（latest + 摘要文件内容，无则 `{compaction:null,summary:""}`）、`GET /:id/compactions`、`PATCH /:id/compaction`（`update_latest`，错误 `session_compaction_not_found`/`summary_required`）、`POST /:id/compactions/:compactionId/restore`（`session_compaction_not_found`/`summary_missing`）、`POST /:id/compact`（`create`：选 provider/model、构造与 TS 一致的 prompt、调用 openai-compatible-chat `/chat/completions` 或 responses `/responses`，错误 `no_messages_to_compact`/`provider_required`/`model_required`/`provider_compaction_unsupported`/`api_key_missing`/`base_url_required`/`empty_compaction_summary`）。摘要写入 `sessions/<id>/memory/<id>.md` 与 `latest-summary.md`。
  - 注：`/compact` 仅实现全量压缩路径（与路由直连一致）；自动增量压缩（scheduleSessionAutoCompaction/incremental）未移植（运行时后台逻辑，非路由）。
- 会话卡片（`src/api/sessions/cards.rs`）：
  - `GET /:id/cards`：合并 preview 卡片（来自 previews store，scope=session）与 `message_cards` 表卡片，过滤 service 卡指向存活 preview 的项，按 `message_card_dismissals` 抑制键（`url:`、`preview:`）过滤，按 createdAt/id 降序。
  - `DELETE /:id/cards/:cardId`：`preview:` 前缀走 preview 校验+dismiss+删 previews+清理引用该 previewId 的 message_cards；否则按 message_cards 行 dismiss + 删除；缺失返回 `card_not_found`。
- 执行上下文（`src/api/execution_contexts.rs`，新顶层路由 `/api/execution-contexts`，已在 api/mod.rs 挂载；guard 已覆盖该路径 → sessions.*）：
  - `GET /api/execution-contexts?sessionId&agentId&limit`：移植 execution-contexts.ts 的 `executionContextFromRow` + routes.ts 查询（room 会话解析 roomId 参与匹配），`resolvedPermissions` 解析为 JSON，`permissionProfileId` 仅在已知 profile 时透出。

限制/TODO：
- SSE 为轮询实现（见上 TODO），无真实事件总线。
- 自动增量压缩调度未移植（仅路由触发的全量压缩）。
- 卡片抑制键仅实现 `url`/`previewId`/preview `id`（覆盖路由所需场景）；未移植 runtime.ts 中 URL 卡的自动 backfill（ensureSessionUrlCards 为运行时副作用）。
- room 会话的活动 backfill（backfillRoomActivitiesFromAgentLogs）未移植，仅实现任务日志 backfill。

`cargo check` 通过（无错误、无警告）。

### agents (子任务)

移植 TS `apps/api/src/agents/*` 的全部写入路由到 Rust（之前 agents 模块仅有只读 GET）。所有路由挂载在 `/api` 下（相对路径），错误码字符串与 TS 完全一致。

新增路由：
- `GET /api/agent-role-templates`：从角色模板目录（`CODEX_WEB_ROLE_TEMPLATE_DIR` 或 `data_dir/../role-templates`）递归读取 `.md` 文件，解析 frontmatter，支持 `agency-agents` 的 `zh-CN` 本地化白名单（`scripts/i18n/agent-names-zh.json`），按 group/name 排序，输出 `publicAgentRoleTemplate`（不含 markdownContent）。
- `POST /api/agent-roles`、`POST /api/agent-roles/from-template`、`POST /api/agent-roles/import-file`、`PATCH /api/agent-roles/:id`、`DELETE /api/agent-roles/:id`（删除时 `agent_role_in_use` -> 409）。
- `POST /api/agents`、`POST /api/agents/batch`、`PATCH /api/agents/:id`、`DELETE /api/agents/:id`。
- `GET /api/agents/:id/sessions`、`GET /api/agents/:id/stats`、`POST /api/agents/:id/sessions`（直连会话，conversation_type=agent，status=paused，写 agent_sessions 关联，工作区按项目/scratch 解析）。
- `POST /api/agent-groups`、`PATCH /api/agent-groups/:id`、`DELETE /api/agent-groups/:id`、`GET /api/agent-groups/:id/rooms`。
- `POST /api/agent-circles`、`PATCH /api/agent-circles/:id`、`DELETE /api/agent-circles/:id`（builtin 锁定 -> 409 `builtin_circle_locked`）、`POST /api/agent-circles/:id/groups`（从 circle 生成 group，含 ensureAgentForRole）、`GET /api/agent-circles/:id/rooms`。

实现要点：
- 新增 `role_templates.rs`：frontmatter 解析、markdownTitle/Description、systemPromptWithRoleDescription、slugify-id。
- `store.rs` 新增全部写入函数 + `ensure_schema`（create table if not exists，覆盖 agent_roles/agents/agent_groups/agent_group_members/agent_circles/agent_circle_roles/agent_sessions）。
- 权限：移植 `defaultAgentPermissions` 与 `agentPermissions` 合并逻辑、permissionProfileId/listenMode/workspaceMode/projectAccessMode/roleSourceType 归一化。
- 项目访问：normalizeProjectIds / agentCanAccessProject / resolveAgentProject 直接查 projects 表实现。
- `models.rs` 新增所有请求体（Create/Update 角色/Agent/Group/Circle、Batch、Session）与 `AgentStats`、`AgentRoleTemplateSummary`。
- 复用 `crate::api::sessions::models::SessionSummary`（会话/房间列表与直连会话返回）。

限制 / TODO：
- 分页：列表与 rooms/sessions 仅返回 `hasMore`（`nextCursor` 仍为 None），未实现游标编码（与现有 agents 只读列表保持一致）；TS 使用 cursor/offset 分页。
- `import-file` 的路径解析用简化版 `resolveTerminalCwd`（~ 展开 + cwd 相对路径），未接入 TS 的 terminalRoot 沙箱根。
- `agent_stats` 的耗时统计自行解析 RFC3339（`time` crate 未启用 `parsing` feature，故内置最小解析器）。
- 现有 `GET /api/permission-profiles` 的只读实现保持原样（与 TS 的 profile 列表形状略有差异，未在本子任务改动）。

`cargo check` 通过（无错误、无警告）。

### goals (子任务)

Ported all missing goals write routes from `apps/api/src/goals/{routes,index}.ts` into
`apps/api-rs/src/api/goals/{mod,store,models}.rs`. The module was previously read-only.

Routes added (all mounted under `/api/goals`):
- `POST /api/goals` — create goal (agents are 403 `goal_agent_must_propose`; `*_not_found` → 404, else 400).
- `PATCH /api/goals/:id` — update goal (manage check).
- `DELETE /api/goals/:id` — soft cancel via `updateGoal({status:"cancelled"})`.
- `POST /api/goals/:id/focuses` — create focus (completes prior active/paused focus).
- `PATCH /api/goals/:id/focuses/:focusId` — update focus.
- `POST /api/goals/:id/items` — create item.
- `PATCH /api/goals/:id/items/:itemId` — update item (assignee-or-manager auth; auto replan
  proposal on blocked/failed transition).
- `DELETE /api/goals/:id/items/:itemId` — soft cancel item.
- `POST /api/goals/:id/proposals` — create proposal (agents allowed; no manage check).
- `POST /api/goals/:id/proposals/:proposalId/approve` — apply proposal (goal_update/focus/item/plan kinds).
- `POST /api/goals/:id/proposals/:proposalId/reject`.
- `POST /api/goals/:id/plan` — deterministic 4-step default plan (createDefaultGoalPlan).
- `POST /api/goals/:id/orchestrate` — owner-must-be-room; creates `room_tasks`, links goal items
  (status→active, roomTaskId set), records `goal.task.created` room events + `goal.orchestrated` goal event.

Conventions followed:
- Actor resolution mirrors `goalActorFromRequest` (x-codex-agent-id / x-agent-id headers, then body
  `actorAgentId` / `proposedByAgentId`; unknown agent → `agent_actor_not_found`).
- Authorization mirrors `assertCanManageGoal` / `assertCanUpdateGoalItem` /
  `canAgentManageGoal` (manager/coordinator, room orchestrator listen_mode, PM/product role-or-name).
- Error code strings match TS exactly; per-route status mapping (403/404/400) mirrors routes.ts.
- Bodies parsed from raw `Bytes` so malformed JSON returns the TS-specific `invalid_*` code (400)
  instead of an axum rejection. PATCH fields use a double-Option deserializer to distinguish
  absent vs explicit-null (mirrors `input.x !== undefined`).
- Timestamps via `crate::api::common::timestamp()`; ids via random hex (`goal-`, `goal-item-`, etc.).
- New `ensure_schema` in goals/store.rs creates the goal* tables (matches index.ts DDL).
- Made `api::rooms::models` public to reuse `RoomTaskSummary` for the orchestrate response.

TODOs / limitations:
- `// TODO: full plan/orchestrate runtime` — the room-orchestration engine (`orchestrateRoom`,
  auto review/listen task creation, agent-run scheduling) is NOT yet ported to Rust. The orchestrate
  route faithfully performs all DB writes (room_tasks, goal item links, goal/room events) so the API
  surface + persisted state match, but the live orchestration loop is not triggered.
- The TS `/plan` endpoint is template-based (no LLM/provider call), so the Rust port is faithful and
  does not need the reqwest provider-call pattern.

`cargo check` passes (no goals-related warnings).

### rooms (子任务)

Ported the room write surface (`apps/api/src/rooms/routes.ts` + `records.ts` + `runtime.ts`) into
`apps/api-rs/src/api/rooms/{mod.rs,store.rs,models.rs}`. The module was previously read-only; all
write routes below are now implemented with faithful DB persistence, request/response shapes and
error codes (mounted at `/api/rooms`; guard.rs mapping unchanged).

Routes added:
- `POST /api/rooms` (create; validates name/group/circle, seeds room_agents from group members,
  emits `room.created`; persists generated session_id). Errors: `invalid_room`,
  `agent_group_not_found`, `agent_circle_not_found`.
- `PATCH /api/rooms/:id` (name/status/sharedContext/orchestration; double-Option for sharedContext;
  `roomOrchestrationSettings` clamping mirrored). Error: `room_not_found`.
- `POST /api/rooms/:id/agents`, `PATCH /api/rooms/:id/agents/:agentId` (upsert/update listen_mode,
  return members list, 201 on add). Errors: `room_not_found`, `agent_not_found`, `room_agent_not_found`.
- `GET/POST /api/rooms/:id/artifacts` (create validates title+kind + room membership of agent).
  Errors: `invalid_room_artifact`, `agent_not_in_room`.
- `GET/POST /api/rooms/:id/decisions`, `PATCH .../decisions/:decisionId` (status enum + resolvedAt
  rules, double-Option payload). Errors: `invalid_room_decision`, `decision_not_found`.
- `GET/POST /api/rooms/:id/handoffs`, `PATCH .../handoffs/:handoffId` (status helper, resolvedAt,
  double-Option from/to/payload). Errors: `invalid_room_handoff`, `handoff_not_found`.
- `POST /api/rooms/:id/tasks` (validate title+prompt + membership; queued/assigned),
  `POST .../tasks/retry-failed`, `PATCH .../tasks/:taskId` (running-guard 409, dependency/membership
  checks, nextStatus precedence), `POST .../tasks/:taskId/cancel`, `.../retry`,
  `DELETE .../tasks/:taskId`. Errors: `invalid_room_task`, `agent_not_in_room`,
  `room_task_not_found`, `room_task_running` (409), `dependency_not_found`, `room_task_unassigned`,
  `invalid_room_task_update`.
- `GET /api/rooms/:id/runs/:runId/diff` (reuses git `status --short` / `diff --stat` / `diff --`,
  workspace existence check). Errors: `agent_run_not_found`, `workspace_not_found`.
- `POST /api/rooms/:id/runs/:runId/reject` (writes room_run_merges `rejected`, `audit.operation`).
- `GET/POST /api/rooms/:id/schedules`, `DELETE .../schedules/:scheduleId` (validate agent+prompt+
  membership, schedule_type enum). Errors: `invalid_room_schedule`, `agent_not_in_room`,
  `room_schedule_not_found`.
- Added `ensure_schema` in rooms/store.rs creating rooms, room_agents, room_events, room_tasks,
  room_schedules, room_artifacts, room_handoffs, room_decisions, agent_runs, room_run_merges
  (matches index.ts DDL exactly).

Conventions: errors via local `json_error`/`RoomError` (status+code, strings match TS exactly);
double-Option deserializer for PATCH absent-vs-null; ids via uuid-shaped random hex
(`room-`, `room-task-`, `artifact-`, `decision-`, `handoff-`, `room-schedule-`, `room-event-`);
timestamps via `crate::api::common::timestamp()`; rusqlite write patterns mirror automations/store.rs;
`AgentRunSummary` made `Clone` for merge/reject responses.

TODOs / limitations (live orchestration engine not ported):
- `POST /api/rooms/:id/tasks/:taskId/start` — returns 501 `room_task_start_unavailable` after
  validating room+task existence. `// TODO: live agent-run runtime` — porting `startRoomTaskRun()`
  (agent/role/membership/concurrency validation, agent_runs row + session creation, workspace+prompt
  build, `startCodexTask()`) requires the session subsystem + codex process orchestration engine.
- `POST /api/rooms/:id/messages` — returns 501 `room_message_unavailable` after room existence
  check. `// TODO: live room messaging runtime` — porting message persistence + attachments +
  mention/auto-listen task creation + `startRoomTaskRun()` + `orchestrateRoom()` depends on the
  unported session + orchestration engine.
- `POST /api/rooms/:id/runs/:runId/merge` — returns 501 `room_run_merge_unavailable` after run
  existence check (404 contract preserved). `// TODO: live merge runtime` — porting
  `applyRoomRunMerge()`/`createRoomRunMergeApproval()` needs group merge-strategy/agent-permission
  approval gating, project check-command gates and `git apply` to the bound project worktree.
- `create_room`: `// TODO: live agent-circle runtime` — when a circle has no `group_template_id`,
  TS calls `createAgentGroupFromCircle()`; that helper isn't ported (group_id stays null). Also
  `// TODO: live session/goal runtime` — the paused SessionSummary + optional `createGoal()` are
  not created (session_id is still generated + persisted for shape).
- Task status transitions (`update`/`cancel`/`retry`/`retry-failed`): `// TODO: live goal runtime`
  for linked goal_item propagation, and `// TODO: live orchestration runtime` for `orchestrateRoom()`.
- `cancel_task`: `// TODO: live agent-run runtime` — running codex child process is not killed; the
  task is flipped to `cancelled` and events recorded.
- `create_schedule`: `// TODO: live schedule runtime` — the scheduled execution loop is not ported.

`cargo check` passes (warnings only: unused fields on the create/message request structs whose
runtime-only consumers are TODO'd above).

### webhooks (子任务)

Ported `apps/api/src/webhooks/{routes,index}.ts` into `src/api/webhooks/{mod,store,models}.rs`.

Routes added:
- Management (authenticated, nested under `/api` via `webhooks::router()`):
  - `GET /api/webhook-routes` — list routes (projected via `webhookRouteFromRow` equivalent, incl. `curlExample`, `sessionTitle`).
  - `POST /api/webhook-routes` — create; slugifies routeKey, appends 8-hex suffix, normalizes/generates `whsec_` secret, default command template. 201.
  - `PATCH /api/webhook-routes/:id` — update (404 `webhook_route_not_found`).
  - `DELETE /api/webhook-routes/:id` — delete (404 `webhook_route_not_found`), returns `{ ok: true }`.
- Inbound dispatch (PUBLIC, mounted on top-level router in `src/http/mod.rs`, outside the auth guard) via `webhooks::inbound_router()`:
  - `ALL /api/webhook/:routeKey` and `ALL /webhooks/:routeKey` (GET/POST/PUT/PATCH/DELETE).
  - Lookup by route_key (404), disabled check (403 `webhook_route_disabled`), 1MiB cap (413 `webhook_payload_too_large`), per-route token validation (401 `invalid_signature`).
  - Commands: help (default), sessions, agents, rooms, bind, unbind, send — mirroring TS shapes & error codes (`webhook_session_id_required`, `session_not_found`, `webhook_message_required`, `unsupported_webhook_command`).

Auth posture (mirrors TS exactly):
- Inbound dispatch is PUBLIC at the HTTP layer — authentication is per-route via the route secret (`X-Webhook-Token` / `Authorization: Bearer` / `?token=`; `INSECURE_NO_AUTH` only on loopback hosts). Registered on the top-level router (outside `require_api_auth`); also added a `/api/webhook/` prefix allow in `guard.rs::is_public_api_route` for safety.
- `/api/webhook-routes` management has NO entry in TS `routePermissionForRequest`, so API keys cannot reach it (session-only). Mirrored by intentionally NOT adding a `route_permission_for_request` mapping (guard returns `forbidden` for API keys) — documented in `guard.rs`.

Schema: `ensure_schema` creates `webhook_routes` (matches TS index.ts DDL) + `webhook_routes_updated_idx`. Write pattern follows automations store (open_read_write + ensure_schema + upsert).

Helpers implemented locally to avoid new deps: slugify, base64url, uuid_v4, hex/url-decode, secret normalization/safety, payload parsing (json / x-www-form-urlencoded / raw `{ body }`).

TODOs / limitations:
- `send` command: `dispatchMessageToSession` enqueues/starts a codex run via the orchestration engine which is not yet ported. DB lookups + 202 ack shape are implemented; actual run dispatch is marked `// TODO: trigger run` and returns `dispatch: { mode: "queued" }`.

Integration edits: `api/mod.rs` (`pub mod webhooks;` + `.nest("/api", webhooks::router())`), `http/mod.rs` (`.merge(api::webhooks::inbound_router())`), `auth/guard.rs` (public prefix + comment), made `agents::store` and `rooms::store` `pub` for summary reuse.

`cargo check` passes (only pre-existing warnings in rooms/models.rs).

### platform delivery (手动补完，子任务曾中断)
- email(SMTP via lettre)、dingtalk(签名webhook)、feishu(tenant token+im/v1)、qq(token+messages)、weixin(ilink/bot/sendmessage) 全部实装
- wecom 需 WS 运行时 → 忠实返回 wecom_websocket_not_connected（有 url 时走 webhook）；新增 Cargo 依赖 lettre

### SSE + preview access-requests (子任务)
SSE 端点全部用轮询实现（1s interval + axum KeepAlive 心跳），无事件总线。
- `GET /api/app-notifications/events` (app_notifications/events.rs)：发首个 `snapshot`(latest 30, {type, items, unreadCount})，之后轮询 app_notifications 表，内容变化时重发 `snapshot`。镜像 notifications/app-routes.ts。
- `GET /api/rooms/:id/events/stream` (rooms/events.rs)：发首个 `snapshot`({type, room, tasks, runs, events, messages})，之后变化时发 `activity`({type, roomId, ...})。镜像 server/routes.ts + rooms/index.ts(roomActivitySnapshot)。`messages` 需 session 子系统 → 输出空数组。房间不存在返回 404 room_not_found。
- `GET /api/previews/:id/logs/events` (previews/events.rs)：发 `snapshot`({type, preview, logs})，日志增长发 `log`({type, previewId, chunk, at})，状态变化发 `status`({type, preview})。镜像 previews/routes.ts + previews/events.ts。preview 不存在返回 404 preview_not_found。
- 这三处均加了 `// TODO: switch to broadcast when an event bus exists`。SSE 路径都在已守护的 `/api` 前缀下（GET→*.read），未改 guard。

顶层 preview access-request（http/mod.rs，在 `/api` 鉴权守护之外，镜像 server/routes.ts + previews/access.ts）：
- `POST /preview/:id/:token/access-requests`：校验 token；非 private 返回 400 preview_is_public；复用/新建 pending 请求；返回 202 `{status:"pending", id, secret, reused}`。
- `GET /preview/:id/:token/access-requests/:requestId`：先 expire；校验 token+secret；返回 `{status, approvedUntil, url}`；approved 时下发 `codex_preview_<id>` cookie。
- 新增 previews/store.rs 访问请求辅助：`PreviewAccessRequest`、`expire_access_requests`、`create_access_request`、`get_access_request`（复用既有 preview_access_requests 表）。
- TODO：`createApproval({actionType:"preview-access"})` 未持久化（approvals store 无通用 create()）；签名 preview-access token/cookie 校验未做（代理仍只认 Bearer，cookie 仅信息性）；`app.all("*")` 基于 Referer 的代理 fallback 未移植（已加 `// TODO: referer-based preview proxy fallback` 注释，保留 static_handler fallback 不破坏）。

`cargo check` 通过（仅 warnings：access-request 结构体与既有 rooms/models 的未读字段）。

### room run engine (子任务)

把两个 501 stub 换成真实实现，复用既有 codex runner，不复制 spawn 逻辑。

实现内容：
- `POST /api/rooms/:id/tasks/:taskId/start` → 端口 `startRoomTaskRun`（`store::start_room_task`）：
  - 全量校验 + 精确错误码：`room_not_found`、`room_task_not_found`、`room_task_not_startable`、`room_task_dependency_pending`、`room_task_unassigned`、`room_agent_not_member`、`agent_not_found`、`agent_disabled`、`room_concurrency_limit`（group.max_concurrent_agents）、`agent_concurrency_limit`（agent.max_concurrent_runs）、`agent_role_not_found`。
  - `ensure_room_run_workspace`：`data_dir/rooms/<roomId>/{shared, agents/<agentId>}`；隔离 agent 工作区会 `git init`；若房间绑定了 git 顶层项目且 workspace_mode 非 shared-write/merge-workspace，则 `git worktree add -B codex-room/... HEAD` 建立独立 worktree 作为 cwd。
  - 插入 `agent_runs`(status='running')、`room_tasks`→running、`set_room_parent_session_status`→running、发 `agent.started` room 事件。
  - 直接 insert 一个 `task-<uuid>` 的 agent 会话（conversation_type='agent'，绑定 room、workspace_path、codex_session_id 复用现有线程）。
  - prompt 按 TS 顺序拼接：role.systemPrompt + agent.extraPrompt + groupContextForRoom + room.shared_context + recentRoomContext + skippedThreadReason + workspaceContext + Task。
  - handler 追加 user message（task.prompt），再经 `runner::start_room_run` 启动 codex（复用 `start_runner` + `select_provider`/`select_model`）。返回 `{ run, session }`。
- `POST /api/rooms/:id/runs/:runId/merge` → 端口 `applyRoomRunMerge`（`store::apply_run_merge`）：
  - 取 worktree `git diff`；空 diff/缺 workspace → `empty_diff`/`workspace_not_found`。
  - `git apply --check` 失败 → 写 room_run_merges status='conflict' + audit 事件，返回 `{ok:false, message}`。
  - project check-command 闸门：逐条 `/bin/zsh -lc <cmd>`，30s wall-clock 超时（线程 + recv_timeout，超时用 `kill` 兜底），失败→开 room_decision + audit 事件，返回 `project_check_failed_before_merge`。
  - `git apply -` 应用 patch，写 room_run_merges(merged/error) + audit 事件 + room_decision，返回 `{ run, ok, message }`。错误码 `agent_run_not_found`、`room_project_not_found` 对齐 TS。
- runner 集成点：新增 `pub async fn start_room_run(...)` 薄封装，内部调私有 `start_runner`；在 `start_runner` 完成回调里加 `rooms::store::finish_agent_run_for_session`（端口 finishAgentRun 子集：关 agent_runs、传播 room_tasks 状态、无活动 run 时房间父会话置 paused），对非 room 会话为 no-op。

简化 / TODO：
- `// TODO: full git-worktree parity`：工作区根用稳定的 `data_dir/rooms/<roomId>`，未移植 TS 的「挂到房间父会话 data 目录 + 旧路径迁移」逻辑。
- 检查闸门超时用线程 + `kill` 命令兜底（未引入 libc/wait_timeout 依赖）；未持久化 project check_runs（TS saveProjectCheckRun 那张表未在 rs 侧落库），状态用 failed/timed_out 直接判定。
- 未移植 finishAgentRun 的下游副作用：assistant 消息回灌房间父会话、createRoomRunMergeCandidate 候选、orchestrateRoom、goal_item 状态传播（这些依赖尚未移植的编排/目标运行时）。
- merge 未实现 group merge-strategy / agent 权限审批闸门（TS 的 approval gating），按任务说明聚焦 check-command 闸门 + git apply。

`cargo check` 通过（仅既有无关 warnings：previews/rooms models 未读字段）。

### room orchestrate + messages (子任务)

实现了房间编排调度器与房间消息分发，替换了 rooms 里最后一个 501 桩，使 goals/orchestrate 真正驱动工作。

**新增/改动：**
- `rooms/store.rs`：
  - `create_room_message()`：移植 POST /messages —— 把用户消息落到房间父会话（appendSessionMessage 逻辑，写 messages 表并更新 sessions/rooms.session_id），解析 @mention（`mentioned_room_agents` / `mentions_room_user`），为被点名/自动监听 agent 创建 room_tasks，记录 `user.message` + `agent.mentioned` 事件，返回 `RoomMessageOutcome`。
  - `orchestrate_room(db, room_id, reason)`：移植 orchestrateRoom —— autoCreateReviewTasks（`create_auto_review_task` + `find_room_reviewer` + `has_review_task`）、autoListenAfterAgentEvents（`create_listen_tasks_for_room_event` + `room_task_auto_listen_depth` 链深限制）、`task.created` 未分配任务的监听 fan-out、`notifyUserOnFailure`，再调 `start_eligible_room_tasks`。返回 `OrchestrateResult { tasks, launches }`。
  - `start_eligible_room_tasks()`：移植 startEligibleRoomTasks —— 扫描 pending（assigned/queued/failed 且已分配）任务，尊重依赖（depends_on 必须 done）、并发上限（group.max_concurrent_agents + 本地计数），逐个调用既有 `start_room_task` 收集 `RoomRunLaunch`，记录 `orchestrator.decision` start-task/start-task-failed 事件（concurrency/dependency 错误静默，与 TS 一致）。
  - 辅助：`room_agents_with_listen_modes`（room_agents→group→passive 回退）、`insert_room_task`、`message_mentions_user`（公开）。
- `rooms/mod.rs`：
  - `create_message` 改为完整实现（201 + `{event,message,session,tasks,runs}`），消费了 `CreateRoomMessageRequest` 全部字段（content/sessionId/replyToMessageId/attachments），清除该结构体未读字段 warning。
  - 新增 async `orchestrate_and_launch()` / 公开 `orchestrate_room_runtime()`：跑 `store::orchestrate_room` 后对每个 launch 走既有 runner（`append` 用户消息 + `start_room_run`，fire-and-forget）。
  - 在 `create_task`(task.created)、`update_task`(task.updated)、`retry_task`/`retry_failed_tasks`(task.retry) 后接编排，与 TS 调用点一致。
- `goals/mod.rs`：`orchestrate` 在 `store::orchestrate_goal` 创建任务后，调用 `rooms::orchestrate_room_runtime(owner_id, "goal.orchestrated")` 真正启动房间编排。

**简化 / TODO：**
- 附件：未移植 saveSessionAttachments 上传/链接重写（api-rs 暂无附件存储）；attachments JSON 原样透传，content==promptContent。已在 `create_room_message` 标注 TODO。
- `finish_agent_run_for_session`（agent 完成/失败的下游 orchestrateRoom 回调）仍为 TODO：该收尾逻辑是 sync、运行在 runner 终结路径，缺少 AppState/异步 runner，且为避免无限循环未在此处接编排——agent 完成后的 auto-review/auto-listen/续跑暂不会自动触发（需后续把 runner 终结改造成可异步回调 AppState）。
- 编排不会自递归：store 内的任务插入不再调用编排，仅 handler 调用一次；start_room_task 不调编排，故无循环。

`cargo check` 通过（仅既有无关 warnings：previews/store.rs 与 rooms/models.rs `CreateRoomRequest` 的 orchestration/goal 未读字段，均非本子任务范围）。

### room run engine 收尾 (#1 链式编排钩子)
- finish_agent_run_for_session 返回 room_id；runner 完成回调里 agent run 跑完后用独立线程(current-thread rt)触发 orchestrate_room_runtime("agent.finished")，形成多智能体闭环（依赖/并发/pending 校验防止死循环）
- 清理无害告警（rooms CreateRoomRequest、previews PreviewAccessRequest 标 allow(dead_code)）
- 至此 rooms 3 个 501 全部消灭，编排引擎核心贯通

## 剩余（长尾，外部依赖/重运行时）
- 长连接运行时：wecom WS bot、微信 QR 实时轮询、各 IM 平台入站接收循环（telegram/feishu/qq/wecom/weixin 的 bot 收消息）
- SSE 轮询 → broadcast 事件总线
- 内存运行态字段回填：settings cleanup 计数、task-health runner 元信息
- referer 回退代理（app.all("*")）
- 房间创建时 goal/orchestration 种子；email/qq 等入站 IMAP/网关

### bugfix: 审批列表为空
- 根因：createApproval 完全未移植，approvals 表无人写入 → 提示需要审批但列表空
- 修复：approvals/store.rs 新增 create_approval（去重+插入），settings codex-runtime PATCH 改为真正落库 pending 审批并返回真实 approval
- 待办（同类，风险门控触发时才建审批，尚未接）：preview-command-run、project-delete-files、project-git-operation、room-run-merge、preview-access

### bugfix: SSE 全部断连（401）
- 根因：EventSource 不能发 Authorization 头，前端用 ?token= 查询参数传会话 token；guard 只认 Authorization 头 → 所有 SSE 401 → 前端无限重连+轮询
- 修复：auth/guard.rs 在无 Authorization 头时回退读取 ?token= 查询参数（含 percent-decode）并校验，session token / api key 均适用

### bugfix 批次 2（端到端联调发现）
- 项目页 .length 崩溃：GET /api/projects 永远返回裸数组，但前端带 limit/cursor/q 时要分页对象 → 改为带分页参数时返回 {items,nextCursor,hasMore}（按 name 游标），无参时仍裸数组（与 TS 一致）
- 会话页 SSE JSON.parse undefined：codex 事件流契约与 TS 不一致 → 重写为首帧 snapshot{session,messages,queue,exitCode} + 新消息发 message 事件 + queue 变化发 queue 事件；日志切片做 char-boundary 防护
- 终端无法输入：服务端 WS 输入实测正常（echo 回显 OK），根因是 SSE token 修复前 WS 未认证；token 修复后已通

### bugfix 批次 3
- 文件移除挂载失效：list_mounts 之前在表空时合成只读 "default" 挂载（非真实行，删不掉）→ 改为只返回真实行（与 TS 一致），resolve_mount 无挂载时回退临时 cwd 工作区，delete 永远返回 ok
- 联系人页内置角色/圈子缺失：seedMultiAgentDefaults 未移植 → 新增 agents/store.rs::seed_multi_agent_defaults，启动时播种 2 个内置圈子(故事到电影/软件开发)+19 个角色(从 role-templates)，main.rs 启动调用
- 注意：role-templates 是文件未嵌入二进制，单二进制部署需随附或后续 include_dir 嵌入

### bugfix 批次 4：裸数组 vs 分页对象（系统排查）
前端对一批 list 端点按 PageResponse{items,nextCursor,hasMore} 解析，Rust 部分返回裸数组 → .length/.items 崩溃。
- 修复：automations GET /（带 limit/cursor/q/status/projectId/actionType 时返回分页对象，否则裸数组，与 TS 一致）
- 修复：rooms 的 tasks/schedules/runs/events/artifacts/decisions/handoffs 7 个端点包成 PageResponse（room agents 前端要裸数组，保持不变）
- 已核对正确（无需改）：sessions、approvals、approval-grants、providers/:id/health、agents(roles/agents/groups/circles/:id sessions/rooms)、extensions(paged_or_full)、previews、notifications(rules/ephemeral/deliveries)、codex tasks /runs、automation /runs
- 裸数组端点（前端本就要数组）：providers/goals list、room agents、notifications channels/accounts/recipients、goals events/focuses/items/proposals

### bugfix 批次 5
- 自动化执行无响应/暂无 task log：ensure_session + create_session 默认 status='running' → run_now 的 codex 分支走 continue_task 被队列守卫拦截入队（不启动 codex）。改为 append user message + runner::start_room_run(reset_output=true) 直接 fresh 启动，绕过队列守卫。ensure_session 不再强制 running。实测 codex.log 正常产出。
- 添加角色内置角色为空 / 单二进制部署：role-templates 未嵌入，运行时目录解析不到 → 模板列表空。include_dir! 嵌入 apps/api/role-templates；新增 ensure_role_templates_on_disk（磁盘缺失时释放嵌入副本到 data_dir/role-templates）；role_template_dir 优先仓库路径否则 data_dir/role-templates；main.rs 启动调用。实测干净 data 目录下 /api/agent-role-templates 返回 155 模板。

### bugfix 批次 6（真正根因：SSE 完成后断流）
- 会话回复后 "undefined is not valid JSON" + 实时流断开重连：codex 事件流在任务终态后 break 关闭连接 → 浏览器 EventSource 触发原生(无data)error 事件 → 前端给 "error" 事件名注册的 JSON.parse handler 收到 undefined → 抛错+重连。TS 后端流永不主动关闭。
- 修复：tasks/events.rs 去掉终态 break，保持连接(KeepAlive)直到客户端断开；状态回 running 时重置 emitted_terminal 支持续跑。实测已完成会话 SSE 保持开启不早关。

### bugfix 批次 7：web 终端泄漏到本机终端
- 现象：打开 web 终端时本机终端被改成了 web 终端的路径
- 根因：pipe 模式起 zsh -i，交互 shell 的 OSC7(上报cwd)/标题转义写到控制终端，而 server 继承了启动它的本机终端为控制终端 → 泄漏
- 修复：terminal/runtime.rs spawn 加 pre_exec setsid() 脱离控制终端；隔离 HISTFILE 到临时文件；补 managed_child_env PATH 增强(mise/local bin)。新增 libc 依赖。终端 echo 实测正常。
- 备注：根治方案是改用真 PTY(portable-pty)，当前为 pipe 模式 + setsid 缓解

### bugfix 批次 8：会话停止按钮无效
- 现象：点停止返回 ok 但页面仍「正在输出」，刷新依旧
- 根因：stop 只发 kill + 标记 run，未更新 session 状态也不返回 session → DB status 卡在 running → 前端 taskRunning(status==='running') 恒真
- 修复：tasks stop handler 立即 update_runtime status='paused' 持久化 + 追加助手消息 + 返回更新后的 session（对齐 TS）。实测 stop 响应与刷新后均为 paused。

### bugfix 批次 9：审批归档后不在已归档显示
- 根因：approvals list 硬编码 where archived_at is null，ApprovalQuery 无 archived 字段 → 前端 ?archived=true 被忽略
- 修复：store::list 加 archived 参数（true→archived_at is not null），handler 解析 ?archived=true。实测归档项在 archived 列表出现、pending 列表消失。

### bugfix 批次 10：包管理无法获取本机已安装包
- 根因：environment.rs tool_packages 只返回 DB 记录包，inspect_package 是 stub，从不跑包管理器命令探测本机
- 修复：忠实移植 TS packages.ts —— 命令路径解析(resolve_pip/tool_command, first_successful_command, installed_package_lines)、各管理器 version/inspect/scan(pip/uv/npm/pnpm/cargo/gem/bun/composer/dotnet/dart/nimble/luarocks/...)、JSON 提取；tool_packages 合并 DB记录+本机扫描(去重)；list_package_managers 填 detected_version；inspect_package 真探测
- 实测：注册 python 后 packages 返回 194 个本机 pip 包 + managers 显示 pip/uv 版本

### bugfix 批次 11：终端升级为真 PTY（解决空白/无提示符）
- 现象：终端空白，不显示当前路径/提示符
- 根因链：pipe 模式 + .lines() 缓冲(无换行的提示符不输出)；批次7的 setsid 修了泄漏但也让依赖 tty 的提示符无法打印
- 修复：portable-pty 真伪终端重写 create_session —— shell 控制终端=pty(提示符/颜色/光标/全屏程序正常且不泄漏)，blocking 线程原始字节直通转发，input 经 std channel 写 pty(不再 \r→\n)，mode=pty(前端不本地回显)，保留 PATH/HISTFILE/TERM。新增 portable-pty 依赖；libc 不再使用(保留无害)。
- 实测：连上即收到提示符(p10k 含颜色/时间戳/光标控制)1337B，echo 回显与执行正常

### bugfix 批次 12：终端换行/布局错乱（PTY resize）
- 现象：%、路径、命令输入各占一行，与正常终端不符
- 根因：pty 固定 120x30，与前端 xterm 实际尺寸不符，p10k 按错误宽度算右对齐/填充/换行
- 修复：TerminalHandle 加 resize 通道；ws 解析 {type:resize,cols,rows} → pty master.resize()(发 SIGWINCH 重绘)；writer 线程统一处理 PtyMsg::Input/Resize
- 实测：resize 100x40 后 shell $COLUMNS/$LINES = 100/40

### bugfix 批次 13：会话切换模型后错误指向旧 provider
- 现象：现有会话切换模型(provider select 正确显示新 provider)，但报错指向旧 provider
- 根因：会话已有 codex 线程，continue 走 codex exec resume；codex 恢复线程沿用线程原始 provider，新选 provider/model 不生效
- 修复：continue_task 捕获切换前 provider_id，provider 变更时强制 reset_output=true 重开线程(不 resume)；runner 在 thread.started 自动覆盖 codex_session_id。同 provider 内换模型仍 resume 保留上下文。
- 注：未端到端实测(需两个配 key 的 provider)，按逻辑修复，编译构建通过

### bugfix 批次 14：chat provider 未经本地代理转 responses（错误指向别的 provider）
- 根因：codex_args 只在 use_proxy 设 model_provider+name，没设 base_url/wire_api；OPENAI_BASE_URL 直指真实 chat 端点 → codex 用 Responses 打 chat 接口失败
- 修复(对齐 TS codexProviderConfigArgs)：合成 codexweb provider；chat 或 use_proxy-responses 的 base_url 指向本地代理 /api/providers/<id>/proxy；设 requires_openai_auth=true/wire_api=responses/experimental_bearer_token(代理=codex-web-proxy 否则 api_key)；chat 不导出 OPENAI_BASE_URL；redact_args 脱敏 experimental_bearer_token；start_runner 传 local_api_base(127.0.0.1:port)
- 实测：chat provider 的 codex header base_url=http://127.0.0.1:PORT/api/providers/<id>/proxy，wire_api=responses ✓

### bugfix 批次 15：chat→response 代理拿不到响应
- 根因：responses_to_chat_request 未把 stream 传给上游 → 上游返回非 SSE JSON → stream_chat_as_responses 解析不到 delta → 空响应
- 修复：proxy.rs responses_to_chat_request 补传 stream + 新增 response_tools_to_chat_tools(工具转换)
- 实测(mock 上游)：上游收到 stream=True/tools=True/msgs=2，代理回完整 Responses SSE(created→delta→completed)
- 遗留：上游 chat 流的 tool_calls 增量尚未转成 Responses function_call 事件(文本响应正常，工具调用待补)

### bugfix 批次 16：POST /api/rooms 创建房间报 agent_group_members.position 不存在
- 根因：rooms/store.rs 从 agent_group_members 读取组成员时 order by position asc，但 agent_group_members schema 没有 position 列；TS 按 agent_id asc 排序
- 修复：改为 order by agent_id asc；全局搜索无其它 position 引用；cargo check + release build 通过

### bugfix 批次 17：停止后再发消息进入待发送队列且无法发送
- 根因：stop 接口立即把 DB status 改 paused，但 state.tasks 的 active handle 等子进程退出才移除；停止后马上发消息时 continue_task 看到 state.tasks 存在 → 入队；被停止任务不 drain 队列 → 永久卡住
- 修复：runner::stop_task 发 kill 后立即 state.tasks.remove(session_id)，让停止后的下一条消息直接启动 fresh run；wait task 后续 remove 幂等无害
- cargo check + release build 通过

### bugfix 批次 18：队列消息启动后卡「正在输出」
- 根因：批次17/队列 drain 中，因 start_runner future 非 Send，使用独立 current-thread runtime 启动下一条；但 start_runner 返回后 runtime 立刻 drop，内部 stdout/stderr/wait tokio::spawn 任务被 abort → session 已置 running 但无输出/无完成事件，一直「正在输出」
- 修复：新增 spawn_next_queued_message_if_idle，启动队列下一条后保持 current-thread runtime 存活，轮询 state.tasks 直到该 queued run 结束再退出；cargo check + release build 通过

### bugfix 批次 19：群组会话 session 404 + task log 缺用户 prompt
- 群组会话 404 根因：POST /api/rooms 只生成 session_id 写 rooms，未插 sessions 表；前端随后 GET /api/sessions/<sessionId> 404。修复：room create 时创建 linked session(conversation_type='room', room_id, status='paused', project/scratch workspace)。
- task log 缺用户内容：runner 日志只记录命令头+agent stdout/stderr，prompt 被 [prompt omitted]。修复：启动前写入 `--- user ---\n<prompt>\n\n--- agent ---`，保留命令参数脱敏。
- cargo check + release build 通过

### bugfix 批次 20：群组快捷回复上方不显示成员名称 + TODO 巡检
- 根因：/api/rooms/:id/agents 返回的是 {roomId,agentId,listenMode}，但前端按 RoomAgentSummary extends AgentSummary 使用，需要 id/name/description 等字段 → mention chips 无 agent.name
- 修复：RoomAgentSummary 改为 AgentSummary 字段 + listenMode；room_agents/read_room_agents join agents 表返回完整 agent 信息
- 额外：检查 Rust TODO，主要未完成项集中在 preview access token、maintenance 深度清理、goals/rooms runtime orchestration 若干边角、notifications 微信/企业微信实时 runtime、approval 副作用、webhook dispatch；已记录待后续分批处理
- cargo check + release build 通过

### bugfix 批次 21：群组 agent 成功回复后主会话看不到消息
- 根因：Rust finish_agent_run_for_session 只更新 agent_runs/room_tasks/status，没有像 TS finishAgentRun 一样把子 agent session 的最新 assistant message 写回 room parent session messages，也没有 agent.message room_event
- 修复：agent run done 时读取 child session 最新 assistant 消息，按 `AgentName:\n<reply>` append 到 room linked session；更新 parent session updated_at；记录 room_event `agent.message`
- cargo check + release build 通过

### bugfix 批次 22：群组 agent 回复写入后刷新不及时
- 现象：agent 回复实际成功写入，但当前会话不显示；第二次发送消息时上一次回复才出现
- 根因：SessionPage 依赖 /api/rooms/:id/events/stream 的 snapshot/activity.messages 进行即时 merge；Rust rooms/events.rs TODO 中 messages 固定返回 []
- 修复：room activity snapshot 读取 linked room session messages(limit 50) 并放入 messages 字段；前端收到 activity 即可即时 merge
- cargo check + release build 通过

### bugfix 批次 23：设置开启 bypass sandbox/approval 后 agent 仍是沙盒
- 根因：Rust runner 没读取 codex_runtime 设置，codex_args 固定只有 --skip-git-repo-check；未传 --dangerously-bypass-approvals-and-sandbox / --sandbox / -C / --add-dir
- 修复：settings 导出 load_codex_runtime/CodexRuntimeSettings；runner start_runner 读取 runtime；codex_args 对齐 TS codexExecPermissionArgs：bypass=true 时传 --dangerously-bypass-approvals-and-sandbox 且 exec 时 -C cwd；否则 exec 传 --sandbox <mode> -C cwd 并 workspace-write 时 --add-dir cwd；resume 只带通用权限参数
- 实测：CODEX_WEB_CODEX_BYPASS_SANDBOX=true 下 task log codex args 包含 --dangerously-bypass-approvals-and-sandbox -C

### bugfix 批次 24：scratch 会话工作目录未放在 data/sessions/<id>/workspace
- 根因：TS ensureScratchSessionWorkspace 使用 data/sessions/<sessionId>/workspace 作为 scratch cwd；Rust create_session/room parent session 误用 std::env::current_dir() 作为 workspace_path，data 下只有 logs/context，codex cwd 跑到服务启动目录
- 修复：sessions::store create_session 和 rooms::store room parent session 均为 scratch 创建/使用 data_dir/sessions/<id>/workspace；项目会话仍用 project.workspace_path
- cargo check + release build 通过

### parity 批次 25：按 TS 代码补齐 Rooms/Goals/Approval/Preview/Webhook/Environment 部分差异
- 原则更新：后续以 TS 实际代码为准，不以 Rust TODO/注释为准；TODO 仅当线索。
- Rooms/Goals：补 circle→agent group materialization、room create body.orchestration/body.goal、room task↔goal item 状态传播、cancel running room task best-effort stop codex、route handler 调 orchestrate_and_launch 等；cargo check 通过。
- Environment bulk：record_detected_packages 使用现有扫描结果持久化 env-pkg；install_missing_packages 继续处理 persisted missing records。
- Preview/Approval：preview-access access request 创建 approval；approve/deny preview-access 更新 request；signed preview access cookie + verifier；approval handler 执行 codex-runtime/preview-command/preview-access/project-delete-files/room-run-merge/project-git-operation 可行副作用并保留 grants。
- Webhooks：send webhook 从占位 queued 改为真实 dispatch 到 session：运行中入队，否则启动/continue codex task。
- 验证：cargo check + release build 通过（剩余 2 个 unused warning：旧 approve helper/private_access_allowed）。

### parity 批次 26：完成剩余 3-7（event bus/preview rewrite/legacy migration/goals/warnings）
- Event bus：Task/Room/Preview 增加 broadcast channels + publish/subscribe，保留慢 polling fallback；App notifications 也加轻量 broadcast snapshot，create/mark_read/clear 即时发布。
- Preview rewrite：proxy redirect manual；过滤请求/响应 hop headers；Location rewrite；HTML src/href/action/srcset rewrite；CSS url(/...) rewrite；非文本保持 streaming；private access 用 signed cookie/session verifier。
- Legacy room workspace：room run workspace 选择时 best-effort 迁移 data_dir/rooms/<roomId> → data_dir/sessions/<room-parent-session-id>/room，rename 优先、copy/merge fallback，不覆盖目标。
- Goals：GoalSummary 增 currentFocus；RoomSummary hydrate active goal；proposal 排序对齐 TS；room completion chain reason 改为 agent.completed/failed/stopped；移除过期 orchestration TODO 注释。
- Schedule：due one-shot schedule runtime 已接入，注释清理。
- Warnings：清理 unused approve/private_access_allowed/SavedAttachment.id，当前 cargo check 无 crate warning；release build 通过。
- 剩余标记仅 notifications 外部 runtime：WeCom WebSocket bot、Weixin live QR polling（需要外部长连接/扫码状态机）。

### parity 批次 27：完成剩余 1-2（Weixin QR polling + WeCom WS send）
- Weixin QR：新增内存 QR session runtime；start 调 ilink get_bot_qrcode；status 调 get_qrcode_status；成功后保存 botToken/baseUrl/accountId/userId 到 notification_accounts.config；支持 draft/per-account；10min 过期。
- WeCom：新增 tokio-tungstenite 依赖；send_wecom 不再直接 wecom_websocket_not_connected，按 TS 协议临时连接 websocketUrl(默认 wss://openws.work.weixin.qq.com)，发送 aibot_subscribe(bot_id/secret/device_id)，订阅成功后 aibot_send_msg markdown 到 chatId/testChatId。
- Event/TODO 标记：Rust src 中 TODO/FIXME/not implemented/stub 标记清零（以代码 grep 结果为准）。
- cargo check + release build 通过。

### bugfix 批次 28：回到用户实际问题——自动化 task log + WeCom 常驻修正
- 用户指出问题是自动化/预览，不是 WeCom；修正上下文。
- 自动化 command run：原先只 append assistant message，不写 data/sessions/<id>/logs/codex.log/codex.json，导致 UI 显示“暂无 task log”。修复：start_command_run 启动时写 log header/user/agent/$ command；完成时 append 命令输出并写 codex.json meta，发布 output/done task events。
- WeCom：将先前按需发送修正为常驻 runtime 基础版；accounts create/update/list sync runtime，delete stop；runtime 常驻 websocket subscribe/heartbeat/reconnect，outbound 复用 runtime；inbound callback minimal dispatch 到 defaultSessionId。
- cargo check + release build 通过，无 crate warning。

### bugfix 批次 29：自动化“运行并打开”无法创建/打开会话
- 根因：前端按 TS 协议把 POST /api/automations/:id/run 响应直接当 SessionSummary 使用，并读取 session.id；Rust 返回 {session, automationRunStatus, run} 包装对象，导致 session.id=undefined，运行并打开失败。
- 修复：Rust run_now 响应改为 TS parity：顶层返回 SessionSummary 字段，并附加 automationRunStatus/run。
- 同批：自动化 command run 已写 codex.log/codex.json，task log 不再“暂无”。
- cargo check + release build 通过。

### bugfix 批次 30：严格按 TS 对照自动化/预览关键接口
- 自动化：确认前端按 TS 直接把 /api/automations/:id/run 响应当 SessionSummary；已改 Rust 顶层返回 SessionSummary + automationRunStatus/run，修复运行并打开 session.id undefined。
- 自动化 command：写 codex.log/codex.json，发布 output/done events，修复“暂无 task log”。
- 预览：按 TS createPreviewProcess 对照，修复 resolvePreviewCwd：Rust 原来直接用 cwd/服务目录；现在按 scope workspace(project/session/folder) 解析并限制在 workspace 内，防止目录错误导致启动失败。
- 预览 create：按 TS 对齐同 scope/host/port existing preview 逻辑：允许复用，补 command/cwd/access；若已有不同 command 则 preview_port_in_use；不再简单直接返回 existing。
- cargo check + release build 通过。

### bugfix 批次 31：行为级对照示例——删除会话/存储孤立数据
- 用户指出路由对照不足，应按 TS 行为对照；以删除会话为例修复。
- TS delete session 行为：读取 deleteWorkspace/deleteLogs；不删 workspace 时先写 .codex-web.json 元数据；room 会删除 child agent sessions 和 room DB rows；deleteSessionDatabaseRows 还删 previews/goals/messages/queue/task_activities/execution_contexts/compactions/agent_runs 等。
- Rust 修复：DELETE /api/sessions/:id 接收 query deleteWorkspace/deleteLogs；删除前写 session .codex-web.json；按参数删除 context/logs/workspace/session data；room 删除 child agent sessions 和 room rows；store::delete_session 扩展清理 task_activities/execution_contexts/session_compactions/agent_runs/previews scoped session/goals。
- Storage scan 修复：orphan session-data 读取 .codex-web.json/metadata.json，显示原 session title/project/sessionType/sessionKind，而不是只有目录名。
- cargo check + release build 通过。

### parity 批次 32：开始按 TS handler 行为级对照（sessions/tasks/previews/automations）
- 原则：路由覆盖不等于功能；逐 handler 对照 query/body、响应 shape/status、DB/FS/runtime/SSE 副作用。
- Sessions/Tasks：GET /api/sessions 动态 raw array/PageResponse + q/status/projectId/cursor；DELETE /api/sessions/:id 支持 deleteWorkspace/deleteLogs、写 orphan metadata、room child/room rows 清理、FS 删除；create/continue attachments + reply context + ephemeral notifications；queue/stop/SSE/runner finish 对齐；task run cursor；cwd-aware file ops。
- Storage：orphan session-data 读取 .codex-web.json/metadata.json 显示原会话/项目相关信息。
- Previews：list cursor；create existing preview 复用/更新 command/access；201 vs 200；active port conflict；targetHost regex 对齐；preview command approval/grants；start 状态 starting→ready poll→running/error；cwd 按 scope workspace 解析；exit settle；proxy rewrite 保留。
- Automations：runs cursor；deleteSession query；cancel queued system message；stop-running 返回 shape；validation/status；lastRunAt/nextRunAt；startup/schedule loop；overlap skip/queue；queued promotion；retry；agent automation finish hook；runner completion 调 automation finish。
- cargo check + release build 通过。

### bugfix 批次 33：Storage active/orphan 判定对齐 TS activeSessionIds/activeRoomIds
- 根因：Rust storage scan 只要 sessions 表存在同名 row 就标 active；会话列表默认隐藏 automation 和 room agent child，导致“列表 0 个但存储很多使用中”。另外 room agent child 所属 room 已无 active parent 时也会误标 active。
- 修复：scan 中构造 activeRoomIds：room.session_id 存在且 parent session 存在才 active；构造 activeSessionIds：agent child 若 room 不 active 则 orphan，其它 session 仍按 TS appData.sessions 视为 active（包括隐藏的 automation/internal sessions）。
- orphan session-data 继续读取 .codex-web.json/metadata.json 显示原会话/项目信息。
- cargo check + release build 通过。

### bugfix 批次 34：storage room 关联名 + private preview access cookie
- Storage room：Rust scan_rooms 只有 room id HashSet，relatedName 用目录名；TS 使用 roomById.name。修复：rooms_with_sessions 查询 id/session_id/name，scan_rooms relatedName 优先 room.name。
- Preview private access：前端 openPreviewUrl 先 POST /api/previews/:id/access，再 window.open(url)；TS 该 POST 会 set-cookie previewAccessCookie。Rust grant_access 只返回 JSON，不设置 cookie，导致新窗口无 bearer/cookie，proxy 返回 preview_access_required。修复：暴露 preview_access_cookie_header，grant_access 对 private preview 设置 signed access cookie。
- cargo check + release build 通过。

### bugfix 批次 35：已删除群组的 room folder 仍被 storage 判 active
- 根因：storage activeRoomIds 只判断 rooms.session_id 对应 session row 是否存在；旧 rooms row 或错误 session_id 指向任意 session 都会让 data_dir/rooms/<roomId> 误标 active。
- 修复：activeRoomIds 收紧为：room.session_id 对应 session 必须 conversation_type='room' 且 session.room_id == room.id，才算 active。否则 room workspace 标 orphan。
- cargo check + release build 通过。

### bugfix 批次 36：新建会话后启动任务 os error 2 / workspace 未创建
- 根因：runner current_dir(cwd) 前没有确保 cwd 存在；scratch workspace 虽在 create_session 尝试创建，但旧数据/部分路径/自动化路径可能仍指向不存在目录，直接导致 os error 2。
- 修复：start_runner 前 ensure_runner_cwd：如果 cwd 在 data/sessions 或 session.kind=scratch，则 create_dir_all；项目 workspace 不存在时返回清晰 workspace_not_found。
- 额外对齐 TS：create_session 初始 status 改 paused（TS 新会话 paused），避免新建会话默认 running 造成后续消息入队/状态异常。
- cargo check + release build 通过。

### bugfix 批次 37：codex spawn os error 2 二次定位
- 用户日志显示 cwd=apps/api/data/.../workspace 为相对路径，且 `$ codex` 后立即 os error 2；该错误可能是 cwd 相对服务启动目录不存在，也可能是 PATH 找不到 codex。
- 修复：start_runner 将 cwd 转为绝对路径；managed data/sessions scratch cwd 不存在时 create_dir_all 后使用绝对 cwd；项目 cwd 不存在时报 workspace_not_found。
- 修复：子进程 PATH 对齐 TS managedChildEnv，补 mise shims、~/.local/bin、~/.mise/bin、/usr/local/bin、/opt/homebrew/bin 等，再追加原 PATH。
- cargo check + release build 通过。

### bugfix 批次 38：preview private 授权直达路径 + cookie 失败显式报错
- 根因1：/api/previews/:id/access 已补 cookie，但 /preview/:id/:token/ 直达 root proxy 对 private 未授权仍直接返回 JSON preview_access_required；TS 对浏览器 GET 返回授权申请 HTML。修复：http preview_proxy/root 先查 preview/access，GET/HEAD 未授权返回 private_preview_access_response，非 GET 返回 401。
- 根因2：grant_access 签 cookie 失败时此前静默 200，前端以为授权成功但新窗口仍无 cookie。修复：private preview access cookie 生成/HeaderValue 失败返回 preview_access_cookie_failed。
- cargo check + release build 通过。

### bugfix 批次 39：preview rewrite regex panic
- 根因：Rust regex 不支持 lookahead/backreference；preview rewrite 使用了 TS 风格 `(?!...)` 和 `\1`，导致 tokio worker panic。
- 修复：HTML attr/srcset/CSS url rewrite 改为 Rust regex 支持的广义捕获 + 显式前缀判断，不再使用 look-around/backref。
- cargo check + release build 通过。

### bugfix 批次 40：data_dir 相对 target/release 导致会话 workspace 查错路径
- 用户日志显示 codex 在查 apps/api-rs/target/release/apps/api/data/sessions/...，说明 Rust 默认 data_dir=apps/api/data 被相对 binary cwd 解析，而 TS dev 默认是 repo_root/apps/api/data。
- 修复：AppConfig 默认 data_dir 用 CARGO_MANIFEST_DIR 推导 repo_root/apps/api/data；相对 CODEX_WEB_DATA_DIR 若以 apps/api/data 开头，也锚定 repo root；其它相对路径仍按当前 cwd。
- cargo check + release build 通过。

### bugfix 批次 41：任务错误后 SSE 断开/前端显示实时流重连
- 根因：task events stream 在 broadcast RecvError::Closed 或 session 临时读不到时 break，导致浏览器原生 EventSource.onerror，前端显示“实时事件流已断开”。任务失败/paused 不应该关闭 SSE。
- 修复：broadcast Closed 时重新 subscribe，不关闭流；session 暂时读不到时 continue，保留 keepalive/polling fallback。
- cargo check + release build 通过。

### bugfix 批次 42：Rust 默认 data_dir 改为当前启动目录 ./data
- 用户明确期望：不设置 data_dir 时，Rust 版应在当前目录生成 data 目录，而不是 repo_root/apps/api/data。
- 修复：AppConfig 默认 CODEX_WEB_DATA_DIR 缺省为 `data`，并按 current_dir absolutize；相对 CODEX_WEB_DATA_DIR 也按 current_dir 解析，绝对路径保持不变。
- cargo check + release build 通过。

### bugfix 批次 43：scratch 会话 workspace 自动 git init
- TS ensureScratchSessionWorkspace 会 mkdir workspace 后 ensureGitRepositorySync；变更面板依赖 git status/diff/ls-files，非 git repo 只能返回 not_a_git_repository。
- 修复 Rust：sessions::ensure_scratch_session_workspace 创建后执行 git init；runner ensure_runner_cwd 兜底创建/已有 scratch managed cwd 时也确保 .git 存在。
- cargo check + release build 通过。

### bugfix 批次 44：浏览器通知/app-notifications SSE
- 前端浏览器通知监听 /api/app-notifications/events 的 snapshot 和 notification 事件；Rust 此前只发 snapshot，且 approval/task 完成等业务事件未写 app_notifications。
- 修复：app_notifications events 增 publish_notification，create endpoint 同时发送 notification + snapshot。
- 修复：approval create 时写入 needs_approval app_notification（sourceType=approval/sourceId=approval.id），供通知中心/浏览器通知显示。
- 修复：task runner 完成/失败/停止时写入 task_completed/task_failed/task_interrupted app_notification，并即时 publish notification。
- cargo check + release build 通过。

### frontend fix follow-up：前端变更后重建 Rust binary
- 用户反馈会话变更面板打开文件仍跳转；前端代码已改为弹窗，但 Rust release binary 可能服务嵌入的旧 web dist。
- 操作：在 npm web build 后重新 cargo build --release，确保新 dist 被 Rust binary/静态服务使用。

### frontend fix 批次 45：会话变更面板 .diff-file-head button 改弹窗
- 用户指出具体元素 .diff-file-head button；之前只改了父组件传参，未直接改 ContextPanel 内按钮。
- 修复：ContextPanel 内部引入 FileContentResponse/filePreview state/openFilePreview；.diff-file-head button 直接调用 openFilePreview；弹窗显示文件内容/错误。
- npm web build 通过；cargo release rebuild 完成。

### frontend fix 批次 46：变更面板打开文件改为复用 FilesPage 组件
- 用户要求弹窗直接使用 file 组件显示文件列表，而不是自定义 pre 内容预览。
- 修复：ContextPanel 的 .diff-file-head button 恢复调用 onOpenFile(path)；SessionPage 维护 changeFileBrowser state，弹出 modal 内嵌 FilesPage，传 initialRootPath=session.workspacePath、initialPath=变更文件路径、embedded、TerminalComponent。
- npm web build 通过；cargo release rebuild 完成。
