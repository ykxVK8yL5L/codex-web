import type { PlatformSettingsResponse } from "@codex-web/protocol";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

export function NotificationPlatformsPanel({
  platformSettings,
  t,
}: {
  platformSettings: PlatformSettingsResponse | null;
  t: TFunction;
}) {
  return (
    <section className="notification-card">
      <strong>{t("settings.platformsTitle")}</strong>
      <span>{t("settings.platformsHelp")}</span>
      <div className="environment-item" style={{ alignItems: "flex-start", marginTop: 12 }}>
        <div className="environment-item-main">
          <div className="environment-item-head">
            <strong>{t("settings.platformBaselineTitle")}</strong>
            <span className="pill">{platformSettings?.baselineCapabilities.length ?? 0}</span>
          </div>
          <span>{t("settings.platformBaselineHelp")}</span>
          <div className="detail-tags" style={{ marginTop: 8 }}>
            {(platformSettings?.baselineCapabilities ?? []).map((capability) => (
              <span className="pill" key={capability}>{platformSettings?.capabilityLabels[capability] ?? capability}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="environment-list" style={{ marginTop: 12 }}>
        {(platformSettings?.platforms ?? []).map((platform) => (
          <article className="environment-item" key={platform.id}>
            <div className="environment-item-main">
              <div className="environment-item-head">
                <strong>{platform.label}</strong>
                <span className={`pill ${platform.enabled ? "" : "warm"}`}>{platform.enabled ? t("contacts.enabled") : t("contacts.disabled")}</span>
              </div>
              <span>{platform.description}</span>
              <span>{t("settings.platformAccountCount").replace("{count}", String(platform.accountCount))} · {t("settings.platformRouteCount").replace("{count}", String(platform.connectedRouteCount))}</span>
              {platform.notes && <span className="subtle">{platform.notes}</span>}
              <div className="detail-tags" style={{ marginTop: 8 }}>
                {platform.supportedCapabilities.map((capability) => (
                  <span className="pill" key={`${platform.id}:${capability}`}>{platformSettings?.capabilityLabels[capability] ?? capability}</span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
      {platformSettings && !platformSettings.platforms.length && <div className="empty-state">{t("settings.platformsEmpty")}</div>}
    </section>
  );
}
