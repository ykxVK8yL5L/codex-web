import type { ProjectSummary, SessionSummary } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export function readableStatus(status: SessionSummary["status"] | undefined, t: TFunction) {
  if (status === "running") return t("session.statusRunning");
  if (status === "done") return t("session.statusDone");
  if (status === "paused") return t("session.statusPaused");
  if (status === "interrupted") return t("session.statusInterrupted");
  return t("session.statusReady");
}

export function readableGitStatus(status: ProjectSummary["gitStatus"] | undefined, changedFiles: number, t: TFunction) {
  if (status === "dirty") return t("project.gitChanged").replace("{count}", String(changedFiles));
  if (status === "clean") return t("project.gitClean");
  if (status === "not-git") return t("project.notGitRepo");
  if (status === "error") return t("project.gitStatusFailed");
  return t("project.gitChanged").replace("{count}", String(changedFiles));
}
