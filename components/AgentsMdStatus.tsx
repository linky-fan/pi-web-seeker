"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { apiPath } from "@/lib/api-path";

interface AgentsMdReport {
  approxTokens?: number;
  warnings?: string[];
  errors?: string[];
}

interface AgentsMdProfile {
  projectName?: string;
  packageManager?: string;
  frameworks?: string[];
  languages?: string[];
  isEmpty?: boolean;
  metadataOnly?: boolean;
  evidence?: string[];
  commands?: Array<{ label: string; command: string; source?: string }>;
}

interface AgentsMdDraft {
  approxTokens?: number;
  template?: string;
  markdown?: string;
  warnings?: string[];
  questions?: string[];
  profile?: AgentsMdProfile;
}

interface AgentsMdStatusPayload {
  exists: boolean;
  filePath?: string;
  result?: AgentsMdReport | null;
}

type AgentsMdVariant = "classic" | "context";

const MAX_VISIBLE_AGENTS_MD_FINDINGS = 5;

export function AgentsMdStatus({ cwd, variant = "classic" }: { cwd: string; variant?: AgentsMdVariant }) {
  const { t } = useLocale();
  const isContextVariant = variant === "context";
  const [status, setStatus] = useState<AgentsMdStatusPayload | null>(null);
  const [busy, setBusy] = useState<"init" | "check" | "draft" | null>(null);
  const [draft, setDraft] = useState<AgentsMdDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`agents-md?cwd=${encodeURIComponent(cwd)}`));
      const data = await res.json() as AgentsMdStatusPayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load AGENTS.md status");
      setStatus({ exists: data.exists, filePath: data.filePath });
      setExpanded(!data.exists);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cwd]);

  useEffect(() => {
    setStatus(null);
    setDraft(null);
    setMessage(null);
    setError(null);
    setExpanded(false);
    void loadStatus();
  }, [loadStatus]);

  const postAgentsAction = useCallback(async (action: "init" | "check" | "draft") => {
    const res = await fetch(apiPath("agents-md"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, action, template: action === "init" ? "auto" : undefined }),
    });
    const data = await res.json() as {
      ok?: boolean;
      exists?: boolean;
      filePath?: string;
      result?: AgentsMdReport | AgentsMdDraft | null;
      error?: string;
      stderr?: string;
    };
    if (!res.ok || data.ok === false) throw new Error(data.stderr || data.error || "AGENTS.md action failed");
    return data;
  }, [cwd]);

  const runAction = useCallback(async (action: "init" | "check" | "draft") => {
    setBusy(action);
    setMessage(null);
    setError(null);
    try {
      const data = await postAgentsAction(action);
      if (action === "init") {
        setStatus({ exists: Boolean(data.exists), filePath: data.filePath });
        setDraft(null);
        setMessage(t("agentsMd.created"));
        setExpanded(false);
      } else if (action === "draft") {
        const nextDraft = data.result as AgentsMdDraft | null;
        setStatus((prev) => ({ exists: Boolean(data.exists ?? prev?.exists), filePath: data.filePath ?? prev?.filePath }));
        setDraft(nextDraft);
        setMessage(t("agentsMd.draftReady"));
        setExpanded(true);
      } else {
        const report = data.result as AgentsMdReport | null;
        const warnings = report?.warnings?.length ?? 0;
        const errors = report?.errors?.length ?? 0;
        setStatus({ exists: Boolean(data.exists), filePath: data.filePath, result: report });
        setDraft(null);
        if (warnings === 0 && errors === 0) {
          setMessage(t("agentsMd.clean"));
          setExpanded(false);
        } else {
          setMessage(t("agentsMd.summary", {
            tokens: report?.approxTokens ?? 0,
            warnings,
            errors,
          }));
          setExpanded(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [postAgentsAction, t]);

  const report = status?.result;
  const warnings = report?.warnings?.length ?? 0;
  const errors = report?.errors?.length ?? 0;
  const draftWarnings = draft?.warnings?.length ?? 0;
  const draftQuestions = draft?.questions?.length ?? 0;
  const visibleErrors = report?.errors?.slice(0, MAX_VISIBLE_AGENTS_MD_FINDINGS) ?? [];
  const visibleWarnings = report?.warnings?.slice(0, Math.max(0, MAX_VISIBLE_AGENTS_MD_FINDINGS - visibleErrors.length)) ?? [];
  const hiddenFindings = Math.max(0, errors + warnings - visibleErrors.length - visibleWarnings.length);
  const hasFindings = warnings > 0 || errors > 0;
  const hasDraftDetails = Boolean(draft?.markdown || draftWarnings > 0 || draftQuestions > 0 || draft?.profile);
  const shouldShow = Boolean(error || hasFindings || draft || status);
  const isMissing = Boolean(status && !status.exists);
  const isErrorTone = Boolean(error || errors > 0);
  const isWarningTone = warnings > 0 || draftWarnings > 0 || draftQuestions > 0;
  const summaryTone = isErrorTone ? "error" : isWarningTone ? "warning" : isMissing ? "missing" : draft ? "draft" : "ready";
  const showActions = isContextVariant || expanded || isMissing || isErrorTone || isWarningTone || Boolean(draft);
  const statusText = !status
    ? t("subagents.checking")
    : status.exists
      ? t(isContextVariant ? "agentsMd.readyShort" : "agentsMd.ready")
      : t(isContextVariant ? "agentsMd.missingShort" : "agentsMd.missing");
  const summary = draft
    ? t("agentsMd.draftSummary", { tokens: draft.approxTokens ?? 0, template: draft.template ?? "auto" })
    : hasFindings && isContextVariant
      ? t("agentsMd.issueShort")
      : report
        ? t("agentsMd.summary", { tokens: report.approxTokens ?? 0, warnings, errors })
        : message;
  const tone = error || errors > 0 ? "#ef4444" : warnings > 0 || draftWarnings > 0 || draftQuestions > 0 ? "rgba(234,179,8,0.98)" : status?.exists ? "#16a34a" : "var(--text-dim)";
  const profileBits = draft?.profile ? [
    draft.profile.projectName,
    draft.profile.packageManager,
    ...(draft.profile.frameworks ?? []),
    ...(draft.profile.languages ?? []),
  ].filter(Boolean) : [];
  const evidenceBits = draft?.profile?.evidence?.slice(0, 8) ?? [];
  const actionButtonStyle = isContextVariant ? undefined : {
    height: 20,
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--accent)",
    fontSize: 11,
    fontWeight: 650,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.7 : 1,
    whiteSpace: "nowrap",
  } as const;

  if (!shouldShow) return null;

  return (
    <div
      className={isContextVariant ? "pi-fluid-agents-status" : undefined}
      style={isContextVariant ? undefined : {
        margin: "0 52px 6px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        justifyContent: "flex-end",
      }}
    >
      {isContextVariant && <div className="pi-fluid-section-label">{t("agentsMd.sectionTitle")}</div>}
      <div
        className={isContextVariant ? "pi-fluid-agents-row" : undefined}
        data-tone={isContextVariant ? summaryTone : undefined}
        title={error ?? summary ?? statusText}
        style={isContextVariant ? undefined : {
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          maxWidth: "100%",
          color: error ? "#ef4444" : "var(--text-dim)",
          fontSize: 11,
          lineHeight: 1,
          opacity: 0.86,
          padding: "3px 7px",
          border: "1px solid var(--border)",
          borderRadius: 999,
          background: "var(--bg-panel)",
        }}
      >
        <span className={isContextVariant ? "pi-fluid-agents-dot" : undefined} style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          background: tone,
          flexShrink: 0,
          opacity: 0.75,
        }} />
        <button
          className={isContextVariant ? "pi-fluid-agents-title" : undefined}
          type="button"
          onClick={() => setExpanded((value) => !value)}
          style={isContextVariant ? undefined : {
            height: 20,
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 650,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          AGENTS.md
        </button>
        <span className={isContextVariant ? "pi-fluid-agents-copy" : undefined} style={isContextVariant ? undefined : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {error ?? summary ?? statusText}
        </span>
        {status && !status.exists && showActions && (
          <button
            className={isContextVariant ? "pi-fluid-agents-action" : undefined}
            type="button"
            onClick={() => void runAction("draft")}
            disabled={busy !== null}
            style={actionButtonStyle}
          >
            {busy === "draft" ? t("agentsMd.generating") : t("agentsMd.generate")}
          </button>
        )}
        {status?.exists && showActions && (
          <>
            <button
              className={isContextVariant ? "pi-fluid-agents-action" : undefined}
              type="button"
              onClick={() => void runAction("check")}
              disabled={busy !== null}
              style={actionButtonStyle}
            >
              {busy === "check" ? t("agentsMd.checking") : t("agentsMd.check")}
            </button>
            <button
              className={isContextVariant ? "pi-fluid-agents-action" : undefined}
              type="button"
              onClick={() => void runAction("draft")}
              disabled={busy !== null}
              style={actionButtonStyle}
            >
              {busy === "draft" ? t("agentsMd.generating") : t("agentsMd.suggest")}
            </button>
          </>
        )}
        {draft && status && !status.exists && showActions && (
          <button
            className={isContextVariant ? "pi-fluid-agents-action" : undefined}
            type="button"
            onClick={() => void runAction("init")}
            disabled={busy !== null}
            style={actionButtonStyle}
          >
            {busy === "init" ? t("agentsMd.writing") : t("agentsMd.write")}
          </button>
        )}
      </div>
      {expanded && (error || hasFindings || hasDraftDetails) && (
        <div
          className={isContextVariant ? "pi-fluid-agents-details" : undefined}
          style={isContextVariant ? undefined : {
            marginTop: 6,
            width: "min(560px, 100%)",
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: 11,
            lineHeight: 1.45,
            boxShadow: "0 8px 24px -18px rgba(15,23,42,0.24)",
          }}
        >
          {error && <div style={{ color: "#ef4444" }}>{error}</div>}
          {draft?.profile && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4, color: "var(--text-muted)", fontWeight: 650 }}>{t("agentsMd.profile")}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {profileBits.slice(0, 8).map((item) => (
                  <span key={String(item)} style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "2px 6px", background: "var(--bg)", color: "var(--text-dim)" }}>
                    {item}
                  </span>
                ))}
                {draft.profile.isEmpty && (
                  <span style={{ border: "1px solid rgba(234,179,8,0.35)", borderRadius: 999, padding: "2px 6px", color: "rgba(234,179,8,0.98)" }}>
                    {t("agentsMd.emptyProject")}
                  </span>
                )}
                {draft.profile.metadataOnly && (
                  <span style={{ border: "1px solid rgba(234,179,8,0.35)", borderRadius: 999, padding: "2px 6px", color: "rgba(234,179,8,0.98)" }}>
                    {t("agentsMd.metadataOnly")}
                  </span>
                )}
              </div>
              {evidenceBits.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
                  {t("agentsMd.evidence")}: {evidenceBits.join(", ")}
                </div>
              )}
            </div>
          )}
          {draft?.questions?.length ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4, color: "var(--text-muted)", fontWeight: 650 }}>{t("agentsMd.questions")}</div>
              {draft.questions.map((item, idx) => (
                <div key={`question:${idx}`} style={{ marginTop: 3 }}>- {item}</div>
              ))}
            </div>
          ) : null}
          {draft?.warnings?.length ? (
            <div style={{ marginBottom: 8 }}>
              {draft.warnings.map((item, idx) => (
                <div key={`draft-warning:${idx}`} style={{ marginTop: 3 }}>
                  {t("agentsMd.warningLabel")}: {item}
                </div>
              ))}
            </div>
          ) : null}
          {draft?.markdown && (
            <div>
              <div style={{ marginBottom: 4, color: "var(--text-muted)", fontWeight: 650 }}>{t("agentsMd.draft")}</div>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 260,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 9,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                }}
              >
                {draft.markdown}
              </pre>
            </div>
          )}
          {hasFindings && (
            <>
              <div style={{ marginBottom: 6, color: "var(--text-muted)" }}>{t("agentsMd.manualFixHint")}</div>
              {visibleErrors.map((item, idx) => (
                <div key={`error:${idx}`} style={{ color: "#ef4444", marginTop: 4 }}>
                  {t("agentsMd.errorLabel")}: {item}
                </div>
              ))}
              {visibleWarnings.map((item, idx) => (
                <div key={`warning:${idx}`} style={{ marginTop: 4 }}>
                  {t("agentsMd.warningLabel")}: {item}
                </div>
              ))}
              {hiddenFindings > 0 && (
                <div style={{ marginTop: 4, color: "var(--text-dim)" }}>
                  {t("agentsMd.moreFindings", { count: hiddenFindings })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
