type HistoricalComparable = {
  messages: unknown;
  entryIds: unknown;
  projection: unknown;
  scrollRoot: unknown;
  messageRefs: unknown;
  lastUserMsgRef: unknown;
  runningToolIds: unknown;
  toolExecutionStatuses: unknown;
  modelNames: unknown;
  agentRunning: boolean;
  isNew: boolean;
  forkingEntryId: string | null;
  onFork: unknown;
  onNavigate: unknown;
  onEditContent: unknown;
};

type ComposerComparable = {
  empty: boolean;
  isFluid: boolean;
  activeCwd: string | null;
  inputRef?: unknown;
  inputProps: unknown;
  aboveWidgets: unknown;
  belowWidgets: unknown;
};

type ExtensionComparable = {
  statuses: unknown;
  notices: unknown;
  dialog: unknown;
  customUi: unknown;
  onRespond: unknown;
  onCustomInput: unknown;
};

export function areHistoricalTimelinePropsEqual(previous: HistoricalComparable, next: HistoricalComparable): boolean {
  return previous.messages === next.messages
    && previous.entryIds === next.entryIds
    && previous.projection === next.projection
    && previous.scrollRoot === next.scrollRoot
    && previous.messageRefs === next.messageRefs
    && previous.lastUserMsgRef === next.lastUserMsgRef
    && previous.runningToolIds === next.runningToolIds
    && previous.toolExecutionStatuses === next.toolExecutionStatuses
    && previous.modelNames === next.modelNames
    && previous.agentRunning === next.agentRunning
    && previous.isNew === next.isNew
    && previous.forkingEntryId === next.forkingEntryId
    && previous.onFork === next.onFork
    && previous.onNavigate === next.onNavigate
    && previous.onEditContent === next.onEditContent;
}

export function areComposerSurfacePropsEqual(previous: ComposerComparable, next: ComposerComparable): boolean {
  return previous.empty === next.empty
    && previous.isFluid === next.isFluid
    && previous.activeCwd === next.activeCwd
    && previous.inputRef === next.inputRef
    && previous.inputProps === next.inputProps
    && previous.aboveWidgets === next.aboveWidgets
    && previous.belowWidgets === next.belowWidgets;
}

export function areExtensionLayerPropsEqual(previous: ExtensionComparable, next: ExtensionComparable): boolean {
  return previous.statuses === next.statuses
    && previous.notices === next.notices
    && previous.dialog === next.dialog
    && previous.customUi === next.customUi
    && previous.onRespond === next.onRespond
    && previous.onCustomInput === next.onCustomInput;
}
