"use client";

import { memo, type RefObject } from "react";
import { FluidSessionTypewriter } from "../BrandTypewriter";
import { useLocale } from "@/lib/i18n";
import type { SessionInfo } from "@/lib/types";
import { TASK_STATUS_META } from "./helpers";
import type { ComposerActivity } from "../ChatInput";
import type { FluidMetric, TaskStatus } from "./types";

interface Props {
  topBarRef: RefObject<HTMLDivElement | null>;
  workspaceCwd: string | null;
  workspaceLabel: string;
  sessionTitle: string;
  displayTitle: string;
  selectedSession: SessionInfo | null;
  taskStatus: TaskStatus;
  composerActivity: ComposerActivity;
  metrics: FluidMetric[];
  statsTooltip?: string;
}

export const FluidWorkspaceHeader = memo(function FluidWorkspaceHeader({
  topBarRef, workspaceCwd, workspaceLabel, sessionTitle, displayTitle, selectedSession,
  taskStatus, composerActivity, metrics, statsTooltip,
}: Props) {
  const { t } = useLocale();
  return <div ref={topBarRef} className="pi-fluid-workspace-header">
    <div className="pi-fluid-workspace-status" title={workspaceCwd ?? undefined}>
      <span className={`pi-fluid-status-dot pi-fluid-status-${taskStatus}`} aria-label={TASK_STATUS_META[taskStatus].label} />
      <span className="pi-fluid-workspace-project-wrap" title={workspaceCwd ?? undefined} aria-label={workspaceCwd ? t("fluidHeader.cwdLabel", { path: workspaceCwd }) : workspaceLabel} tabIndex={workspaceCwd ? 0 : undefined}>
        <span className="pi-fluid-workspace-project" title={workspaceCwd ?? undefined} aria-label={workspaceCwd ? t("fluidHeader.cwdLabel", { path: workspaceCwd }) : workspaceLabel}>{workspaceLabel}</span>
        {workspaceCwd && <span className="pi-fluid-workspace-path-tooltip" role="tooltip" aria-hidden="true">{workspaceCwd}</span>}
      </span>
    </div>
    <div className="pi-fluid-workspace-title"><div className="pi-fluid-workspace-title-line">
      <span className="pi-fluid-workspace-name" title={sessionTitle} aria-label={`Session: ${sessionTitle}`}>{displayTitle}</span>
      {selectedSession && <FluidSessionTypewriter active={taskStatus === "done" && !composerActivity.focused && !composerActivity.hasDraft} resetKey={selectedSession.id} />}
    </div></div>
    <div className="pi-fluid-workspace-meta" title={statsTooltip}>
      {metrics.map((metric) => <span key={metric.key} className={`pi-fluid-metric${metric.tone ? ` pi-fluid-metric-${metric.tone}` : ""}`} data-kind={metric.key} title={metric.title ?? statsTooltip}><span className="pi-fluid-metric-label">{metric.label}</span><span className="pi-fluid-metric-value">{metric.value}</span></span>)}
      {metrics.length === 0 && <span className="pi-fluid-meta-fallback">{selectedSession ? `${selectedSession.messageCount} messages` : "Ready"}</span>}
    </div>
  </div>;
});
