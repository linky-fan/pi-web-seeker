"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, type KeyboardEvent } from "react";
import { useLocale } from "@/lib/i18n";
import { popOnce, revealChildren, revealElement } from "@/lib/motion";
import { useUiMode } from "@/hooks/useUiMode";
import { ComposerEditor } from "./chat-input/ComposerEditor";
import { ComposerPrimaryControls } from "./chat-input/ComposerPrimaryControls";
import { ComposerRuntimeControls } from "./chat-input/ComposerRuntimeControls";
import { ComposerStatus } from "./chat-input/ComposerStatus";
import { buildModelGroups } from "./chat-input/helpers";
import { useComposerDraftController } from "./chat-input/useComposerDraftController";
import { useComposerMenusController } from "./chat-input/useComposerMenusController";
import { useComposerSuggestionsController } from "./chat-input/useComposerSuggestionsController";
import type { ChatInputHandle, ChatInputProps } from "./chat-input/types";

export type { AttachedImage, ChatInputHandle, ComposerActivity } from "./chat-input/types";

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(props, ref) {
  const { t } = useLocale();
  const { isFluid } = useUiMode();
  const imageInputId = useId();
  const inputShellRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const streamActionsRef = useRef<HTMLDivElement>(null);
  const previousCanSendRef = useRef(false);

  const draft = useComposerDraftController({
    onSend: props.onSend,
    onSteer: props.onSteer,
    onFollowUp: props.onFollowUp,
    isStreaming: props.isStreaming,
    promptHistory: props.promptHistory ?? [],
    draftStorageKey: props.draftStorageKey,
    onActivityChange: props.onActivityChange,
  });

  const suggestions = useComposerSuggestionsController({
    textareaRef: draft.textareaRef,
    cwd: props.cwd,
    isStreaming: props.isStreaming,
    planMode: props.planMode ?? "normal",
    planExecutionMode: props.planExecutionMode ?? "main",
    planModeStatus: props.planModeStatus,
    onPlanModeChange: props.onPlanModeChange,
    buddyMode: props.buddyMode ?? "off",
    buddyReviewerModel: props.buddyReviewerModel,
    onBuddyModeChange: props.onBuddyModeChange,
    setInputValue: draft.setInputValue,
    t,
  });

  const { setMentionOpen, setSlashOpen } = suggestions;
  const closeMention = useCallback(() => setMentionOpen(false), [setMentionOpen]);
  const closeSlash = useCallback(() => setSlashOpen(false), [setSlashOpen]);
  const menus = useComposerMenusController({
    textareaRef: draft.textareaRef,
    mentionPanelRef: suggestions.mentionPanelRef,
    slashPanelRef: suggestions.slashPanelRef,
    closeMention,
    closeSlash,
  });

  useImperativeHandle(ref, () => draft.imperativeHandle, [draft.imperativeHandle]);

  const modelData = useMemo(() => buildModelGroups(
    props.modelList,
    props.modelNames,
    props.model?.provider ?? "unknown",
  ), [props.model?.provider, props.modelList, props.modelNames]);

  const currentName = props.model
    ? modelData.options.find((option) => option.modelId === props.model?.modelId && option.provider === props.model?.provider)?.name ?? props.model.modelId
    : modelData.options[0]?.name ?? null;
  const reviewerName = props.buddyReviewerModel
    ? modelData.options.find((option) => option.provider === props.buddyReviewerModel?.provider && option.modelId === props.buddyReviewerModel?.modelId)?.name ?? props.buddyReviewerModel.modelId
    : null;

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.handleSuggestionKeyDown(event)) return;
    const plainArrow = (event.key === "ArrowUp" || event.key === "ArrowDown")
      && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (plainArrow) {
      const textarea = event.currentTarget;
      const handled = draft.browseHistory(
        event.key as "ArrowUp" | "ArrowDown",
        textarea.selectionStart === 0 && textarea.selectionEnd === 0,
        textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length,
      );
      if (handled) event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (props.isStreaming && (props.onSteer || props.onFollowUp)) {
        draft.sendQueued(props.onSteer ? "steer" : "followup");
      } else {
        void draft.handleSend();
      }
    }
  }, [draft, props.isStreaming, props.onFollowUp, props.onSteer, suggestions]);

  const handleInput = useCallback(() => {
    draft.resizeTextarea();
    draft.resetHistoryNavigation();
    const textarea = draft.textareaRef.current;
    if (!textarea) return;
    suggestions.updateSlashState(textarea.value, textarea.selectionStart);
    suggestions.updateMentionState(textarea.value, textarea.selectionStart);
  }, [draft, suggestions]);

  useEffect(() => {
    const shellTween = revealElement(inputShellRef.current, { y: 4, duration: 0.2 });
    const controlsTween = revealChildren(bottomBarRef.current, "[data-motion-control]", { y: 3, limit: 8, stagger: 0.02, duration: 0.18 });
    return () => {
      shellTween?.kill();
      controlsTween?.kill();
    };
  }, []);

  useEffect(() => {
    if (draft.canSend && !previousCanSendRef.current) popOnce(sendButtonRef.current);
    previousCanSendRef.current = draft.canSend;
  }, [draft.canSend]);

  useEffect(() => {
    if (!props.isStreaming) return;
    const tween = revealElement(streamActionsRef.current, { y: 3, duration: 0.18 });
    return () => { tween?.kill(); };
  }, [props.isStreaming]);

  return (
    <div
      className={isFluid ? "pi-fluid-composer-wrap" : "pi-composer-wrap"}
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: isFluid ? "0 18px 28px" : "0 16px 8px",
        paddingRight: isFluid ? 18 : 52,
      }}
    >
      <input
        id={imageInputId}
        ref={draft.fileInputRef}
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        style={{ position: "fixed", left: -10000, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onChange={(event) => {
          void draft.processImageFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <div className={isFluid ? "pi-fluid-composer-inner pi-fluid-composer-panel" : "pi-composer-inner"} style={{ maxWidth: 820, margin: "0 auto" }}>
        <ComposerStatus retryInfo={props.retryInfo} attachedImages={draft.attachedImages} onRemoveImage={draft.removeImage} t={t} />
        <ComposerEditor
          inputShellRef={inputShellRef}
          sendButtonRef={sendButtonRef}
          streamActionsRef={streamActionsRef}
          textareaRef={draft.textareaRef}
          suggestions={suggestions}
          value={draft.value}
          canSend={draft.canSend}
          isStreaming={props.isStreaming}
          canSteer={Boolean(props.onSteer)}
          canFollowUp={Boolean(props.onFollowUp)}
          onFocusChange={draft.setFocused}
          onValueChange={draft.setValue}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={draft.handlePaste}
          onSend={() => { void draft.handleSend(); }}
          onSendQueued={draft.sendQueued}
          t={t}
        />
        <div ref={bottomBarRef} className="pi-command-controls" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", rowGap: 6 }}>
          <ComposerPrimaryControls
            imageInputId={imageInputId}
            attachmentCount={draft.attachedImages.length}
            isStreaming={props.isStreaming}
            model={props.model}
            modelOptions={modelData.options}
            modelGroups={modelData.groups}
            currentName={currentName}
            onModelChange={props.onModelChange}
            buddyMode={props.buddyMode ?? "off"}
            planMode={props.planMode ?? "normal"}
            planExecutionMode={props.planExecutionMode ?? "main"}
            onPlanModeChange={props.onPlanModeChange}
            onBuddyModeChange={props.onBuddyModeChange}
            buddyReviewerModel={props.buddyReviewerModel}
            reviewerName={reviewerName}
            onBuddyReviewerChange={props.onBuddyReviewerChange}
            onInsertSnippet={draft.insertSnippet}
            menus={menus}
            t={t}
          />
          <div style={{ flex: "1 1 24px", minWidth: 0 }} />
          <ComposerRuntimeControls
            menus={menus}
            isStreaming={props.isStreaming}
            onAbort={props.onAbort}
            model={props.model}
            thinkingLevel={props.thinkingLevel}
            onThinkingLevelChange={props.onThinkingLevelChange}
            availableThinkingLevels={props.availableThinkingLevels}
            thinkingLevelMap={props.thinkingLevelMap}
            onCompact={props.onCompact}
            onAbortCompaction={props.onAbortCompaction}
            isCompacting={props.isCompacting}
            compactError={props.compactError}
            contextUsage={props.contextUsage}
            soundEnabled={props.soundEnabled}
            onSoundToggle={props.onSoundToggle}
            t={t}
          />
        </div>
      </div>
    </div>
  );
});
