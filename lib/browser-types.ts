export type BrowserPolicyMode = "confirm-sensitive" | "full-auto";

export type BrowserEventType =
  | "action_start"
  | "action_done"
  | "snapshot"
  | "approval_required"
  | "policy_changed"
  | "paused"
  | "error"
  | "closed";

export interface BrowserApproval {
  id: string;
  action: string;
  origin: string;
  target?: string;
  summary: string;
  createdAt: number;
}

export interface BrowserPolicy {
  mode: BrowserPolicyMode;
  trustedOrigins: string[];
}

export interface BrowserActionResult {
  action: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  url?: string;
  title?: string;
  targetId?: string;
}

export interface BrowserEvent {
  id: number;
  type: BrowserEventType;
  timestamp: number;
  action?: string;
  target?: string;
  summary?: string;
  durationMs?: number;
  revision?: number;
  approval?: BrowserApproval;
  result?: BrowserActionResult;
  error?: string;
  policy?: BrowserPolicy;
  paused?: boolean;
}

export interface BrowserSessionState {
  agentSessionId: string;
  opencliSession: string;
  status: "idle" | "running" | "paused" | "waiting-approval" | "error" | "closed";
  url: string;
  title: string;
  targetId?: string;
  previewRevision: number;
  previewAvailable: boolean;
  policy: BrowserPolicy;
  pendingApproval?: BrowserApproval;
  lastError?: string;
  updatedAt: number;
  events: BrowserEvent[];
}

export interface BrowserRuntimeStatus {
  available: boolean;
  binary: string;
  binarySource?: "override" | "path-native" | "npm-entry" | "system-path";
  version?: string;
  doctorOk: boolean;
  doctorOutput?: string;
  profileOk?: boolean;
  profileOutput?: string;
  error?: string;
  errorCode?:
    | "opencli_not_found"
    | "opencli_windows_shim_unresolved"
    | "opencli_launch_failed"
    | "opencli_doctor_failed"
    | "opencli_profile_failed";
  docker: boolean;
  localOnly: boolean;
  packageConfigured?: boolean;
  packageLoaded?: boolean;
  installCommand: string;
}

export type BrowserApprovalDecision = "allow_once" | "allow_origin" | "deny";
