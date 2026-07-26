import { useEffect, useRef, useState } from "react";
import type { AssistantContentBlock } from "@/lib/types";

export function useStreamingDurations(blocks: AssistantContentBlock[], isStreaming?: boolean) {
  const blocksRef = useRef(blocks);
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [durations, setDurations] = useState<Map<number, number>>(new Map());
  blocksRef.current = blocks;

  useEffect(() => {
    if (!isStreaming) {
      const now = Date.now();
      setDurations((previous) => {
        let changed = false;
        const next = new Map(previous);
        for (const [index, start] of blockStartTimesRef.current) {
          if (!next.has(index)) {
            next.set(index, Math.round((now - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : previous;
      });
      return;
    }

    const tick = () => {
      const currentBlocks = blocksRef.current;
      const now = Date.now();
      currentBlocks.forEach((_, index) => {
        if (!blockStartTimesRef.current.has(index)) blockStartTimesRef.current.set(index, now);
      });
      setDurations((previous) => {
        let changed = false;
        const next = new Map(previous);
        for (let index = 0; index < currentBlocks.length - 1; index += 1) {
          if (next.has(index) || !blockStartTimesRef.current.has(index)) continue;
          const start = blockStartTimesRef.current.get(index)!;
          const nextStart = blockStartTimesRef.current.get(index + 1) ?? now;
          next.set(index, Math.round((nextStart - start) / 1000));
          changed = true;
        }
        return changed ? next : previous;
      });
    };

    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  return durations;
}
