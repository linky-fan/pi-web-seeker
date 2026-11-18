"use client";

import type { CSSProperties } from "react";
import { useLocale } from "@/lib/i18n";
import { MotionModal } from "./MotionModal";

interface ProjectTrustDialogProps {
  cwd: string;
  resolving: boolean;
  purpose?: "chat" | "package";
  onResolve: (trusted: boolean) => void;
  onClose: () => void;
}

export function ProjectTrustDialog({ cwd, resolving, purpose = "chat", onResolve, onClose }: ProjectTrustDialogProps) {
  const { t } = useLocale();
  const title = t(purpose === "package" ? "trust.enableTitle" : "trust.title");
  const body = t(purpose === "package" ? "trust.enableBody" : "trust.body");
  const deny = t(purpose === "package" ? "trust.enableDeny" : "trust.deny");
  const denyHint = t(purpose === "package" ? "trust.enableDenyHint" : "trust.denyHint");

  return (
    <MotionModal
      onClose={() => { if (!resolving) onClose(); }}
      closeOnOverlay={!resolving}
      panelStyle={{ width: 480, maxWidth: "100%", height: "auto", borderRadius: 8 }}
    >
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{title}</div>
      </div>
      <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>{body}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-dim)" }}>{t("trust.path")}</span>
          <code style={{ fontSize: 11, color: "var(--text)", wordBreak: "break-all" }}>{cwd}</code>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{denyHint}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 20px", borderTop: "1px solid var(--border)" }}>
        <button type="button" onClick={() => onResolve(false)} disabled={resolving} style={buttonStyle}>
          {deny}
        </button>
        <button
          type="button"
          onClick={() => onResolve(true)}
          disabled={resolving}
          style={{ ...buttonStyle, border: "none", background: "var(--accent)", color: "#fff", opacity: resolving ? 0.6 : 1 }}
        >
          {resolving ? t("trust.resolving") : t("trust.allow")}
        </button>
      </div>
    </MotionModal>
  );
}

const buttonStyle: CSSProperties = {
  height: 30,
  padding: "0 14px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 12,
};