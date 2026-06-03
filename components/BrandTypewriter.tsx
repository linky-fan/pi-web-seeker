"use client";

import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/branding";

const TYPEWRITER_PHRASES = [
  "ready when you are.",
  "ask me anything.",
  "let's build something cool.",
  "explore your codebase.",
  "draft an email.",
  "summarize that paper.",
  "plan your weekend.",
  "explain it like I'm five.",
  "pair-program with me.",
  "fix that pesky bug.",
  "translate to 中文.",
  "write a haiku.",
  "brainstorm ideas.",
  "review my pull request.",
  "what should we cook tonight?",
  "ship it.",
  "make it pretty.",
  "rubber-duck with me.",
  "war never changes.",
  "the cake is a lie.",
  "finish the fight.",
  "praise the sun.",
  "stay awhile and listen.",
  "would you kindly?",
  "quest accepted.",
  "checkpoint saved.",
  "inventory full of ideas.",
  "new branch unlocked.",
];

function Typewriter() {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  useEffect(() => {
    setPhraseIdx(Math.floor(Math.random() * TYPEWRITER_PHRASES.length));
  }, []);

  useEffect(() => {
    const blink = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    const current = TYPEWRITER_PHRASES[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;
    if (!deleting && text === current) {
      timeout = setTimeout(() => setDeleting(true), 1800);
    } else if (deleting && text === "") {
      setDeleting(false);
      setPhraseIdx((i) => (i + 1) % TYPEWRITER_PHRASES.length);
    } else {
      const next = deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1);
      timeout = setTimeout(() => setText(next), deleting ? 28 : 55);
    }
    return () => clearTimeout(timeout);
  }, [text, deleting, phraseIdx]);

  return (
    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
      {text}
      <span style={{ opacity: caretOn ? 1 : 0, color: "var(--accent)", marginLeft: 1 }}>▍</span>
    </span>
  );
}

export function BrandTypewriterHeader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontFamily: "var(--font-mono)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, lineHeight: 1.4 }}>
        <span
          aria-hidden="true"
          style={{
            display: "grid",
            placeItems: "center",
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "color-mix(in srgb, var(--accent) 14%, var(--bg))",
            border: "1px solid color-mix(in srgb, var(--accent) 34%, var(--border))",
            color: "var(--accent)",
            fontSize: 23,
            fontWeight: 800,
            lineHeight: 1,
            boxShadow: "0 8px 22px color-mix(in srgb, var(--accent) 12%, transparent)",
            flexShrink: 0,
          }}
        >
          π
        </span>
        <span style={{ fontSize: 22, color: "var(--text)", fontWeight: 800, letterSpacing: 0, whiteSpace: "nowrap" }}>{APP_NAME}</span>
        <span style={{ fontSize: 14, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          <Typewriter />
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
        </span>
      </div>
    </div>
  );
}

export function TopBarTypewriter() {
  return (
    <div
      aria-label={`${APP_NAME} status`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        flex: "1 1 140px",
        height: "100%",
        padding: "0 10px",
        overflow: "hidden",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-muted)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--accent)",
          boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--text)", fontWeight: 650, whiteSpace: "nowrap" }}>{APP_NAME}</span>
      <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>·</span>
      <span style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        <Typewriter />
      </span>
    </div>
  );
}
