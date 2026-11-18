"use client";

import dynamic from "next/dynamic";
import { useTheme } from "@/hooks/useTheme";

interface HighlightedBlockProps {
  code: string;
  lang: string;
  isDark: boolean;
}

// Prism plus its grammars is ~450KB and is only needed once a message contains a
// fenced code block, so the highlighter module is fetched on first actual use.
const HighlightedBlock = dynamic(
  () => import("@/lib/syntax-highlighting").then((mod) => {
    function Highlighted({ code, lang, isDark }: HighlightedBlockProps) {
      return (
        <mod.CodeHighlighter
          language={mod.normalizeLanguage(lang)}
          style={isDark ? mod.vscDarkPlus : mod.vs}
          showLineNumbers
          lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
          customStyle={{
            margin: 0,
            padding: "10px 12px",
            fontSize: 12.5,
            lineHeight: 1.6,
            borderRadius: 0,
            background: "var(--bg)",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
        >
          {code}
        </mod.CodeHighlighter>
      );
    }
    return { default: Highlighted };
  }),
  { ssr: false },
);

export function CodeBlockHighlighter({ code, lang }: { code: string; lang: string }) {
  const { isDark } = useTheme();
  return (
    <div style={{ position: "relative" }}>
      {/* Rendered underneath so the code is visible instantly while the chunk loads. */}
      <pre
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          margin: 0,
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          fontFamily: "var(--font-mono)",
          color: "var(--text)",
          background: "var(--bg)",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {code}
      </pre>
      <HighlightedBlock code={code} lang={lang} isDark={isDark} />
    </div>
  );
}