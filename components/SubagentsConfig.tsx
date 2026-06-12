"use client";

import { useEffect, useState } from "react";

interface SubagentsStatus {
  packageName: string;
  installCommand: string;
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
  error?: string;
}

export function SubagentsConfig({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [status, setStatus] = useState<SubagentsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/subagents?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => res.json())
      .then((data: SubagentsStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setStatus({
            packageName: "@tintinweb/pi-subagents",
            installCommand: "pi install npm:@tintinweb/pi-subagents",
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

  const copyCommand = () => {
    const command = status?.installCommand ?? "pi install npm:@tintinweb/pi-subagents";
    navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const stateColor = status?.loaded ? "#16a34a" : status?.installed ? "var(--accent)" : "#f59e0b";
  const stateLabel = status?.loaded ? "Loaded" : status?.installed ? "Configured" : "Not detected";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(720px, calc(100dvh - 40px))",
          overflow: "auto",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
            <div style={{ fontSize: 15, fontWeight: 650 }}>Subagents</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {cwd}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            style={{ width: 30, height: 30, border: "none", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18 }}
          >
            x
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>Status</div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 650 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: stateColor }} />
                {loading ? "Checking..." : stateLabel}
              </div>
            </div>
            <button
              onClick={copyCommand}
              style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", height: 30, padding: "0 10px", cursor: "pointer", fontSize: 12 }}
            >
              {copied ? "Copied" : "Copy install"}
            </button>
          </div>

          <section>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>Install Command</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 10px", overflow: "auto" }}>
              {status?.installCommand ?? "pi install npm:@tintinweb/pi-subagents"}
            </div>
          </section>

          {status?.error && (
            <div style={{ color: "#f87171", fontSize: 12, border: "1px solid rgba(248,113,113,0.35)", borderRadius: 6, padding: 10 }}>
              {status.error}
            </div>
          )}

          <section>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>Loaded Extensions</div>
            {status?.extensions.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {status.extensions.map((extension) => (
                  <div key={extension.resolvedPath} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, background: "var(--bg)" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={extension.resolvedPath}>
                      {extension.resolvedPath}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, color: "var(--text-dim)", fontSize: 11 }}>
                      <span>{extension.tools.length} tools</span>
                      <span>{extension.commands.length} commands</span>
                      <span>{extension.messageRenderers.length} renderers</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No pi-subagents extension loaded for this cwd.</div>
            )}
          </section>

          {status?.configuredPackages.length ? (
            <section>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>Configured Packages</div>
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
              <div style={{ fontSize: 12, color: "#f87171", marginBottom: 6 }}>Load Errors</div>
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
      </div>
    </div>
  );
}
