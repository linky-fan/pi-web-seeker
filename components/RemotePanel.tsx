"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { apiPath } from "@/lib/api-path";
import type { RemoteApprovalDecision, RemoteConnectionState, RemoteEvent, RemoteProfile } from "@/lib/remote-types";

interface Props {
  agentSessionId: string;
  cwd: string;
  maximized: boolean;
  onToggleMaximize: () => void;
  onCloseTab: () => void;
}

interface RemoteStatus {
  configured: boolean;
  loaded: boolean;
  packageExists: boolean;
  errors: string[];
  profileCount: number;
}

type ProfileDraft = Omit<RemoteProfile, "id" | "createdAt" | "updatedAt"> & { id?: string };
type RemoteDrawerView = "targets" | "activity" | null;

const TERMINAL_FONT_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Noto Sans Mono CJK SC', 'Microsoft YaHei Mono', monospace";

function defaultProfile(): ProfileDraft {
  return {
    name: "",
    protocol: "ssh",
    host: "",
    port: 22,
    username: "",
    authMethod: "key",
    keyPath: "~/.ssh/id_ed25519",
    deviceMode: "auto",
    commandMode: "exec",
    promptPreset: "unix",
    promptText: "",
    pagerText: "",
    pagerContinue: " ",
    encoding: "utf8",
    lineEnding: "lf",
    timeoutMs: 30_000,
    telnetEnabled: false,
  };
}

function statusTone(status: RemoteConnectionState["status"]): string {
  if (status === "connected") return "var(--success, #16a34a)";
  if (status === "running" || status === "connecting" || status === "waiting-approval") return "var(--warning, #d97706)";
  if (status === "error") return "var(--danger, #dc2626)";
  return "var(--text-dim)";
}

