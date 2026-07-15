"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { APP_NAME } from "@/lib/branding";
import { apiPath } from "@/lib/api-path";
import { useLocale } from "@/lib/i18n";

type TaskStatus = "done" | "running" | "error";

interface WorkspaceStatus {
  cwd: string;
  git: {
    isRepo: boolean;
    root: string | null;
    branch: string | null;
    changedFiles: number;
    insertions: number;
    deletions: number;
    binaryFiles: number;
  };
  githubCli: {
    available: boolean;
  };
}

interface FluidEnvironmentPanelProps {
  cwd: string | null;
  workspaceLabel: string;
  sessionTitle: string;
  displayTitle: string;
  taskStatus: TaskStatus;
  sessionStats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null;
  contextUsage: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  refreshKey: number;
  onOpenFilePanel: () => void;
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return value.toLocaleString();
}

function IconFrame({ children }: { children: ReactNode }) {
  return <span className="pi-fluid-env-icon" aria-hidden="true">{children}</span>;
}

function InfoRow({
  icon,
  label,
  value,
  muted,
  title,
}: {
  icon: ReactNode;
  label: ReactNode;
  value?: ReactNode;
  muted?: boolean;
  title?: string;
}) {
  return (
    <div className={`pi-fluid-env-row${muted ? " pi-fluid-env-row-muted" : ""}`} title={title}>
      <IconFrame>{icon}</IconFrame>
      <div className="pi-fluid-env-row-main">
        <div className="pi-fluid-env-row-title">{label}</div>
        {value ? <div className="pi-fluid-env-row-value">{value}</div> : null}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pi-fluid-env-section">
      <div className="pi-fluid-env-section-title">{label}</div>
      <div className="pi-fluid-env-section-body">{children}</div>
    </section>
  );
}

function ChangesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h3" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v9A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5z" />
      <path d="M8 21h8" />
      <path d="M12 18v3" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2.3" />
      <circle cx="18" cy="6" r="2.3" />
      <circle cx="6" cy="19" r="2.3" />
      <path d="M6 7.3v9.4" />
      <path d="M8.3 5.2c4.6.5 6.8 1.2 7.8 3.1" />
      <path d="M16.1 8.3c-1 2.5-3.2 3.6-7.8 4.2" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5a9.5 9.5 0 0 0-3 18.52c.48.09.66-.2.66-.46v-1.62c-2.7.58-3.26-1.16-3.26-1.16-.44-1.12-1.08-1.42-1.08-1.42-.88-.6.07-.59.07-.59.98.07 1.49 1 1.49 1 .86 1.47 2.26 1.05 2.81.8.09-.63.34-1.05.62-1.29-2.15-.24-4.41-1.08-4.41-4.78 0-1.06.38-1.92 1-2.6-.1-.25-.43-1.23.1-2.56 0 0 .82-.26 2.69 1a9.2 9.2 0 0 1 4.9 0c1.87-1.26 2.69-1 2.69-1 .53 1.33.2 2.31.1 2.56.63.68 1 1.54 1 2.6 0 3.72-2.27 4.54-4.43 4.78.35.3.66.9.66 1.81v2.69c0 .26.18.56.67.46A9.5 9.5 0 0 0 12 2.5Z" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="m4 6 1 1 2-2" />
      <path d="m4 12 1 1 2-2" />
      <path d="m4 18 1 1 2-2" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="m8 10 2.4 2L8 14" />
      <path d="M13 14h3" />
    </svg>
  );
}

function BrowserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="M3.5 9h17" />
      <path d="M8 7h.01" />
      <path d="M11 7h.01" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 14h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

