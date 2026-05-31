import React from "react";
import { translate, type TranslationKey } from "@/lib/i18n";
import { detectInitialLocale } from "@/lib/navigation";

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const locale = detectInitialLocale();
    const t = (key: TranslationKey) => translate(locale, key);
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div>
            <div className="crumb">Codex Web</div>
            <h1>{t("common.loadFailed")}</h1>
          </div>
          <div className="auth-error">{this.state.error.message}</div>
          <button
            className="dark-button"
            onClick={() => {
              localStorage.removeItem("codex-web-session");
              window.location.reload();
            }}
          >
            {t("common.relogin")}
          </button>
        </section>
      </main>
    );
  }
}