function TerminalIcon({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
}

export function RemotePanel({ agentSessionId, cwd, maximized, onToggleMaximize, onCloseTab }: Props) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [session, setSession] = useState<RemoteConnectionState | null>(null);
  const [profiles, setProfiles] = useState<RemoteProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [command, setCommand] = useState("");
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [drawerView, setDrawerView] = useState<RemoteDrawerView>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef("");
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerInitializedRef = useRef(false);
  const activeSessionIdRef = useRef(agentSessionId);
  const requestGenerationRef = useRef(0);
  if (activeSessionIdRef.current !== agentSessionId) {
    activeSessionIdRef.current = agentSessionId;
    requestGenerationRef.current += 1;
  }
  const isCurrentRequest = useCallback((id: string, generation: number) => activeSessionIdRef.current === id && requestGenerationRef.current === generation, []);
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId), [profiles, selectedProfileId]);

  const loadProfiles = useCallback(async () => {
    const generation = requestGenerationRef.current;
    const response = await fetch(apiPath("/api/remote/profiles"), { cache: "no-store" });
    const body = await response.json() as { profiles?: RemoteProfile[]; error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    if (!isCurrentRequest(agentSessionId, generation)) return;
    const next = body.profiles ?? [];
    setProfiles(next);
    setSelectedProfileId((current) => current && next.some((profile) => profile.id === current) ? current : next[0]?.id ?? "");
  }, [agentSessionId, isCurrentRequest]);

  const loadStatus = useCallback(async () => {
    const generation = requestGenerationRef.current;
    const response = await fetch(apiPath(`/api/remote/status?${new URLSearchParams({ cwd })}`), { cache: "no-store" });
    const body = await response.json() as RemoteStatus & { error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    if (!isCurrentRequest(agentSessionId, generation)) return;
    setStatus(body);
  }, [agentSessionId, cwd, isCurrentRequest]);

  const loadSession = useCallback(async () => {
    const generation = requestGenerationRef.current;
    const response = await fetch(apiPath(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}`), { cache: "no-store" });
    const body = await response.json() as RemoteConnectionState & { error?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    if (!isCurrentRequest(agentSessionId, generation)) return;
    setSession(body);
  }, [agentSessionId, isCurrentRequest]);

  useEffect(() => {
    setError(null);
    const generation = requestGenerationRef.current;
    void Promise.all([loadProfiles(), loadStatus(), loadSession()]).catch((cause) => {
      if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [agentSessionId, isCurrentRequest, loadProfiles, loadSession, loadStatus]);

  useEffect(() => {
    drawerInitializedRef.current = false;
    setPassword("");
    setPassphrase("");
    setCommand("");
    setDraft(null);
    inputBufferRef.current = "";
    if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
    inputTimerRef.current = null;
    setDrawerView(null);
    setSession(null);
    setEvents([]);
  }, [agentSessionId]);

  useEffect(() => {
    setPassword("");
    setPassphrase("");
  }, [selectedProfileId, selectedProfile?.authMethod]);

  useEffect(() => {
    if (!status?.loaded || !session || drawerInitializedRef.current) return;
    drawerInitializedRef.current = true;
    const sessionIsConnected = session.status === "connected" || session.status === "running" || session.status === "paused";
    setDrawerView(sessionIsConnected ? null : "targets");
  }, [session, status?.loaded]);

  useEffect(() => {
    if (!drawerView) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerView(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerView]);

  useEffect(() => {
    if (!status?.loaded || !terminalHostRef.current) return;
    const generation = requestGenerationRef.current;
    const terminalFontFamily = getComputedStyle(terminalHostRef.current).getPropertyValue("--pi-terminal-font").trim() || TERMINAL_FONT_FALLBACK;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily: terminalFontFamily,
      fontSize: 13,
      fontWeight: 400,
      fontWeightBold: 600,
      letterSpacing: 0,
      lineHeight: 1.25,
      scrollback: 5_000,
      theme: { background: "#101318", foreground: "#d7dce2", cursor: "#7aa2f7", selectionBackground: "#344054" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(terminalHostRef.current);
    terminal.writeln("\x1b[2mPi Web Remote — connect a user-approved profile to begin.\x1b[0m");
    terminalRef.current = terminal;
    fitRef.current = fit;
    let disposed = false;
    const sendSize = () => {
      try { fit.fit(); } catch { return; }
      void fetch(apiPath(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/input`), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }),
      }).catch(() => {});
    };
    const resize = new ResizeObserver(sendSize);
    resize.observe(terminalHostRef.current);
    const dataDisposable = terminal.onData((data) => {
      inputBufferRef.current += data;
      if (inputTimerRef.current) return;
      inputTimerRef.current = setTimeout(() => {
        const payload = inputBufferRef.current;
        inputBufferRef.current = "";
        inputTimerRef.current = null;
        void fetch(apiPath(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/input`), {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: payload }),
        }).catch((cause) => {
          if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause));
        });
      }, 20);
    });
    const initialFitFrame = requestAnimationFrame(sendSize);
    void document.fonts.ready.then(() => {
      if (!disposed && terminalRef.current === terminal) sendSize();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(initialFitFrame);
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
      inputBufferRef.current = "";
      inputTimerRef.current = null;
      resize.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [agentSessionId, isCurrentRequest, status?.loaded]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.disableStdin = session?.controlMode !== "manual";
  }, [session?.controlMode]);

  useEffect(() => {
    const generation = requestGenerationRef.current;
    const source = new EventSource(apiPath(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/events`));
    source.onmessage = (message) => {
      if (!isCurrentRequest(agentSessionId, generation)) return;
      try {
        const event = JSON.parse(message.data) as RemoteEvent | { type: "ready"; state: RemoteConnectionState };
        if (event.type === "ready") { setSession(event.state); return; }
        if (event.type === "output" && event.text) terminalRef.current?.write(event.text);
        if (event.type !== "output") setEvents((current) => [...current, event].slice(-30));
        if ("state" in event && event.state) setSession(event.state);
        else void loadSession();
      } catch { /* Keep last valid state. */ }
    };
    source.onerror = () => {
      if (isCurrentRequest(agentSessionId, generation)) setError((current) => current ?? "Remote event stream disconnected; reconnecting…");
    };
    return () => source.close();
  }, [agentSessionId, isCurrentRequest, loadSession]);

  const request = useCallback(async (path: string, method: string, body?: unknown) => {
    const generation = requestGenerationRef.current;
    const response = await fetch(apiPath(path), { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json().catch(() => ({})) as { error?: string; state?: RemoteConnectionState };
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    if (value.state && isCurrentRequest(agentSessionId, generation)) setSession(value.state);
    return value;
  }, [agentSessionId, isCurrentRequest]);

  const enableTools = useCallback(async () => {
    const generation = requestGenerationRef.current;
    setBusy("setup"); setError(null);
    try { await request("/api/remote/setup", "POST", { cwd, agentSessionId }); await loadStatus(); }
    catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrentRequest(agentSessionId, generation)) setBusy(null); }
  }, [agentSessionId, cwd, isCurrentRequest, loadStatus, request]);

  const saveProfile = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const generation = requestGenerationRef.current;
    setBusy("profile"); setError(null);
    try {
      await request("/api/remote/profiles", draft.id ? "PUT" : "POST", draft.id ? { id: draft.id, profile: draft } : draft);
      if (isCurrentRequest(agentSessionId, generation)) { setDraft(null); await loadProfiles(); }
    } catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrentRequest(agentSessionId, generation)) setBusy(null); }
  }, [agentSessionId, draft, isCurrentRequest, loadProfiles, request]);

  const deleteProfile = useCallback(async (profile: RemoteProfile) => {
    if (!window.confirm(`Delete remote profile “${profile.name}”?`)) return;
    const generation = requestGenerationRef.current;
    setBusy("profile"); setError(null);
    try { await request("/api/remote/profiles", "DELETE", { id: profile.id }); await loadProfiles(); }
    catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrentRequest(agentSessionId, generation)) setBusy(null); }
  }, [agentSessionId, isCurrentRequest, loadProfiles, request]);

  const connect = useCallback(async () => {
    if (!selectedProfile) return;
    const generation = requestGenerationRef.current;
    setBusy("connect"); setError(null);
    terminalRef.current?.writeln(`\r\n\x1b[36mConnecting to ${selectedProfile.name}…\x1b[0m`);
    try {
      const credentials = selectedProfile.authMethod === "password"
        ? { password }
        : selectedProfile.authMethod === "key" && passphrase ? { passphrase } : {};
      await request(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/connect`, "POST", { profileId: selectedProfile.id, ...credentials });
      if (isCurrentRequest(agentSessionId, generation)) setDrawerView(null);
    } catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrentRequest(agentSessionId, generation)) { setPassword(""); setPassphrase(""); setBusy(null); } }
  }, [agentSessionId, isCurrentRequest, passphrase, password, request, selectedProfile]);

  const control = useCallback(async (action: "takeover" | "resume" | "disconnect" | "apply-detected-type") => {
    const generation = requestGenerationRef.current;
    setBusy(action); setError(null);
    try { await request(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/control`, "POST", { action }); }
    catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrentRequest(agentSessionId, generation)) setBusy(null); }
  }, [agentSessionId, isCurrentRequest, request]);

  const runCommand = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!command.trim()) return;
    const generation = requestGenerationRef.current;
    setBusy("command"); setError(null);
    try { await request(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/commands`, "POST", { command, intent: "observe" }); if (isCurrentRequest(agentSessionId, generation)) setCommand(""); }
    catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrentRequest(agentSessionId, generation)) setBusy(null); }
  }, [agentSessionId, command, isCurrentRequest, request]);

  const resolveApproval = useCallback(async (decision: RemoteApprovalDecision) => {
    const approval = session?.pendingApproval;
    if (!approval) return;
    const generation = requestGenerationRef.current;
    setError(null);
    try { await request(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/approvals`, "POST", { approvalId: approval.id, decision }); }
    catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [agentSessionId, isCurrentRequest, request, session?.pendingApproval]);

  const exportCapture = useCallback(async (captureId: string) => {
    const destination = window.prompt("Export capture to workspace path", `.pi-remote/${captureId}.txt`);
    if (!destination) return;
    const generation = requestGenerationRef.current;
    setBusy("export"); setError(null);
    try { await request(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/captures`, "POST", { captureId, cwd, destination }); }
    catch (cause) { if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrentRequest(agentSessionId, generation)) setBusy(null); }
  }, [agentSessionId, cwd, isCurrentRequest, request]);

  const policyMode = session?.policyMode;
  const togglePolicy = useCallback(async () => {
    const generation = requestGenerationRef.current;
    setError(null);
    try {
      await request(`/api/remote/sessions/${encodeURIComponent(agentSessionId)}/policy`, "PUT", {
        mode: policyMode === "full-auto" ? "confirm-sensitive" : "full-auto",
      });
    } catch (cause) {
      if (isCurrentRequest(agentSessionId, generation)) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [agentSessionId, isCurrentRequest, policyMode, request]);

  const connected = session?.status === "connected" || session?.status === "running" || session?.status === "paused";
  const commandAvailable = connected && session?.controlMode !== "manual";
  const approval = session?.pendingApproval;
  const activityCount = (session?.captures.length ?? 0) + events.length;
  const toggleDrawer = (view: Exclude<RemoteDrawerView, null>) => setDrawerView((current) => current === view ? null : view);

  return (
    <div className="pi-remote-panel">
      <header className="pi-remote-toolbar">
        <div className="pi-remote-title"><TerminalIcon /><span>Remote</span><span className="pi-remote-status-dot" style={{ background: statusTone(session?.status ?? "idle") }} /><small>{session?.status ?? "idle"}</small></div>
        <div className="pi-remote-toolbar-actions">
          {status?.loaded && <>
            <button className={drawerView === "targets" ? "active" : ""} onClick={() => toggleDrawer("targets")} aria-expanded={drawerView === "targets"} aria-controls="pi-remote-drawer">Targets <small>{profiles.length}</small></button>
            <button className={drawerView === "activity" ? "active" : ""} onClick={() => toggleDrawer("activity")} aria-expanded={drawerView === "activity"} aria-controls="pi-remote-drawer">Activity <small>{activityCount}</small></button>
          </>}
          <button onClick={onToggleMaximize} title={maximized ? "Restore" : "Maximize"}>{maximized ? "Restore" : "Maximize"}</button>
          <button onClick={onCloseTab}>Close</button>
        </div>
      </header>

      {error && <div className="pi-remote-error">{error}<button onClick={() => setError(null)}>×</button></div>}
      {!status?.loaded && (
        <div className="pi-remote-setup">
          <TerminalIcon size={24} /><strong>Enable controlled remote tools</strong>
          <p>The built-in package exposes only user-created profiles and keeps credentials out of Agent messages.</p>
          <button onClick={() => void enableTools()} disabled={busy !== null || !status?.packageExists}>{busy === "setup" ? "Enabling…" : "Enable for workspace"}</button>
          {status?.errors?.map((item) => <code key={item}>{item}</code>)}
        </div>
      )}

      {status?.loaded && <div className="pi-remote-main">
        <section className="pi-remote-console">
          <div className="pi-remote-connection-bar">
            <span>{session?.profileName ?? "No active target"}</span>
            {connected && <>
              {session?.hostType && <small title={`Effective command policy: ${session.effectiveHostType ?? "unknown"}`}>{session.hostTypeSource === "detected" ? `Detected: ${session.hostType}` : `Policy: ${session.effectiveHostType ?? session.hostType}`}</small>}
              {session?.hostTypeSource === "detected" && session.effectiveHostType === "unknown" && <button onClick={() => void control("apply-detected-type")}>Apply detected policy</button>}
              <button className={session?.controlMode === "manual" ? "active" : ""} onClick={() => void control(session?.controlMode === "manual" ? "resume" : "takeover")}>{session?.controlMode === "manual" ? "Return to Agent" : "Take control"}</button>
              <button onClick={() => void togglePolicy()}>{session?.policyMode === "full-auto" ? "Full-auto" : "Confirm sensitive"}</button>
              <button onClick={() => void control("disconnect")}>Disconnect</button>
            </>}
          </div>
          {approval && <div className="pi-remote-approval"><strong>{approval.title}</strong><p>{approval.summary}</p><div><button onClick={() => void resolveApproval("deny")}>Deny</button><button onClick={() => void resolveApproval("allow_once")}>Allow once</button>{approval.kind === "host-key" && <button className="primary" onClick={() => void resolveApproval("trust")}>Trust host</button>}</div></div>}
          <div ref={terminalHostRef} className="pi-remote-terminal" />
          <form className="pi-remote-command" onSubmit={runCommand}>
            <span>$</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder={session?.controlMode === "manual" ? "Return control to the Agent command queue first" : connected ? "Run and capture an observation command" : "Connect a target first"} disabled={!commandAvailable || busy !== null} />
            <button disabled={!commandAvailable || !command.trim() || busy !== null}>{busy === "command" ? "Running…" : "Run"}</button>
          </form>
        </section>

        {drawerView && <div className="pi-remote-drawer-layer">
          <button className="pi-remote-drawer-scrim" type="button" onClick={() => setDrawerView(null)} aria-label="Close remote drawer" />
          <aside id="pi-remote-drawer" className="pi-remote-drawer" aria-label={drawerView === "targets" ? "Remote targets" : "Remote activity"}>
            <div className="pi-remote-drawer-header">
              <div><small>Remote workspace</small><strong>{drawerView === "targets" ? "Targets" : "Activity"}</strong></div>
              <button type="button" onClick={() => setDrawerView(null)} aria-label="Close remote drawer">×</button>
            </div>
            <div className="pi-remote-drawer-scroll">
              {drawerView === "targets" ? <>
                <div className="pi-remote-section-head"><span>Targets</span><button onClick={() => setDraft(defaultProfile())}>New</button></div>
                <div className="pi-remote-targets">
                  {profiles.map((profile) => (
                    <button key={profile.id} className={selectedProfileId === profile.id ? "active" : ""} onClick={() => setSelectedProfileId(profile.id)}>
                      <span className="protocol">{profile.protocol.toUpperCase()}</span><span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}:{profile.port}</small></span>
                    </button>
                  ))}
                  {!profiles.length && <p>No targets configured.</p>}
                </div>
                {selectedProfile && !draft && <div className="pi-remote-target-actions"><button onClick={() => setDraft({ ...selectedProfile })}>Edit</button><button onClick={() => void deleteProfile(selectedProfile)}>Delete</button></div>}

                {draft && <ProfileEditor draft={draft} busy={busy === "profile"} onChange={setDraft} onCancel={() => setDraft(null)} onSubmit={saveProfile} />}

                {!draft && selectedProfile && !connected && <div className="pi-remote-connect-card">
                  {selectedProfile.authMethod === "password" && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>}
                  {selectedProfile.authMethod === "key" && <label>Key passphrase <span>(optional)</span><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" /></label>}
                  <button className="primary" onClick={() => void connect()} disabled={busy !== null}>{busy === "connect" ? "Connecting…" : "Connect"}</button>
                </div>}
              </> : <>
                <div className="pi-remote-section-head"><span>Captures</span><small>{session?.captures.length ?? 0}</small></div>
                <div className="pi-remote-captures">
                  {session?.captures.slice(0, 12).map((capture) => <button key={capture.id} onClick={() => void exportCapture(capture.id)} title="Export to workspace"><span>{capture.command}</span><small>{Math.ceil(capture.byteCount / 1024)} KiB · {new Date(capture.createdAt).toLocaleTimeString()}</small></button>)}
                  {!session?.captures.length && <p>No captures yet.</p>}
                </div>
                <div className="pi-remote-section-head capture"><span>Timeline</span><small>{events.length}</small></div>
                <div className="pi-remote-timeline">
                  {events.slice(-12).reverse().map((item) => <div key={item.id}><span>{item.type.replaceAll("_", " ")}</span><small>{item.summary || new Date(item.timestamp).toLocaleTimeString()}</small></div>)}
                  {!events.length && <p>Connection and command events appear here.</p>}
                </div>
              </>}
            </div>
          </aside>
        </div>}
      </div>}
    </div>
  );
}

function ProfileEditor({ draft, busy, onChange, onCancel, onSubmit }: { draft: ProfileDraft; busy: boolean; onChange: (value: ProfileDraft) => void; onCancel: () => void; onSubmit: (event: FormEvent) => void }) {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => onChange({ ...draft, [key]: value });
  const protocolChange = (protocol: "ssh" | "telnet") => onChange({ ...draft, protocol, port: protocol === "ssh" ? 22 : 23, authMethod: protocol === "ssh" ? draft.authMethod : "password", lineEnding: protocol === "ssh" ? "lf" : "crlf", telnetEnabled: false });
  return <form className="pi-remote-profile-editor" onSubmit={onSubmit}>
    <label>Name<input value={draft.name} onChange={(event) => set("name", event.target.value)} required /></label>
    <div className="row"><label>Protocol<select value={draft.protocol} onChange={(event) => protocolChange(event.target.value as "ssh" | "telnet")}><option value="ssh">SSH</option><option value="telnet">Telnet</option></select></label><label>Port<input type="number" min={1} max={65535} value={draft.port} onChange={(event) => set("port", Number(event.target.value))} /></label></div>
    <label>Host<input value={draft.host} onChange={(event) => set("host", event.target.value)} required placeholder="192.168.1.1" /></label>
    <label>Username<input value={draft.username} onChange={(event) => set("username", event.target.value)} required /></label>
    {draft.protocol === "ssh" ? <><label>Authentication<select value={draft.authMethod} onChange={(event) => set("authMethod", event.target.value as ProfileDraft["authMethod"])}><option value="key">Private key</option><option value="agent">SSH agent</option><option value="password">Temporary password</option></select></label>{draft.authMethod === "key" && <label>Key path<input value={draft.keyPath ?? ""} onChange={(event) => set("keyPath", event.target.value)} /></label>}</> : <><label className="warning"><input type="checkbox" checked={draft.telnetEnabled} onChange={(event) => set("telnetEnabled", event.target.checked)} /> I understand Telnet is unencrypted</label><label>Login prompt text <span>(optional literal suffix)</span><input value={draft.loginPrompt ?? ""} onChange={(event) => set("loginPrompt", event.target.value)} /></label><label>Password prompt text <span>(optional literal suffix)</span><input value={draft.passwordPrompt ?? ""} onChange={(event) => set("passwordPrompt", event.target.value)} /></label></>}
    <label>Device mode<select value={draft.deviceMode} onChange={(event) => {
      const mode = event.target.value as ProfileDraft["deviceMode"];
      const promptPreset = mode === "windows" ? "windows" : mode === "cisco" ? "cisco" : mode === "network-generic" || mode === "custom" ? "network" : "unix";
      onChange({
        ...draft,
        deviceMode: mode,
        commandMode: draft.protocol === "ssh" && ["auto", "freebsd", "linux"].includes(mode) ? "exec" : "shell",
        promptPreset,
        promptPattern: undefined,
        pagerPattern: undefined,
        legacyPatternRejected: false,
      });
    }}><option value="auto">Auto-detect (confirm before policy)</option><option value="linux">Linux</option><option value="freebsd">FreeBSD</option><option value="windows">Windows</option><option value="cisco">Cisco</option><option value="network-generic">Network CLI</option><option value="custom">Custom</option></select></label>
    <div className="row"><label>Encoding<select value={draft.encoding} onChange={(event) => set("encoding", event.target.value as ProfileDraft["encoding"])}><option value="utf8">UTF-8</option><option value="latin1">Latin-1</option><option value="gb18030">GB18030</option></select></label><label>Timeout (s)<input type="number" min={1} max={300} value={Math.round(draft.timeoutMs / 1000)} onChange={(event) => set("timeoutMs", Number(event.target.value) * 1000)} /></label></div>
    {draft.legacyPatternRejected && <p className="warning">A legacy regular-expression prompt was disabled. Choose a preset or enter literal prompt/pager text before connecting.</p>}
    {draft.deviceMode !== "linux" && <><label>Prompt preset<select value={draft.promptPreset} onChange={(event) => onChange({ ...draft, promptPreset: event.target.value as ProfileDraft["promptPreset"], legacyPatternRejected: false })}><option value="unix">Unix</option><option value="windows">Windows</option><option value="cisco">Cisco</option><option value="network">Generic network</option></select></label><label>Literal prompt suffix <span>(optional)</span><input value={draft.promptText ?? ""} onChange={(event) => onChange({ ...draft, promptText: event.target.value, legacyPatternRejected: false })} placeholder="device#" /></label><label>Literal pager marker <span>(optional)</span><input value={draft.pagerText ?? ""} onChange={(event) => onChange({ ...draft, pagerText: event.target.value, legacyPatternRejected: false })} placeholder="--More--" /></label><div className="row"><label>Continue key<input value={draft.pagerContinue ?? ""} maxLength={8} onChange={(event) => set("pagerContinue", event.target.value)} /></label><label>Line ending<select value={draft.lineEnding} onChange={(event) => set("lineEnding", event.target.value as ProfileDraft["lineEnding"])}><option value="lf">LF</option><option value="crlf">CRLF</option></select></label></div></>}
    <div className="actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save target"}</button></div>
  </form>;
}
