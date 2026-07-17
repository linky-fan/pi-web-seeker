export type RemoteProtocol = "ssh" | "telnet";
export type RemoteDeviceMode = "auto" | "cisco" | "freebsd" | "linux" | "windows" | "network-generic" | "custom";
export type RemoteHostType = "unknown" | Exclude<RemoteDeviceMode, "auto">;
export type RemotePromptPreset = "unix" | "windows" | "cisco" | "network";
export type RemoteCommandMode = "exec" | "shell";
export type RemoteEncoding = "utf8" | "latin1" | "gb18030";
export type RemoteAuthMethod = "key" | "agent" | "password";
export type RemoteControlMode = "agent" | "manual";
export type RemotePolicyMode = "confirm-sensitive" | "full-auto";

export interface RemoteProfile {
  id: string;
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  authMethod: RemoteAuthMethod;
  keyPath?: string;
  deviceMode: RemoteDeviceMode;
  commandMode: RemoteCommandMode;
  /** Fixed built-in prompt matcher. User-supplied regular expressions are not supported. */
  promptPreset: RemotePromptPreset;
  /** Optional literal suffix used with the built-in prompt matcher. */
  promptText?: string;
  /** Optional literal pager marker. */
  pagerText?: string;
  /** A legacy regular-expression setting was ignored and must be replaced in the UI. */
  legacyPatternRejected?: boolean;
  loginPrompt?: string;
  passwordPrompt?: string;
  /** @deprecated legacy regex-only fields are retained for read compatibility and are never executed. */
  promptPattern?: string;
  /** @deprecated legacy regex-only fields are retained for read compatibility and are never executed. */
  pagerPattern?: string;
  pagerContinue?: string;
  encoding: RemoteEncoding;
  lineEnding: "lf" | "crlf";
  timeoutMs: number;
  telnetEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RemoteApprovalKind = "host-key" | "telnet" | "command" | "export";

export interface RemoteApproval {
  id: string;
  kind: RemoteApprovalKind;
  title: string;
  summary: string;
  fingerprint?: string;
  command?: string;
  createdAt: number;
}

export type RemoteApprovalDecision = "allow_once" | "trust" | "deny";

export interface RemoteCaptureSummary {
  id: string;
  agentSessionId: string;
  profileId: string;
  command: string;
  createdAt: number;
  byteCount: number;
  truncated: boolean;
  exitCode?: number;
  durationMs: number;
}

export interface RemoteCommandResult extends RemoteCaptureSummary {
  preview: string;
}

export type RemoteConnectionStatus =
  | "idle"
  | "connecting"
  | "waiting-approval"
  | "connected"
  | "running"
  | "paused"
  | "error"
  | "closed";

export interface RemoteConnectionState {
  agentSessionId: string;
  profileId?: string;
  profileName?: string;
  protocol?: RemoteProtocol;
  /** Configured or detected device type displayed to the user. */
  hostType?: RemoteHostType;
  hostTypeSource?: "configured" | "detected" | "fallback";
  /** Command-policy type. Auto-detection remains unknown until the user accepts it. */
  effectiveHostType?: RemoteHostType;
  status: RemoteConnectionStatus;
  controlMode: RemoteControlMode;
  policyMode: RemotePolicyMode;
  connectedAt?: number;
  updatedAt: number;
  lastError?: string;
  pendingApproval?: RemoteApproval;
  activeCommand?: string;
  captures: RemoteCaptureSummary[];
}

export type RemoteEventType =
  | "state"
  | "output"
  | "command_start"
  | "command_done"
  | "approval_required"
  | "control_changed"
  | "error"
  | "closed";

export interface RemoteEvent {
  id: number;
  type: RemoteEventType;
  timestamp: number;
  text?: string;
  summary?: string;
  approval?: RemoteApproval;
  result?: RemoteCommandResult;
  state?: RemoteConnectionState;
}

export interface RemoteCredentials {
  password?: string;
  passphrase?: string;
}
