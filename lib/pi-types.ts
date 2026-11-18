import type {
  AgentSessionEvent,
  PromptOptions,
  ExtensionCommandContextActions,
  ExtensionError,
  ExtensionUIContext,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ModelLike {
  id: string;
  provider: string;
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

export interface NavigateTreeOptions {
  summarize?: boolean;
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export interface ExtensionBindingsLike {
  uiContext?: ExtensionUIContext;
  mode?: "tui" | "rpc" | "json" | "print";
  commandContextActions?: ExtensionCommandContextActions;
  abortHandler?: () => void;
  shutdownHandler?: () => void;
  onError?: (error: ExtensionError) => void;
}

export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly autoCompactionEnabled: boolean;
  readonly autoRetryEnabled: boolean;
  readonly messages?: readonly unknown[];
  readonly pendingMessageCount?: number;
  readonly model: ModelLike | undefined;
  readonly systemPrompt: string;
  readonly modelRuntime: {
    getModel: (provider: string, modelId: string) => ModelLike | undefined;
    getAvailableSnapshot: () => readonly ModelLike[];
  };
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly agent: { state?: { systemPrompt?: string; thinkingLevel?: string }; waitForIdle?: () => Promise<void> };

  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: {
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    preflightResult?: PromptOptions["preflightResult"];
  }): Promise<void>;
  abort(): Promise<void>;
  setModel(model: ModelLike): Promise<void>;
  navigateTree(targetId: string, options?: NavigateTreeOptions): Promise<NavigateTreeResult>;
  setThinkingLevel(level: string): void;
  compact(customInstructions?: string): Promise<unknown>;
  setAutoCompactionEnabled(enabled: boolean): void;
  setAutoRetryEnabled(enabled: boolean): void;
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<unknown>;
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<unknown>;
  clearQueue?(): { steering: string[]; followUp: string[] };
  getSteeringMessages?(): readonly string[];
  getFollowUpMessages?(): readonly string[];
  readonly steeringMode?: "all" | "one-at-a-time";
  readonly followUpMode?: "all" | "one-at-a-time";
  bindExtensions?(bindings: ExtensionBindingsLike): Promise<void>;
  extensionRunner?: { setUIContext?: (uiContext: ExtensionUIContext, mode?: "rpc") => void };
  getAllTools(): ToolInfo[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
  abortCompaction(): void;
  getContextUsage(): ContextUsage | undefined;
  dispose?(): void;
  reload?(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
}
