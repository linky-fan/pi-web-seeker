import { useCallback, useEffect, useRef } from "react";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX, shouldFollowScroll } from "./helpers";
import type { StreamingState } from "./types";

export function useScrollController({
  identity,
  messageCount,
  agentRunning,
  agentRunningRef,
  streamState,
}: {
  identity: string;
  messageCount: number;
  agentRunning: boolean;
  agentRunningRef: React.MutableRefObject<boolean>;
  streamState: StreamingState;
}) {
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowOutputRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior, block: "end" }));
  }, []);

  const distanceFromBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    const anchor = messagesEndRef.current;
    if (!anchor) return container.scrollHeight - container.scrollTop - container.clientHeight;
    return anchor.getBoundingClientRect().bottom - container.getBoundingClientRect().bottom;
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const element = lastUserMsgRef.current;
    if (!container || !element) return;
    const absoluteTop = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: absoluteTop - 16, behavior: "smooth" });
  }, []);

  const hasMessages = messageCount > 0;
  useEffect(() => {
    initialScrollDoneRef.current = false;
    pendingScrollToUserRef.current = false;
    shouldFollowOutputRef.current = true;
  }, [identity]);

  useEffect(() => {
    if (!messageCount) return;
    if (pendingScrollToUserRef.current) {
      pendingScrollToUserRef.current = false;
      initialScrollDoneRef.current = true;
      shouldFollowOutputRef.current = true;
      scrollUserMsgToTop();
    } else if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      shouldFollowOutputRef.current = true;
      scrollToBottom("instant");
    } else if (!agentRunningRef.current) {
      shouldFollowOutputRef.current = true;
      scrollToBottom("smooth");
    }
  }, [agentRunning, agentRunningRef, messageCount, scrollToBottom, scrollUserMsgToTop]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const updateShouldFollow = () => {
      shouldFollowOutputRef.current = shouldFollowScroll(distanceFromBottom());
    };
    updateShouldFollow();
    container.addEventListener("scroll", updateShouldFollow, { passive: true });
    return () => container.removeEventListener("scroll", updateShouldFollow);
  }, [distanceFromBottom, hasMessages]);

  useEffect(() => {
    if (!streamState.isStreaming || !streamState.streamingMessage || !shouldFollowOutputRef.current) return;
    scrollToBottom("auto");
  }, [scrollToBottom, streamState.isStreaming, streamState.streamingMessage]);

  return {
    messagesEndRef, scrollContainerRef, lastUserMsgRef, pendingScrollToUserRef,
    initialScrollDoneRef, shouldFollowOutputRef,
    isNearBottom: () => distanceFromBottom() <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  };
}
