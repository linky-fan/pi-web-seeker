import type { SessionInfo } from "@/lib/types";

export interface WorkspaceSelectionTransition {
  selectedSession: SessionInfo | null;
  newSessionCwd: string | null;
  shouldReset: boolean;
}

export function reconcileWorkspaceSelection(
  selectedSession: SessionInfo | null,
  newSessionCwd: string | null,
  cwd: string | null,
  suppressed = false,
): WorkspaceSelectionTransition {
  if (!cwd || suppressed || selectedSession?.cwd === cwd) {
    return { selectedSession, newSessionCwd, shouldReset: false };
  }
  return {
    selectedSession: selectedSession && selectedSession.cwd !== cwd ? null : selectedSession,
    newSessionCwd: newSessionCwd && newSessionCwd !== cwd ? null : newSessionCwd,
    shouldReset: true,
  };
}

export function sessionUrl(sessionId: string | null): string {
  return sessionId ? `?session=${encodeURIComponent(sessionId)}` : "/";
}
