"use client";

import { Component, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n";

type DeferredFeatureVariant = "panel" | "modal";

interface DeferredFeatureLoadingProps {
  featureKey: string;
  variant: DeferredFeatureVariant;
}

interface DeferredFeatureErrorProps extends DeferredFeatureLoadingProps {
  onDismiss: () => void;
}

interface DeferredFeatureBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
}

interface DeferredFeatureBoundaryState {
  failed: boolean;
}

function DeferredFeatureSurface({ variant, children }: { variant: DeferredFeatureVariant; children: ReactNode }) {
  const content = (
    <div
      style={{
        width: variant === "modal" ? "min(420px, calc(100vw - 32px))" : "100%",
        minHeight: variant === "modal" ? 180 : "100%",
        height: variant === "modal" ? "auto" : "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        border: variant === "modal" ? "1px solid var(--border)" : "none",
        borderRadius: variant === "modal" ? 10 : 0,
        background: "var(--bg)",
        color: "var(--text-muted)",
        boxShadow: variant === "modal" ? "0 8px 32px rgba(0,0,0,0.18)" : "none",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );

  if (variant === "panel") return content;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.35)",
      }}
    >
      {content}
    </div>
  );
}

export function DeferredFeatureLoading({ featureKey, variant }: DeferredFeatureLoadingProps) {
  const { t } = useLocale();
  return (
    <DeferredFeatureSurface variant={variant}>
      <div
        aria-hidden="true"
        style={{
          width: 20,
          height: 20,
          border: "2px solid var(--border)",
          borderTopColor: "var(--accent)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <div role="status" aria-live="polite" style={{ fontSize: 12 }}>
        {t("deferred.loading", { feature: t(featureKey) })}
      </div>
    </DeferredFeatureSurface>
  );
}

export function DeferredFeatureError({ featureKey, variant, onDismiss }: DeferredFeatureErrorProps) {
  const { t } = useLocale();
  return (
    <DeferredFeatureSurface variant={variant}>
      <div role="alert" style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>
        {t("deferred.loadFailed", { feature: t(featureKey) })}
      </div>
      <div style={{ maxWidth: 340, fontSize: 12, lineHeight: 1.5 }}>
        {t("deferred.loadFailedHint")}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onDismiss} style={actionStyle}>
          {t("deferred.close")}
        </button>
        <button type="button" onClick={() => window.location.reload()} style={{ ...actionStyle, background: "var(--accent)", color: "white" }}>
          {t("deferred.reload")}
        </button>
      </div>
    </DeferredFeatureSurface>
  );
}

const actionStyle = {
  height: 30,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
} as const;

export class DeferredFeatureBoundary extends Component<DeferredFeatureBoundaryProps, DeferredFeatureBoundaryState> {
  state: DeferredFeatureBoundaryState = { failed: false };

  static getDerivedStateFromError(): DeferredFeatureBoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    // The localized fallback is intentionally shown instead of exposing chunk details.
  }

  componentDidUpdate(previousProps: DeferredFeatureBoundaryProps): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
