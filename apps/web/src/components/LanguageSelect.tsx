import { localeLabels, translate, type Locale } from "@/lib/i18n";

export function LanguageSelect({
  locale,
  onChange,
  compact = false,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  compact?: boolean;
}) {
  return (
    <select name="locale"
      className={compact ? "language-select compact" : "language-select"}
      value={locale}
      title={translate(locale, "common.language")}
      onChange={(event) => onChange(event.target.value as Locale)}
    >
      {(Object.keys(localeLabels) as Locale[]).map((item) => (
        <option key={item} value={item}>{compact ? item.slice(0, 2).toUpperCase() : localeLabels[item]}</option>
      ))}
    </select>
  );
}
