"use client";

import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/lib/i18n";
import { normalizeMarkdownMath } from "@/lib/markdown";
import { parsePlanDocument, type PlanDocumentSection } from "@/lib/plan-mode";
import type { TextContent } from "@/lib/types";
import { MESSAGE_REHYPE_PLUGINS, MESSAGE_REMARK_PLUGINS } from "./markdownConfig";
import { useCopyFeedback } from "./useCopyFeedback";

const MARKDOWN_COMPONENTS: Components = {
  code({ className, children, ...props }) {
    const lang = className?.replace("language-", "") ?? "";
    const raw = String(children);
    const isBlock = className?.includes("language-") || raw.includes("\n");
    if (isBlock) return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
    return (
      <code
        style={{
          background: "var(--bg-selected)",
          padding: "1px 4px",
          borderRadius: 3,
          fontFamily: "var(--font-mono)",
          fontSize: "0.9em",
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
};

function MarkdownContentImpl({ block }: { block: TextContent }) {
  const plan = useMemo(() => parsePlanDocument(block.text), [block.text]);
  if (plan) return <PlanCard title={plan.title} sections={plan.sections} raw={block.text} />;

  return (
    <div className="markdown-body pi-text-block">
      <ReactMarkdown
        remarkPlugins={MESSAGE_REMARK_PLUGINS}
        rehypePlugins={MESSAGE_REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {normalizeMarkdownMath(block.text)}
      </ReactMarkdown>
    </div>
  );
}

function PlanCard({ title, sections, raw }: { title: string; sections: PlanDocumentSection[]; raw: string }) {
  const { t } = useLocale();
  const { copied, copy: copyPlan } = useCopyFeedback(raw);
  const summary = sections.find((section) => section.key === "summary");
  const rest = sections.filter((section) => section.key !== "summary");

  return (
    <article
      style={{
        border: "1px solid color-mix(in srgb, var(--accent) 18%, var(--border))",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--bg)",
        boxShadow: "0 10px 30px -24px rgba(15,23,42,0.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          padding: "13px 14px 11px",
          borderBottom: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--bg-panel) 70%, transparent)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: 21,
                padding: "0 7px",
                borderRadius: 999,
                border: "1px solid rgba(234,179,8,0.32)",
                background: "rgba(234,179,8,0.10)",
                color: "rgba(180,130,0,1)",
                fontSize: 11,
                fontWeight: 750,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11h6" /><path d="M9 15h4" /><path d="M5 4h14v16H5z" />
              </svg>
              {t("planCard.badge")}
            </span>
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
              {t("planCard.readOnly")}
            </span>
          </div>
          <h2 style={{ margin: 0, color: "var(--text)", fontSize: 16, lineHeight: 1.35, letterSpacing: 0 }}>
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={copyPlan}
          title={t("planCard.copy")}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 5,
            height: 28,
            padding: "0 9px",
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg)",
            color: copied ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 650,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {copied ? <polyline points="20 6 9 17 4 12" /> : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
          </svg>
          {copied ? t("planCard.copied") : t("planCard.copy")}
        </button>
      </div>

      <div style={{ padding: 14 }}>
        {summary && (
          <section
            style={{
              marginBottom: 12,
              padding: "10px 11px",
              border: "1px solid color-mix(in srgb, var(--accent) 16%, var(--border))",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--bg-panel) 58%, transparent)",
            }}
          >
            <div style={{ marginBottom: 5, color: "var(--text)", fontSize: 12, fontWeight: 750 }}>
              {summary.title}
            </div>
            <div className="markdown-body plan-card-markdown">
              <ReactMarkdown remarkPlugins={MESSAGE_REMARK_PLUGINS} rehypePlugins={MESSAGE_REHYPE_PLUGINS}>
                {normalizeMarkdownMath(summary.body)}
              </ReactMarkdown>
            </div>
          </section>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {rest.map((section) => (
            <section
              key={section.key}
              style={{
                padding: "10px 11px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: section.key === "risks" ? "rgba(234,179,8,0.045)" : "var(--bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginBottom: 6,
                  color: section.key === "risks" ? "rgba(180,130,0,1)" : "var(--text)",
                  fontSize: 12,
                  fontWeight: 750,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: section.key === "tests" ? "#16a34a" : section.key === "risks" ? "rgba(234,179,8,0.98)" : "var(--accent)",
                    flexShrink: 0,
                  }}
                />
                {section.title}
              </div>
              <div className="markdown-body plan-card-markdown">
                <ReactMarkdown remarkPlugins={MESSAGE_REMARK_PLUGINS} rehypePlugins={MESSAGE_REHYPE_PLUGINS}>
                  {normalizeMarkdownMath(section.body)}
                </ReactMarkdown>
              </div>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}


function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { isDark } = useTheme();
  const { copied, copy } = useCopyFeedback(code);

  return (
    <div
      style={{
        position: "relative",
        marginTop: 4,
        marginBottom: 4,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          padding: "3px 10px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{lang}</span>
        <button
          onClick={copy}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? vscDarkPlus : vs}
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
      </SyntaxHighlighter>
    </div>
  );
}

export const MarkdownContent = memo(MarkdownContentImpl, (previous, next) => previous.block.text === next.block.text);
