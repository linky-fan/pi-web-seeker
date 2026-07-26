"use client";

import { memo, useEffect, useRef, useState } from "react";

interface StreamingMetricsProps {
  estimatedChars: number;
  isStreaming?: boolean;
}

function StreamingMetricsImpl({ estimatedChars, isStreaming }: StreamingMetricsProps) {
  const [tps, setTps] = useState<number | null>(null);
  const streamStartRef = useRef<number | null>(null);
  const estimatedCharsRef = useRef(estimatedChars);
  estimatedCharsRef.current = estimatedChars;

  useEffect(() => {
    if (!isStreaming) {
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const chars = estimatedCharsRef.current;
      if (chars === 0) return;
      const now = Date.now();
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  if (!isStreaming) return null;
  const estimatedTokens = Math.round(estimatedChars / 4);
  if (estimatedTokens <= 0) return null;
  const background = tps === null
    ? null
    : tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f";

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }} title="预估 token 数（流式接收中）">
      <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 400 }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="1.5" x2="5" y2="8.5" />
          <polyline points="2 6 5 8.5 8 6" />
        </svg>
        {estimatedTokens}
      </span>
      {tps !== null && background && (
        <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background, color: "#fff", fontSize: 11, fontWeight: 400 }}>
          {tps.toFixed(1)} t/s
        </span>
      )}
    </span>
  );
}

export const StreamingMetrics = memo(StreamingMetricsImpl);
