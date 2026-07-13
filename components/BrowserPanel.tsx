"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiPath } from "@/lib/api-path";
import type {
  BrowserApprovalDecision,
  BrowserEvent,
  BrowserPolicyMode,
  BrowserRuntimeStatus,
  BrowserSessionState,
} from "@/lib/browser-types";
import { useLocale } from "@/lib/i18n";

interface BrowserStatusResponse extends BrowserRuntimeStatus {
  packageExists?: boolean;
  packageErrors?: string[];
}

interface Props {
  agentSessionId: string;
  cwd: string;
  maximized: boolean;
  onToggleMaximize: () => void;
  onCloseTab: () => void;
}

function GlobeIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function ActionIcon({ action }: { action: string }) {
  if (action.includes("click")) return <span className="pi-browser-event-glyph">↗</span>;
  if (action.includes("type") || action.includes("fill")) return <span className="pi-browser-event-glyph">T</span>;
  if (action.includes("open") || action.includes("navigate")) return <GlobeIcon size={12} />;
  if (action.includes("state") || action.includes("observe")) return <span className="pi-browser-event-glyph">◉</span>;
  return <span className="pi-browser-event-glyph">·</span>;
}

function currentOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function eventLabel(event: BrowserEvent): string {
  return event.summary || event.error || event.action || event.type.replaceAll("_", " ");
}

