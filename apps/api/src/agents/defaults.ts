import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentCircleSummary, AgentListenMode } from "@codex-web/protocol";
import { markdownDescription, markdownTitle, parseMarkdownFrontmatter } from "./role-templates.js";

export function seedMultiAgentDefaults(db: Database.Database, agentRoleTemplateDir: string) {
  const now = new Date().toISOString();
  const storyToMovieRules = [
    "This circle turns a user's short idea, prompt, or story seed into a complete movie production package.",
    "The current system does not export a final video file by default, but the room must still design the full movie package: story, screenplay, scene list, shot list, storyboard images, character visuals, voiceover, dialogue, music, sound effects, editing plan, image prompts, video prompts, and an HTML preview page.",
    "The Film Producer is the orchestrator. It owns the canonical version, assigns work, prevents conflicting rewrites, and merges final deliverables.",
    "The Screenwriter develops the story, characters, structure, scenes, dialogue, and voiceover.",
    "The Storyboard Director converts scenes into shots and storyboard panels.",
    "The Visual Development Director and Character Concept Artist define a stable visual language and consistent character appearances before storyboard generation.",
    "The Storyboard Image Prompt Engineer creates reusable prompts for character concept images and storyboard panels, preserving character identity and style.",
    "The Voice Music Sound Director designs narration, performance notes, music direction, ambient sound, and sound effects.",
    "The Editing Director plans pacing, shot duration, transitions, and trailer structure.",
    "The Production Quality Reviewer checks continuity, missing deliverables, prompt consistency, and audio/editing alignment.",
    "Default files should be organized under a movie package folder with numbered Markdown documents, a storyboard image folder, and index.html.",
  ].join("\n");
  const developmentRules = [
    "This circle turns product ideas, bug reports, refactor requests, and technical goals into working software changes.",
    "The Software Architect is the orchestrator. It clarifies scope, chooses the implementation strategy, splits work, protects boundaries, and owns the final integration plan.",
    "The Product Manager sharpens requirements, success criteria, user impact, edge cases, and release scope before implementation expands.",
    "The Frontend Developer owns UI, client state, accessibility, responsive behavior, and frontend performance.",
    "The Backend Architect owns APIs, services, data flow, persistence boundaries, and server-side reliability.",
    "The Database Optimizer owns schema design, migrations, indexing, query performance, and data integrity.",
    "The DevOps Automator owns local/dev/prod scripts, CI, deployment, environment variables, runtime checks, and preview commands.",
    "The API Tester owns endpoint validation, contract tests, integration coverage, and regression evidence.",
    "The Code Reviewer checks correctness, maintainability, regressions, and missing tests before handoff.",
    "The Security Engineer checks auth, permissions, secrets, injection risks, unsafe file access, and deployment-sensitive behavior.",
    "The Technical Writer updates developer-facing docs, runbooks, API notes, and migration notes when behavior changes.",
    "Default handoff should include changed files, verification commands, risks, and next actions. Prefer focused implementation over speculative rewrites.",
  ].join("\n");
  const circles: Array<Pick<AgentCircleSummary, "id" | "name" | "description"> & Partial<Pick<AgentCircleSummary, "collaborationRules" | "eventRoutingRules" | "maxConcurrentAgents" | "approvalPolicy" | "mergeStrategy">>> = [
    {
      id: "circle-story-to-movie-studio",
      name: "故事到电影工作室",
      description: "把一句话或故事设定扩展为完整电影制作包，包括剧本、分镜、角色形象、故事板图片、配音、配乐、音效、剪辑方案和预览页面。",
      collaborationRules: storyToMovieRules,
      eventRoutingRules: "User ideas should first route to the Film Producer. Story, screenplay, and dialogue route to the Screenwriter. Shot planning routes to the Storyboard Director. Character and visual consistency route to the Visual Development Director and Character Concept Artist. Image/storyboard prompts route to the Storyboard Image Prompt Engineer. Voice, music, and sound route to the Voice Music Sound Director. Pacing and assembly route to the Editing Director. Final checks route to the Production Quality Reviewer.",
      maxConcurrentAgents: 4,
      approvalPolicy: "bounded",
      mergeStrategy: "approval-required",
    },
    {
      id: "circle-software-development-studio",
      name: "软件开发工作室",
      description: "面向前后端、API、数据库、测试、部署、安全和文档的通用程序开发协作圈子。",
      collaborationRules: developmentRules,
      eventRoutingRules: "New work should first route to the Software Architect. Ambiguous product scope routes to the Product Manager. UI and interaction work routes to the Frontend Developer. API, service, and persistence work routes to the Backend Architect and Database Optimizer. Build, deployment, preview, and environment work routes to the DevOps Automator. Endpoint validation routes to the API Tester. Final correctness and maintainability review routes to the Code Reviewer. Auth, permission, secret, and unsafe filesystem/network concerns route to the Security Engineer. Documentation or handoff gaps route to the Technical Writer.",
      maxConcurrentAgents: 4,
      approvalPolicy: "bounded",
      mergeStrategy: "approval-required",
    },
  ];
  const seededCircleIds = circles.map((circle) => circle.id);
  const circlePlaceholders = seededCircleIds.map(() => "?").join(",");
  db.prepare(`delete from agent_circle_roles where circle_id in (select id from agent_circles where builtin = 1 and id not in (${circlePlaceholders}))`).run(...seededCircleIds);
  db.prepare(`delete from agent_circles where builtin = 1 and id not in (${circlePlaceholders})`).run(...seededCircleIds);
  db.prepare(`delete from agent_circle_roles where circle_id in (${circlePlaceholders})`).run(...seededCircleIds);
  const insert = db.prepare(`
    insert into agent_circles (id, name, description, group_template_id, collaboration_rules, event_routing_rules, max_concurrent_agents, approval_policy, merge_strategy, builtin, created_at, updated_at)
    values (?, ?, ?, null, ?, ?, ?, ?, ?, 1, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      description = excluded.description,
      collaboration_rules = excluded.collaboration_rules,
      event_routing_rules = excluded.event_routing_rules,
      max_concurrent_agents = excluded.max_concurrent_agents,
      approval_policy = excluded.approval_policy,
      merge_strategy = excluded.merge_strategy,
      builtin = 1,
      updated_at = excluded.updated_at
  `);
  for (const circle of circles) {
    insert.run(
      circle.id,
      circle.name,
      circle.description ?? null,
      circle.collaborationRules ?? "",
      circle.eventRoutingRules ?? "",
      circle.maxConcurrentAgents ?? 3,
      circle.approvalPolicy ?? "bounded",
      circle.mergeStrategy ?? "approval-required",
      now,
      now,
    );
  }

  const storyToMovieRoles = [
    { id: "role-story-to-movie-film-producer", path: "story-to-movie/film-producer.md", listenMode: "orchestrator" },
    { id: "role-story-to-movie-screenwriter", path: "story-to-movie/screenwriter.md", listenMode: "active" },
    { id: "role-story-to-movie-storyboard-director", path: "story-to-movie/storyboard-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-visual-development-director", path: "story-to-movie/visual-development-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-character-concept-artist", path: "story-to-movie/character-concept-artist.md", listenMode: "passive" },
    { id: "role-story-to-movie-image-prompt-engineer", path: "story-to-movie/storyboard-image-prompt-engineer.md", listenMode: "passive" },
    { id: "role-story-to-movie-voice-music-sound-director", path: "story-to-movie/voice-music-sound-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-editing-director", path: "story-to-movie/editing-director.md", listenMode: "passive" },
    { id: "role-story-to-movie-production-quality-reviewer", path: "story-to-movie/production-quality-reviewer.md", listenMode: "passive" },
  ] satisfies Array<{ id: string; path: string; listenMode: AgentListenMode }>;
  const developmentRoles = [
    { id: "role-dev-software-architect", path: "agency-agents/engineering/engineering-software-architect.md", listenMode: "orchestrator" },
    { id: "role-dev-product-manager", path: "agency-agents/product/product-manager.md", listenMode: "active" },
    { id: "role-dev-frontend-developer", path: "agency-agents/engineering/engineering-frontend-developer.md", listenMode: "active" },
    { id: "role-dev-backend-architect", path: "agency-agents/engineering/engineering-backend-architect.md", listenMode: "active" },
    { id: "role-dev-database-optimizer", path: "agency-agents/engineering/engineering-database-optimizer.md", listenMode: "passive" },
    { id: "role-dev-devops-automator", path: "agency-agents/engineering/engineering-devops-automator.md", listenMode: "passive" },
    { id: "role-dev-api-tester", path: "agency-agents/testing/testing-api-tester.md", listenMode: "passive" },
    { id: "role-dev-code-reviewer", path: "agency-agents/engineering/engineering-code-reviewer.md", listenMode: "passive" },
    { id: "role-dev-security-engineer", path: "agency-agents/engineering/engineering-security-engineer.md", listenMode: "passive" },
    { id: "role-dev-technical-writer", path: "agency-agents/engineering/engineering-technical-writer.md", listenMode: "passive" },
  ] satisfies Array<{ id: string; path: string; listenMode: AgentListenMode }>;
  const insertRole = db.prepare(`
    insert into agent_roles (id, name, description, source_type, source_path, source_url, markdown_content, system_prompt, capabilities, default_listen_mode, default_listen_events, default_workspace_mode, default_sandbox_mode, default_approval_policy, output_contract, safety_notes, created_at, updated_at)
    values (?, ?, ?, 'builtin-template', ?, null, ?, ?, '[]', ?, '[]', 'isolated-worktree-with-shared-room', null, null, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      description = excluded.description,
      source_type = excluded.source_type,
      source_path = excluded.source_path,
      markdown_content = excluded.markdown_content,
      system_prompt = excluded.system_prompt,
      default_listen_mode = excluded.default_listen_mode,
      default_workspace_mode = excluded.default_workspace_mode,
      output_contract = excluded.output_contract,
      safety_notes = excluded.safety_notes,
      updated_at = excluded.updated_at
  `);
  const insertCircleRole = db.prepare("insert or replace into agent_circle_roles (circle_id, role_id, position) values (?, ?, ?)");
  function seedCircleRoles(circleId: string, roles: Array<{ id: string; path: string; listenMode: AgentListenMode }>, outputContract: string, safetyNotes: string) {
    for (const [position, role] of roles.entries()) {
      const templatePath = join(agentRoleTemplateDir, role.path);
      if (!existsSync(templatePath)) continue;
      const markdownContent = readFileSync(templatePath, "utf8");
      const metadata = parseMarkdownFrontmatter(markdownContent);
      const name = metadata.name || markdownTitle(markdownContent) || role.id;
      const description = metadata.description || markdownDescription(markdownContent);
      insertRole.run(role.id, name, description, role.path, markdownContent, markdownContent, role.listenMode, outputContract, safetyNotes, now, now);
      insertCircleRole.run(circleId, role.id, position);
    }
  }
  seedCircleRoles(
    "circle-story-to-movie-studio",
    storyToMovieRoles,
    "Return Markdown artifacts suitable for a complete movie production package. When creating files, keep them under the related session or project workspace.",
    "Do not claim that a final video file was generated unless an actual video generation tool is available and used. Avoid copyrighted song requirements; describe musical qualities instead.",
  );
  seedCircleRoles(
    "circle-software-development-studio",
    developmentRoles,
    "Return focused implementation plans, code changes, tests, review notes, and documentation updates suitable for software delivery. When creating files, keep them under the related project or session workspace.",
    "Respect project boundaries, secrets, permissions, and approval settings. Do not run destructive commands or expose credentials. Prefer small verified changes with clear rollback notes.",
  );
}
