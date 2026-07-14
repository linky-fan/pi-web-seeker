"use client";

import { useEffect, useRef, useState } from "react";
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
  "wake up, Neo.",
  "follow the white rabbit.",
  "there is no spoon.",
  "free your mind.",
  "the matrix has you.",
  "red pill route selected.",
  "operator, trace the signal.",
  "zion uplink established.",
  "dodge this regression.",
];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

interface TypewriterProps {
  active?: boolean;
  resetKey?: string | number | null;
}

export function Typewriter({ active = true, resetKey = null }: TypewriterProps) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [caretOn, setCaretOn] = useState(true);
  const pageVisible = useDocumentVisible();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const enabled = active && pageVisible;

  useEffect(() => {
    setPhraseIdx(Math.floor(Math.random() * TYPEWRITER_PHRASES.length));
    setText("");
    setDeleting(false);
    setCaretOn(true);
  }, [enabled, reduceMotion, resetKey]);

  useEffect(() => {
    if (!enabled || reduceMotion) return undefined;
    const blink = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, [enabled, reduceMotion]);

  useEffect(() => {
    if (!enabled || reduceMotion) return undefined;
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
  }, [deleting, enabled, phraseIdx, reduceMotion, text]);

  if (!enabled) return null;

  const displayText = reduceMotion ? TYPEWRITER_PHRASES[phraseIdx] : text;

  return (
    <span aria-hidden="true" style={{ color: "var(--text-muted)", fontWeight: 400 }}>
      {displayText}
      <span style={{ opacity: reduceMotion || caretOn ? 1 : 0, color: "var(--accent)", marginLeft: 1 }}>▍</span>
    </span>
  );
}

interface FluidSessionTypewriterProps {
  active: boolean;
  resetKey: string;
}

export function FluidSessionTypewriter({ active, resetKey }: FluidSessionTypewriterProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hasRoom, setHasRoom] = useState(false);
  const pageVisible = useDocumentVisible();
  const wideViewport = useMediaQuery("(min-width: 861px)");

  useEffect(() => {
    const title = wrapRef.current?.parentElement;
    if (!title) return undefined;
    const update = () => {
      const sessionName = title.querySelector<HTMLElement>(".pi-fluid-workspace-name");
      const titleWidth = sessionName?.scrollWidth ?? 0;
      const reservedTypewriterWidth = 208;
      setHasRoom(title.clientWidth >= 310 && titleWidth <= title.clientWidth - reservedTypewriterWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(title);
    return () => observer.disconnect();
  }, [resetKey]);

  const enabled = active && pageVisible && wideViewport && hasRoom;

  return (
    <span
      ref={wrapRef}
      className="pi-fluid-session-typewriter"
      data-active={enabled ? "true" : "false"}
      aria-hidden="true"
    >
      {enabled && (
        <>
          <span className="pi-fluid-session-typewriter-separator">·</span>
          <span className="pi-fluid-session-typewriter-copy">
            <Typewriter active resetKey={resetKey} />
          </span>
        </>
      )}
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
