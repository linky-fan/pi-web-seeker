import type {
  AgentMessage,
  ToolExecutionStatus,
  ToolResultMessage,
} from "@/lib/types";

export interface ComsNetResponseHint {
  peer: string;
  msgId?: string;
}

export interface MessageViewProps {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  runningToolIds?: Set<string>;
  toolExecutionStatuses?: Map<string, ToolExecutionStatus>;
  modelNames?: Record<string, string>;
  comsNetResponse?: ComsNetResponseHint;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  nextTimestamp?: number;
}

export type ComsNetDirection = "inbound" | "outbound" | "response-in" | "response-out";

export interface ComsNetEvent {
  direction: ComsNetDirection;
  title: string;
  peer: string;
  prompt?: string;
  response?: string;
  msgId?: string;
  status?: string;
  error?: string | null;
}
