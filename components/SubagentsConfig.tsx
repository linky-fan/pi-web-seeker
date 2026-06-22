"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { apiPath } from "@/lib/api-path";
import { MotionModal } from "./MotionModal";

interface SubagentsStatus {
  packageName: string;
  installCommand: string;
  installCommands?: Array<{ label: string; command: string }>;
  configured: boolean;
  installed: boolean;
  loaded: boolean;
  configuredPackages: string[];
  extensions: Array<{
    path: string;
    resolvedPath: string;
    tools: string[];
    commands: string[];
    messageRenderers: string[];
  }>;
  errors: Array<{ path: string; error: string }>;
  runtime?: { cwd: string; agentDir: string; docker: boolean };
  error?: string;
}

const TEST_PROMPT = `请把这个请求当作复杂仓库分析任务处理。若 Agent 工具可用，请启动最多 2 个后台子智能体来并行分析当前项目；如果不可用，请直接说明工具不可用，不要假装已经启动。

要求：
1. 启动一个 Explore 子智能体：
   - subagent_type: Explore
   - description: Explore project structure
   - run_in_background: true
   - prompt: 只读分析当前仓库的目录结构，找出主要模块、关键组件、API 路由、Docker/README 相关文件。不要修改任何文件。

2. 启动一个 Plan 子智能体：
   - subagent_type: Plan
   - description: Plan subagents integration
   - run_in_background: true
   - prompt: 只读分析当前仓库已经做了哪些 subagents 集成，包括 README、Subagents 面板、MessageView 渲染、session-reader 兼容。给出下一步可改进建议。不要修改任何文件。

启动后等待后台子智能体完成。如果需要，请使用 get_subagent_result 获取它们的结果。最后由主智能体合并结论、处理冲突，并给出一个简短总结。`;

