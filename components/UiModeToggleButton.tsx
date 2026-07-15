"use client";

import { useUiMode } from "@/hooks/useUiMode";
import { useLocale } from "@/lib/i18n";

interface Props {
  variant?: "topbar" | "footer";
}

export function UiModeToggleButton({ variant = "topbar" }: Props) {
  const { uiMode, isFluid, toggleUiMode } = useUiMode();
  const { t } = useLocale();
  const isTopbar = variant === "topbar";
  const title = isFluid ? t("uiMode.currentFluid") : t("uiMode.currentClassic");

  return (
    <button
      type="button"
      className={`pi-ui-mode-toggle pi-ui-mode-toggle-${variant}`}
      onClick={toggleUiMode}
      title={title}
      aria-label={title}
      aria-pressed={isFluid}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isTopbar ? 0 : 4,
        flex: variant === "footer" ? 1 : undefined,
        width: isTopbar ? 36 : undefined,
        height: isTopbar ? 36 : 32,
        padding: variant === "footer" ? "0 3px" : 0,
        background: "transparent",
        border: "none",
        borderRight: isTopbar ? "1px solid var(--border)" : undefined,
        borderRadius: isTopbar ? 0 : 8,
        color: isFluid ? "var(--accent)" : "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
        fontSize: variant === "footer" ? 10.5 : 12,
        transition: "background 0.14s, color 0.14s, border-color 0.14s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = isFluid ? "var(--accent)" : "var(--text)";
        if (!isTopbar) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = isFluid ? "var(--accent)" : "var(--text-muted)";
        if (!isTopbar) event.currentTarget.style.background = "transparent";
      }}
    >
      <span
        aria-hidden="true"
        className="pi-ui-mode-glyph"
        style={{
          position: "relative",
          width: 16,
          height: 16,
          borderRadius: 5,
          border: "1px solid currentColor",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: isFluid ? 1 : 0.72,
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 3,
            right: 3,
            top: 4,
            height: 1,
            background: "currentColor",
            opacity: isFluid ? 0.95 : 0.55,
          }}
        />
        <span
          style={{
            position: "absolute",
            left: 3,
            right: isFluid ? 6 : 3,
            bottom: 4,
            height: 1,
            background: "currentColor",
            opacity: isFluid ? 0.95 : 0.55,
          }}
        />
      </span>
      {variant === "footer" && (
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {uiMode === "fluid" ? "Fluid" : "Classic"}
        </span>
      )}
    </button>
  );
}