export function BrowserPanel({ agentSessionId, cwd, maximized, onToggleMaximize, onCloseTab }: Props) {
  const { t } = useLocale();
  const [status, setStatus] = useState<BrowserStatusResponse | null>(null);
  const [session, setSession] = useState<BrowserSessionState | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const addressFocusedRef = useRef(false);

  const loadStatus = useCallback(async (force = false) => {
    const query = new URLSearchParams({ cwd });
    if (force) query.set("refresh", "1");
    const response = await fetch(apiPath(`/api/browser/status?${query.toString()}`), { cache: "no-store" });
    const body = await response.json() as BrowserStatusResponse & { error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setStatus(body);
  }, [cwd]);

  const loadSession = useCallback(async () => {
    const response = await fetch(apiPath(`/api/browser/sessions/${encodeURIComponent(agentSessionId)}`), { cache: "no-store" });
    const body = await response.json() as BrowserSessionState & { error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setSession(body);
    if (!addressFocusedRef.current && body.url) setAddress(body.url);
    if (body.previewAvailable) setPreviewFailed(false);
  }, [agentSessionId]);

  useEffect(() => {
    setError(null);
    void Promise.all([loadStatus(), loadSession()]).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [loadSession, loadStatus]);

  useEffect(() => {
    const source = new EventSource(apiPath(`/api/browser/sessions/${encodeURIComponent(agentSessionId)}/events`));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as BrowserEvent | { type: "ready"; state: BrowserSessionState };
        if (event.type === "ready") {
          setSession(event.state);
          if (!addressFocusedRef.current && event.state.url) setAddress(event.state.url);
          return;
        }
        void loadSession();
      } catch {
        // Ignore malformed/transient SSE payloads and keep the last valid state.
      }
    };
    return () => source.close();
  }, [agentSessionId, loadSession]);

  const runCommand = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(apiPath(`/api/browser/sessions/${encodeURIComponent(agentSessionId)}/commands`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await response.json() as { error?: string; state?: BrowserSessionState };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (body.state) setSession(body.state);
      else await loadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [agentSessionId, loadSession]);

  const enableTools = useCallback(async () => {
    setBusy("setup");
    setError(null);
    try {
      const response = await fetch(apiPath("/api/browser/setup"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, agentSessionId }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      await loadStatus(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [agentSessionId, cwd, loadStatus]);

  const updatePolicy = useCallback(async (body: Record<string, unknown>) => {
    setBusy("policy");
    setError(null);
    try {
      const response = await fetch(apiPath(`/api/browser/sessions/${encodeURIComponent(agentSessionId)}/policy`), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      await loadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [agentSessionId, loadSession]);

  const resolveApproval = useCallback(async (decision: BrowserApprovalDecision) => {
    if (!session?.pendingApproval) return;
    setBusy("approval");
    setError(null);
    try {
      const response = await fetch(apiPath(`/api/browser/sessions/${encodeURIComponent(agentSessionId)}/approvals`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: session.pendingApproval.id, decision }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      await loadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [agentSessionId, loadSession, session?.pendingApproval]);

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim()) return;
    void runCommand("navigate", { url: address.trim() });
  };

  const origin = useMemo(() => currentOrigin(session?.url || ""), [session?.url]);
  const originTrusted = Boolean(origin && session?.policy.trustedOrigins.includes(origin));
  const events = session?.events.slice(-18).reverse() ?? [];
  const previewSrc = session?.previewAvailable
    ? apiPath(`/api/browser/sessions/${encodeURIComponent(agentSessionId)}/preview?revision=${session.previewRevision}`)
    : "";
  const setupBlocked = !status?.available
    || !status.doctorOk
    || status.profileOk === false
    || !status.packageConfigured
    || status.packageLoaded === false;

  return (
    <section className="pi-browser-panel" aria-label={t("browser.title")}>
      <div className="pi-browser-toolbar">
        <div className={`pi-browser-status-dot pi-browser-status-${session?.status || "idle"}`} title={session?.status || "idle"} />
        <form className="pi-browser-address" onSubmit={submitAddress}>
          <GlobeIcon size={14} />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => { addressFocusedRef.current = true; }}
            onBlur={() => { addressFocusedRef.current = false; }}
            placeholder="https://"
            aria-label={t("browser.address")}
            disabled={setupBlocked || busy !== null}
          />
        </form>
        <button className="pi-browser-icon-button" onClick={() => void runCommand("refresh")} disabled={setupBlocked || busy !== null} title={t("browser.refresh")} aria-label={t("browser.refresh")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6v6h-6"/><path d="M4 18v-6h6"/><path d="M18.5 9A7 7 0 0 0 6.2 6.2L4 8M5.5 15A7 7 0 0 0 17.8 17.8L20 16"/></svg>
        </button>
        <button className="pi-browser-icon-button" onClick={() => void runCommand(session?.status === "paused" ? "resume" : "pause")} disabled={setupBlocked || busy !== null} title={session?.status === "paused" ? t("browser.resume") : t("browser.pause")} aria-label={session?.status === "paused" ? t("browser.resume") : t("browser.pause")}>
          {session?.status === "paused" ? <span className="pi-browser-play">▶</span> : <span className="pi-browser-pause">Ⅱ</span>}
        </button>
        <button className="pi-browser-icon-button" onClick={onToggleMaximize} title={maximized ? t("browser.restore") : t("browser.maximize")} aria-label={maximized ? t("browser.restore") : t("browser.maximize")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{maximized ? <><path d="M8 3H3v5M16 21h5v-5M3 16v5h5M21 8V3h-5"/></> : <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></>}</svg>
        </button>
      </div>

      <div className="pi-browser-control-row">
        <select
          value={session?.policy.mode || "confirm-sensitive"}
          onChange={(event) => void updatePolicy({ mode: event.target.value as BrowserPolicyMode })}
          disabled={!status?.packageConfigured || busy !== null}
          aria-label={t("browser.policy")}
        >
          <option value="confirm-sensitive">{t("browser.policyConfirm")}</option>
          <option value="full-auto">{t("browser.policyAuto")}</option>
        </select>
        <button
          className={originTrusted ? "active" : ""}
          disabled={!origin || busy !== null}
          onClick={() => origin && void updatePolicy({ origin, trusted: !originTrusted })}
          title={origin || t("browser.noOrigin")}
        >
          {originTrusted ? t("browser.trusted") : t("browser.trustSite")}
        </button>
        <button disabled={setupBlocked || busy !== null} onClick={() => void runCommand("takeover")}>{t("browser.takeover")}</button>
        <span className="pi-browser-page-title" title={session?.title}>{session?.title || t("browser.noPage")}</span>
      </div>

      {error && <div className="pi-browser-inline-error" role="alert">{error}</div>}

      <div className="pi-browser-stage">
        {status === null ? (
          <div className="pi-browser-empty"><div className="pi-browser-spinner" /><strong>{t("browser.detecting")}</strong></div>
        ) : !status.available ? (
          <div className="pi-browser-empty">
            <div className="pi-browser-empty-mark"><GlobeIcon size={22} /></div>
            <strong>{t("browser.notInstalled")}</strong>
            <p>{t("browser.notInstalledHint")}</p>
            <code>{status.installCommand}</code>
            {status.docker && <p className="pi-browser-caution">{t("browser.dockerLocalOnly")}</p>}
          </div>
        ) : !status.doctorOk ? (
          <div className="pi-browser-empty">
            <div className="pi-browser-empty-mark"><GlobeIcon size={22} /></div>
            <strong>{t("browser.bridgeOffline")}</strong>
            <p>{t("browser.bridgeOfflineHint")}</p>
            <code>opencli doctor</code>
            {status.doctorOutput && <pre>{status.doctorOutput}</pre>}
          </div>
        ) : status.profileOk === false ? (
          <div className="pi-browser-empty">
            <div className="pi-browser-empty-mark"><GlobeIcon size={22} /></div>
            <strong>{t("browser.profileUnavailable")}</strong>
            <p>{t("browser.profileUnavailableHint")}</p>
            <code>opencli profile list</code>
            {status.profileOutput && <pre>{status.profileOutput}</pre>}
          </div>
        ) : !status.packageConfigured ? (
          <div className="pi-browser-empty">
            <div className="pi-browser-empty-mark"><GlobeIcon size={22} /></div>
            <strong>{t("browser.enableTitle")}</strong>
            <p>{t("browser.enableHint")}</p>
            <button className="pi-browser-primary" onClick={() => void enableTools()} disabled={busy !== null}>{busy === "setup" ? t("browser.enabling") : t("browser.enable")}</button>
          </div>
        ) : status.packageLoaded === false ? (
          <div className="pi-browser-empty">
            <div className="pi-browser-empty-mark"><GlobeIcon size={22} /></div>
            <strong>{t("browser.packageFailed")}</strong>
            <p>{t("browser.packageFailedHint")}</p>
            {status.packageErrors && status.packageErrors.length > 0 && <pre>{status.packageErrors.join("\n")}</pre>}
          </div>
        ) : session?.previewAvailable && !previewFailed ? (
          <div className="pi-browser-preview-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewSrc} alt={session.title || t("browser.preview")} onError={() => setPreviewFailed(true)} />
            {session.status === "running" && <div className="pi-browser-live-badge"><span />{t("browser.agentWorking")}</div>}
          </div>
        ) : (
          <div className="pi-browser-empty">
            <div className="pi-browser-empty-mark"><GlobeIcon size={22} /></div>
            <strong>{t("browser.readyTitle")}</strong>
            <p>{t("browser.readyHint")}</p>
          </div>
        )}

        {session?.pendingApproval && (
          <div className="pi-browser-approval" role="dialog" aria-modal="true" aria-label={t("browser.approvalTitle")}>
            <div className="pi-browser-approval-card">
              <span className="pi-browser-approval-kicker">{t("browser.approvalKicker")}</span>
              <strong>{t("browser.approvalTitle")}</strong>
              <p>{session.pendingApproval.summary}</p>
              <code>{session.pendingApproval.origin}</code>
              <div>
                <button onClick={() => void resolveApproval("deny")} disabled={busy !== null}>{t("browser.deny")}</button>
                <button onClick={() => void resolveApproval("allow_once")} disabled={busy !== null}>{t("browser.allowOnce")}</button>
                <button className="pi-browser-primary" onClick={() => void resolveApproval("allow_origin")} disabled={busy !== null || session.pendingApproval.origin === "unknown"}>{t("browser.alwaysAllow")}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pi-browser-timeline">
        <div className="pi-browser-timeline-header">
          <span>{t("browser.activity")}</span>
          <span>{session?.opencliSession}</span>
        </div>
        <div className="pi-browser-timeline-list">
          {events.length === 0 ? <div className="pi-browser-no-events">{t("browser.noActivity")}</div> : events.map((event) => (
            <div className={`pi-browser-event pi-browser-event-${event.type}`} key={event.id}>
              <span className="pi-browser-event-icon"><ActionIcon action={event.action || event.type} /></span>
              <span className="pi-browser-event-label" title={eventLabel(event)}>{eventLabel(event)}</span>
              {event.durationMs !== undefined && <span className="pi-browser-event-time">{event.durationMs < 1000 ? `${event.durationMs}ms` : `${(event.durationMs / 1000).toFixed(1)}s`}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="pi-browser-footer">
        <span>{status?.version || "OpenCLI"}</span>
        <button onClick={() => void runCommand("close")} disabled={busy !== null}>{t("browser.closeSession")}</button>
        <button onClick={onCloseTab}>{t("browser.hideTab")}</button>
      </div>
    </section>
  );
}
