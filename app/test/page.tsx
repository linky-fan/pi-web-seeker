"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "@/lib/types";

type SessionDetail = {
  sessionId: string;
  leafId: string | null;
  context?: { messages?: unknown[]; entryIds?: string[] };
  info?: SessionInfo | null;
};

type RunTarget = "detail" | "context" | "both";

type TimingRow = {
  index: number;
  target: RunTarget;
  status: number;
  durationMs: number;
  messages: number | null;
  entryIds: number | null;
  error?: string;
};

function fmtMs(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ms`;
}

function sessionLabel(session: SessionInfo): string {
  const name = session.name?.trim() || session.firstMessage?.trim();
  return name ? name.slice(0, 96) : session.id;
}

async function timedJson<T>(url: string): Promise<{ status: number; durationMs: number; body: T }> {
  const start = performance.now();
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, durationMs: performance.now() - start, body };
}

export default function SessionCacheTestPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [iterations, setIterations] = useState(6);
  const [running, setRunning] = useState<RunTarget | null>(null);
  const [rows, setRows] = useState<TimingRow[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [sessions, selectedId]
  );

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const ok = rows.filter((row) => !row.error && row.status >= 200 && row.status < 300);
    if (ok.length === 0) return null;
    const total = ok.reduce((sum, row) => sum + row.durationMs, 0);
    const fastest = Math.min(...ok.map((row) => row.durationMs));
    const slowest = Math.max(...ok.map((row) => row.durationMs));
    return { avg: total / ok.length, fastest, slowest, count: ok.length };
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sessions", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ sessions: SessionInfo[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setSessions(data.sessions);
        setSelectedId((current) => current || data.sessions[0]?.id || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDetail = useCallback(async (sessionId: string, index: number): Promise<{ row: TimingRow; detail?: SessionDetail }> => {
    const url = `/api/sessions/${encodeURIComponent(sessionId)}?includeState&run=${Date.now()}-${index}`;
    try {
      const result = await timedJson<SessionDetail & { error?: string }>(url);
      if (result.body?.error) throw new Error(result.body.error);
      setDetail(result.body);
      return {
        detail: result.body,
        row: {
        index,
        target: "detail",
        status: result.status,
        durationMs: result.durationMs,
        messages: result.body.context?.messages?.length ?? null,
        entryIds: result.body.context?.entryIds?.length ?? null,
        },
      };
    } catch (err) {
      return {
        row: {
          index,
          target: "detail",
          status: 0,
          durationMs: 0,
          messages: null,
          entryIds: null,
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }, []);

  const loadContext = useCallback(async (sessionId: string, leafId: string | null | undefined, index: number): Promise<TimingRow> => {
    const params = new URLSearchParams({ run: `${Date.now()}-${index}` });
    if (leafId) params.set("leafId", leafId);
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/context?${params.toString()}`;
    try {
      const result = await timedJson<{ context?: { messages?: unknown[]; entryIds?: string[] }; error?: string }>(url);
      if (result.body?.error) throw new Error(result.body.error);
      return {
        index,
        target: "context",
        status: result.status,
        durationMs: result.durationMs,
        messages: result.body.context?.messages?.length ?? null,
        entryIds: result.body.context?.entryIds?.length ?? null,
      };
    } catch (err) {
      return {
        index,
        target: "context",
        status: 0,
        durationMs: 0,
        messages: null,
        entryIds: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, []);

  const runTest = useCallback(async (target: RunTarget) => {
    if (!selectedId || running) return;
    setRunning(target);
    setRows([]);
    setError(null);

    let currentDetail = detail;
    for (let i = 1; i <= iterations; i++) {
      const nextRows: TimingRow[] = [];
      if (target === "detail" || target === "both") {
        const result = await loadDetail(selectedId, i);
        nextRows.push(result.row);
        if (result.detail) currentDetail = result.detail;
      }
      if (target === "context" || target === "both") {
        nextRows.push(await loadContext(selectedId, currentDetail?.leafId, i));
      }
      setRows((prev) => [...prev, ...nextRows]);
    }
    setRunning(null);
  }, [detail, iterations, loadContext, loadDetail, running, selectedId]);

  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text)", padding: 24 }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              /test
            </div>
            <h1 style={{ margin: 0, fontSize: 24, letterSpacing: 0 }}>Session Cache Test</h1>
          </div>
          <Link href="/" style={{ color: "var(--accent)", fontSize: 13, textDecoration: "none" }}>Back to app</Link>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px", gap: 10 }}>
          <select
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setRows([]);
              setDetail(null);
            }}
            disabled={running !== null}
            style={{
              minWidth: 0,
              height: 38,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-panel)",
              color: "var(--text)",
              padding: "0 10px",
              fontSize: 13,
            }}
          >
            {sessions.length === 0 ? (
              <option value="">No sessions found</option>
            ) : sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {sessionLabel(session)}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={1}
            max={50}
            value={iterations}
            disabled={running !== null}
            onChange={(event) => setIterations(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
            style={{
              height: 38,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-panel)",
              color: "var(--text)",
              padding: "0 10px",
              fontSize: 13,
            }}
          />
        </section>

        <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["detail", "context", "both"] as RunTarget[]).map((target) => (
            <button
              key={target}
              onClick={() => runTest(target)}
              disabled={!selectedId || running !== null}
              style={{
                height: 34,
                padding: "0 12px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: running === target ? "var(--bg-selected)" : "var(--bg-panel)",
                color: running === target ? "var(--accent)" : "var(--text)",
                cursor: !selectedId || running ? "default" : "pointer",
                fontSize: 13,
                textTransform: "capitalize",
              }}
            >
              {running === target ? "Running..." : `Run ${target}`}
            </button>
          ))}
        </section>

        {error && (
          <div style={{ border: "1px solid rgba(248,113,113,0.45)", color: "#f87171", padding: 12, borderRadius: 6, fontSize: 13 }}>
            {error}
          </div>
        )}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          {[
            ["Average", summary ? fmtMs(summary.avg) : "-"],
            ["Fastest", summary ? fmtMs(summary.fastest) : "-"],
            ["Slowest", summary ? fmtMs(summary.slowest) : "-"],
            ["Samples", summary ? String(summary.count) : "0"],
          ].map(([label, value]) => (
            <div key={label} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12, background: "var(--bg-panel)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18 }}>{value}</div>
            </div>
          ))}
        </section>

        {selectedSession && (
          <section style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: 12 }}>
            <div style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
              <div><span style={{ color: "var(--text)" }}>Session:</span> {selectedSession.id}</div>
              <div><span style={{ color: "var(--text)" }}>cwd:</span> {selectedSession.cwd}</div>
              <div><span style={{ color: "var(--text)" }}>leaf:</span> {detail?.leafId ?? "-"}</div>
            </div>
          </section>
        )}

        <section style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "var(--bg-panel)", color: "var(--text-muted)" }}>
              <tr>
                {["#", "Target", "Status", "Duration", "Messages", "Entry IDs", "Error"].map((head) => (
                  <th key={head} style={{ textAlign: "left", padding: "9px 10px", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 18, color: "var(--text-muted)", textAlign: "center" }}>
                    No samples yet
                  </td>
                </tr>
              ) : rows.map((row, idx) => (
                <tr key={`${row.index}-${row.target}-${idx}`}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>{row.index}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>{row.target}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: row.error ? "#f87171" : "var(--text)" }}>{row.status || "-"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>{row.error ? "-" : fmtMs(row.durationMs)}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>{row.messages ?? "-"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>{row.entryIds ?? "-"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "#f87171" }}>{row.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
