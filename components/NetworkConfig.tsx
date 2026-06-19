"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { apiPath } from "@/lib/api-path";
import { MotionModal } from "./MotionModal";

interface NetworkStatus {
  packageName: string;
  packagePath?: string;
  configured: boolean;
  installed: boolean;
  loaded: boolean;
  extensions: Array<{ resolvedPath: string; tools: string[]; commands: string[] }>;
  errors: Array<{ path: string; error: string }>;
  hub?: {
    project: string;
    running: boolean;
    url: string | null;
    error: string | null;
    client?: { server_url?: string } | null;
  };
  runtime?: { cwd: string; agentDir: string; docker: boolean };
  error?: string;
}

export function NetworkConfig({
  cwd,
  onClose,
  closeSignal,
}: {
  cwd: string;
  onClose: () => void;
  closeSignal?: unknown;
}) {
  const { t } = useLocale();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"enable" | "connect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [authToken, setAuthToken] = useState("");

  const loadStatus = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(apiPath(`coms-net?cwd=${encodeURIComponent(cwd)}`))
      .then((res) => res.json())
      .then((data: NetworkStatus) => {
        if (cancelled) return;
        setStatus(data);
        if (!serverUrl && data.hub?.client?.server_url) setServerUrl(data.hub.client.server_url);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd, serverUrl]);

  useEffect(() => loadStatus(), [loadStatus]);

  const postAction = useCallback(async (body: Record<string, unknown>, mode: "enable" | "connect") => {
    setSaving(mode);
    setError(null);
    try {
      const res = await fetch(apiPath("coms-net"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, ...body }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }, [cwd, loadStatus]);

  const loadedTools = useMemo(() => {
    const names = new Set<string>();
    for (const extension of status?.extensions ?? []) {
      for (const tool of extension.tools) names.add(tool);
    }
    return Array.from(names);
  }, [status]);

  const packageReady = status?.loaded || status?.installed || status?.configured;
  const hubReady = status?.hub?.running === true;

  return (
    <MotionModal onClose={onClose} closeSignal={closeSignal} overlayStyle={overlayStyle} panelStyle={panelStyle}>
      {(close) => (
      <>
        <div style={headerStyle}>
          <div style={badgeStyle}>NET</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 650 }}>{t("network.title")}</div>
            <div style={mutedLineStyle}>{cwd}</div>
          </div>
          <button onClick={close} title={t("common.close")} style={closeButtonStyle}>x</button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={statusGridStyle}>
            <StatusTile label={t("network.package")} value={packageReady ? t("network.enabled") : t("network.notEnabled")} ok={Boolean(packageReady)} />
            <StatusTile label={t("network.hub")} value={hubReady ? t("network.connected") : status?.hub?.url ? t("network.saved") : t("network.notConnected")} ok={hubReady} />
          </div>

          <section style={sectionStyle}>
            <div>
              <div style={sectionTitleStyle}>{t("network.enableTitle")}</div>
              <div style={sectionTextStyle}>{t("network.enableDesc")}</div>
            </div>
            <button
              type="button"
              onClick={() => postAction({ action: "enable" }, "enable")}
              disabled={saving !== null || loading}
              style={primaryButtonStyle}
            >
              {saving === "enable" ? t("network.enabling") : packageReady ? t("network.enableAgain") : t("network.enableBuiltIn")}
            </button>
          </section>

          <section style={sectionStyle}>
            <div>
              <div style={sectionTitleStyle}>{t("network.connectTitle")}</div>
              <div style={sectionTextStyle}>{t("network.connectDesc")}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://192.168.1.10:52965"
                style={inputStyle}
              />
              <input
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={t("network.tokenPlaceholder")}
                type="password"
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => postAction({ action: "connect", serverUrl, authToken }, "connect")}
                disabled={saving !== null || loading || !serverUrl.trim() || !authToken.trim()}
                style={primaryButtonStyle}
              >
                {saving === "connect" ? t("network.connecting") : t("network.connect")}
              </button>
            </div>
          </section>

          {status?.hub?.url ? (
            <div style={hintStyle}>
              {t("network.currentHub")} <span style={monoStyle}>{status.hub.url}</span>
              {status.hub.error && !hubReady ? <span style={{ color: "#f59e0b" }}> {status.hub.error}</span> : null}
            </div>
          ) : null}

          <section>
            <div style={sectionTitleStyle}>{t("network.loadedTools")}</div>
            {loadedTools.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {loadedTools.map((tool) => <span key={tool} style={pillStyle}>{tool}</span>)}
              </div>
            ) : (
              <div style={sectionTextStyle}>{t("network.noLoaded")}</div>
            )}
          </section>

          <div style={hintStyle}>{t("network.applyHint")}</div>

          {status?.runtime || status?.packagePath ? (
            <div style={runtimeStyle}>
              <span>{t("network.agentDir")}</span>
              <span style={monoEllipsisStyle} title={status.runtime?.agentDir}>{status.runtime?.agentDir ?? "-"}</span>
              <span>{t("network.serverPackagePath")}</span>
              <span style={monoEllipsisStyle} title={status.packagePath}>{status.packagePath ?? "-"}</span>
            </div>
          ) : null}

          {(error || status?.error) ? <div style={errorStyle}>{error || status?.error}</div> : null}

          {status?.errors.length ? (
            <div style={errorStyle}>
              <div style={{ fontWeight: 650, marginBottom: 6 }}>{t("network.loadErrors")}</div>
              {status.errors.map((item) => (
                <div key={`${item.path}:${item.error}`}>
                  <span style={monoStyle}>{item.path}</span> {item.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </>
      )}
    </MotionModal>
  );
}

function StatusTile({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 7, padding: 10, background: "var(--bg)" }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 5 }}>{label}</div>
      <div style={{ color: ok ? "#16a34a" : "#f59e0b", fontWeight: 650, fontSize: 13 }}>{value}</div>
    </div>
  );
}

const overlayStyle = { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } as const;
const panelStyle = { width: "min(560px, 100%)", maxHeight: "min(720px, calc(100dvh - 40px))", overflow: "auto", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", boxShadow: "0 24px 80px rgba(0,0,0,0.28)" } as const;
const headerStyle = { display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" } as const;
const badgeStyle = { width: 34, height: 34, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", border: "1px solid currentColor", background: "var(--bg)", fontSize: 10, fontWeight: 800 } as const;
const closeButtonStyle = { width: 30, height: 30, border: "none", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 } as const;
const mutedLineStyle = { fontSize: 12, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const statusGridStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 } as const;
const sectionStyle = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 190px", gap: 12, alignItems: "center", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", padding: 12 } as const;
const sectionTitleStyle = { fontSize: 13, fontWeight: 650, color: "var(--text)", marginBottom: 4 } as const;
const sectionTextStyle = { fontSize: 12, lineHeight: 1.45, color: "var(--text-dim)" } as const;
const primaryButtonStyle = { minHeight: 32, border: "none", borderRadius: 6, background: "var(--accent)", color: "#fff", padding: "0 12px", cursor: "pointer", fontSize: 12, fontWeight: 650 } as const;
const inputStyle = { width: "100%", height: 32, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", padding: "0 9px", fontSize: 12 } as const;
const hintStyle = { color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5, border: "1px solid var(--border)", borderRadius: 6, padding: 10, background: "var(--bg)" } as const;
const runtimeStyle = { display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: "5px 8px", fontSize: 11, color: "var(--text-dim)" } as const;
const monoStyle = { fontFamily: "var(--font-mono)", fontSize: 11 } as const;
const monoEllipsisStyle = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", color: "var(--text-muted)" } as const;
const pillStyle = { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text)", background: "var(--bg-selected)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 7px" } as const;
const errorStyle = { color: "#f87171", fontSize: 12, border: "1px solid rgba(248,113,113,0.35)", borderRadius: 6, padding: 10 } as const;