export function SubagentsConfig({
  cwd,
  onClose,
  closeSignal,
}: {
  cwd: string;
  onClose: () => void;
  closeSignal?: unknown;
}) {
  const { t } = useLocale();
  const [status, setStatus] = useState<SubagentsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    fetch(apiPath(`subagents?cwd=${encodeURIComponent(cwd)}`))
      .then((res) => res.json())
      .then((data: SubagentsStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setStatus({
            packageName: "@tintinweb/pi-subagents",
            installCommand: "npx --no-install pi install npm:@tintinweb/pi-subagents",
            configured: false,
            installed: false,
            loaded: false,
            configuredPackages: [],
            extensions: [],
            errors: [],
            error: error.message,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd]);

  useEffect(() => loadStatus(), [loadStatus]);

  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    }).catch(() => {
      setCopied(null);
    });
  };

  const stateColor = status?.loaded ? "#16a34a" : status?.installed ? "var(--accent)" : "#f59e0b";
  const stateLabel = status?.loaded ? t("subagents.loaded") : status?.installed ? t("subagents.configured") : t("subagents.notDetected");

  return (
    <MotionModal
      onClose={onClose}
      closeSignal={closeSignal}
      overlayStyle={{ background: "rgba(0,0,0,0.42)", padding: 20 }}
      panelStyle={{
          width: "min(620px, 100%)",
          maxHeight: "min(720px, calc(100dvh - 40px))",
          overflow: "auto",
          background: "var(--bg-panel)",
          borderRadius: 8,
          color: "var(--text)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
      }}
    >
      {(close) => (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: stateColor,
              border: "1px solid currentColor",
              background: "var(--bg)",
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            SUB
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 650 }}>{t("subagents.title")}</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cwd}
            </div>
          </div>
          <button
            onClick={close}
            title={t("subagents.close")}
            style={{ width: 30, height: 30, border: "none", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}
          >
            x
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>{t("subagents.status")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 650 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: stateColor }} />
                {loading ? t("subagents.checking") : stateLabel}
              </div>
            </div>
            <button
              onClick={() => copyText("install", status?.installCommand ?? "npx --no-install pi install npm:@tintinweb/pi-subagents")}
              style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", height: 30, padding: "0 10px", cursor: "pointer", fontSize: 12 }}
            >
              {copied === "install" ? t("subagents.copied") : t("subagents.copyInstall")}
            </button>
          </div>

          <section>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{t("subagents.installCommand")}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 10px", overflow: "auto" }}>
              {status?.installCommand ?? "npx --no-install pi install npm:@tintinweb/pi-subagents"}
            </div>
          </section>

          {status?.installCommands?.length ? (
            <section>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{t("subagents.installVariants")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {status.installCommands.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => copyText(`cmd:${item.label}`, item.command)}
                    title={t("subagents.copyCommand")}
                    style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30, textAlign: "left", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", padding: "6px 9px", cursor: "pointer" }}
                  >
                    <span style={{ width: 96, flexShrink: 0, color: "var(--text-dim)", fontSize: 11 }}>{item.label}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11 }}>{item.command}</span>
                    <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 11, flexShrink: 0 }}>{copied === `cmd:${item.label}` ? t("subagents.copied") : t("subagents.copy")}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => loadStatus()}
              disabled={loading}
              style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", height: 30, padding: "0 10px", cursor: loading ? "default" : "pointer", fontSize: 12, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? t("subagents.checking") : t("subagents.refreshStatus")}
            </button>
            <button
              onClick={() => copyText("prompt", TEST_PROMPT)}
              style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", height: 30, padding: "0 10px", cursor: "pointer", fontSize: 12 }}
            >
              {copied === "prompt" ? t("subagents.copiedPrompt") : t("subagents.copyPrompt")}
            </button>
          </section>

          <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>
            {t("subagents.strategyHint")}
          </div>

          {status?.runtime && (
            <section>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{t("subagents.runtime")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "74px minmax(0, 1fr)", gap: "5px 8px", fontSize: 11, color: "var(--text-muted)" }}>
                <span style={{ color: "var(--text-dim)" }}>{t("subagents.agentDir")}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }} title={status.runtime.agentDir}>{status.runtime.agentDir}</span>
                <span style={{ color: "var(--text-dim)" }}>{t("subagents.docker")}</span>
                <span>{status.runtime.docker ? t("subagents.yes") : t("subagents.no")}</span>
              </div>
            </section>
          )}

          <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5, border: "1px solid var(--border)", borderRadius: 6, padding: 10, background: "var(--bg)" }}>
            {t("subagents.applyHint")}
          </div>

          {status?.error && (
            <div style={{ color: "#f87171", fontSize: 12, border: "1px solid rgba(248,113,113,0.35)", borderRadius: 6, padding: 10 }}>
              {status.error}
            </div>
          )}

          <section>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{t("subagents.loadedExtensions")}</div>
            {status?.extensions.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {status.extensions.map((extension) => (
                  <div key={extension.resolvedPath} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, background: "var(--bg)" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={extension.resolvedPath}>
                      {extension.resolvedPath}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, color: "var(--text-dim)", fontSize: 11 }}>
                      <span>{t("subagents.tools", { count: extension.tools.length })}</span>
                      <span>{t("subagents.commands", { count: extension.commands.length })}</span>
                      <span>{t("subagents.renderers", { count: extension.messageRenderers.length })}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("subagents.noLoaded")}</div>
            )}
          </section>

          {status?.configuredPackages.length ? (
            <section>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{t("subagents.configuredPackages")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {status.configuredPackages.map((pkg) => (
                  <div key={pkg} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={pkg}>
                    {pkg}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {status?.errors.length ? (
            <section>
              <div style={{ fontSize: 12, color: "#f87171", marginBottom: 6 }}>{t("subagents.loadErrors")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {status.errors.map((error) => (
                  <div key={`${error.path}:${error.error}`} style={{ fontSize: 12, color: "#f87171", border: "1px solid rgba(248,113,113,0.35)", borderRadius: 6, padding: 8 }}>
                    <div style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{error.path}</div>
                    <div style={{ marginTop: 4 }}>{error.error}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </>
      )}
    </MotionModal>
  );
}