export function FluidEnvironmentPanel({
  cwd,
  workspaceLabel,
  sessionTitle,
  displayTitle,
  taskStatus,
  sessionStats,
  contextUsage,
  refreshKey,
  onOpenFilePanel,
}: FluidEnvironmentPanelProps) {
  const { t } = useLocale();
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserHost, setBrowserHost] = useState("");

  useEffect(() => {
    setBrowserHost(window.location.host);
  }, []);

  useEffect(() => {
    if (!cwd) {
      setStatus(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(apiPath(`workspaces/status?cwd=${encodeURIComponent(cwd)}`), { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({})) as WorkspaceStatus & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setStatus(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setStatus(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cwd, refreshKey]);

  const statsSummary = useMemo(() => {
    const metrics: Array<{ key: string; label: string; value: string; tone?: "accent" | "warning" | "danger"; title?: string }> = [];
    const tooltipParts: string[] = [];
    const tokens = sessionStats?.tokens;
    if (tokens && (tokens.input > 0 || tokens.output > 0 || tokens.cacheRead > 0)) {
      if (tokens.input > 0) metrics.push({ key: "input", label: "IN", value: compactNumber(tokens.input), title: `${t("stats.input")}: ${tokens.input.toLocaleString()}` });
      if (tokens.output > 0) metrics.push({ key: "output", label: "OUT", value: compactNumber(tokens.output), title: `${t("stats.output")}: ${tokens.output.toLocaleString()}` });
      if (tokens.cacheRead > 0) metrics.push({ key: "cache", label: "CACHE", value: compactNumber(tokens.cacheRead), tone: "accent", title: `${t("stats.cacheRead")}: ${tokens.cacheRead.toLocaleString()}` });
      tooltipParts.push(`${t("stats.input")}: ${tokens.input.toLocaleString()}`);
      tooltipParts.push(`${t("stats.output")}: ${tokens.output.toLocaleString()}`);
      tooltipParts.push(`${t("stats.cacheRead")}: ${tokens.cacheRead.toLocaleString()}`);
      tooltipParts.push(`${t("stats.cacheWrite")}: ${tokens.cacheWrite.toLocaleString()}`);
    }
    if (sessionStats?.cost) {
      const value = sessionStats.cost >= 0.01 ? `$${sessionStats.cost.toFixed(2)}` : "<$0.01";
      metrics.push({ key: "cost", label: "COST", value, title: `${t("stats.cost")}: $${sessionStats.cost.toFixed(4)}` });
      tooltipParts.push(`${t("stats.cost")}: $${sessionStats.cost.toFixed(4)}`);
    }
    if (contextUsage?.contextWindow) {
      const pct = contextUsage.percent !== null ? `${contextUsage.percent.toFixed(0)}%` : "?";
      const tone = contextUsage.percent !== null && contextUsage.percent > 90
        ? "danger"
        : contextUsage.percent !== null && contextUsage.percent > 70
          ? "warning"
          : undefined;
      metrics.push({
        key: "context",
        label: "CTX",
        value: `${pct} / ${compactNumber(contextUsage.contextWindow)}`,
        tone,
        title: `${t("stats.context")}: ${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : t("stats.unknown")} / ${contextUsage.contextWindow.toLocaleString()}`,
      });
      tooltipParts.push(`${t("stats.context")}: ${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : t("stats.unknown")} / ${contextUsage.contextWindow.toLocaleString()}`);
    }
    if (metrics.length === 0) return null;
    const tooltip = tooltipParts.join("  |  ");
    return (
      <span className="pi-fluid-env-metrics" title={tooltip}>
        {metrics.map((metric) => (
          <span
            key={metric.key}
            className={`pi-fluid-metric pi-fluid-env-metric${metric.tone ? ` pi-fluid-metric-${metric.tone}` : ""}`}
            data-kind={metric.key}
            title={metric.title}
          >
            <span className="pi-fluid-metric-label">{metric.label}</span>
            <span className="pi-fluid-metric-value">{metric.value}</span>
          </span>
        ))}
      </span>
    );
  }, [contextUsage, sessionStats, t]);

  const git = status?.git ?? null;
  const hasChanges = Boolean(git?.changedFiles || git?.insertions || git?.deletions || git?.binaryFiles);
  const changeValue = !cwd
    ? t("fluidEnv.noWorkspace")
    : loading
      ? t("fluidEnv.loading")
      : error
        ? t("fluidEnv.unavailable")
        : git && !git.isRepo
          ? t("fluidEnv.notGit")
          : hasChanges
            ? t("fluidEnv.changedFiles", { count: git?.changedFiles ?? 0 })
            : t("fluidEnv.clean");

  const branchLabel = !cwd
    ? t("fluidEnv.noWorkspace")
    : loading
      ? t("fluidEnv.loading")
      : error
        ? t("fluidEnv.unavailable")
        : git?.isRepo
          ? git.branch ?? t("fluidEnv.detached")
          : t("fluidEnv.notGit");

  return (
    <aside className="pi-fluid-env-panel" aria-label={t("fluidEnv.title")}>
      <div className="pi-fluid-env-header">
        <div className="pi-fluid-env-heading">{t("fluidEnv.title")}</div>
        <button
          type="button"
          className="pi-fluid-env-open-panel"
          onClick={onOpenFilePanel}
          title={t("fluidEnv.openFilePanel")}
          aria-label={t("fluidEnv.openFilePanel")}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="pi-fluid-env-primary">
        <InfoRow
          icon={<ChangesIcon />}
          label={t("fluidEnv.changes")}
          value={(
            <span className="pi-fluid-env-change-line">
              <span>{changeValue}</span>
              {git?.isRepo && hasChanges ? (
                <span className="pi-fluid-env-deltas" aria-label={t("fluidEnv.diffSummary", { insertions: git.insertions, deletions: git.deletions })}>
                  <span className="pi-fluid-env-delta-add">+{git.insertions.toLocaleString()}</span>
                  <span className="pi-fluid-env-delta-del">-{git.deletions.toLocaleString()}</span>
                </span>
              ) : null}
            </span>
          )}
        />
        <InfoRow
          icon={<WorkspaceIcon />}
          label={workspaceLabel}
          value={cwd ?? t("fluidEnv.noWorkspace")}
          title={cwd ?? undefined}
        />
        <InfoRow
          icon={<BranchIcon />}
          label={branchLabel}
          value={git?.root ?? undefined}
          muted={!git?.isRepo}
          title={git?.root ?? undefined}
        />
        <InfoRow
          icon={<GithubIcon />}
          label={status?.githubCli.available ? t("fluidEnv.githubReady") : t("fluidEnv.githubUnavailable")}
          muted={!status?.githubCli.available}
        />
      </div>

      <Section label={t("fluidEnv.plan")}>
        <InfoRow
          icon={<PlanIcon />}
          label={displayTitle}
          value={statsSummary || t("fluidEnv.noStats")}
          title={sessionTitle}
        />
      </Section>

      <Section label={t("fluidEnv.tasks")}>
        <InfoRow
          icon={<TaskIcon />}
          label={t("fluidEnv.agent")}
          value={t(`fluidEnv.status.${taskStatus}`)}
        />
      </Section>

      <Section label={t("fluidEnv.browser")}>
        <InfoRow
          icon={<BrowserIcon />}
          label={APP_NAME}
          value={browserHost || t("fluidEnv.browserPending")}
        />
      </Section>

      <Section label={t("fluidEnv.sources")}>
        <InfoRow
          icon={<SourceIcon />}
          label={t("fluidEnv.noSources")}
          muted
        />
      </Section>
    </aside>
  );
}
