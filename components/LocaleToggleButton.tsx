"use client";

import { useLocale } from "@/lib/i18n";

export function LocaleToggleButton() {
  const { locale, toggleLocale, t } = useLocale();

  return (
    <button
      className="pi-locale-toggle-button"
      onClick={toggleLocale}
      title={t("locale.next")}
      aria-label={t("locale.next")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        padding: 0,
        background: "none",
        border: "none",
        borderRight: "1px solid var(--border)",
        color: "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0,
        transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text)";
        e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-muted)";
        e.currentTarget.style.background = "none";
      }}
    >
      {locale === "zh-CN" ? t("locale.short") : "EN"}
    </button>
  );
}
