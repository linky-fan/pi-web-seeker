"use client";

import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { apiPath } from "@/lib/api-path";
import type { SessionInfo } from "@/lib/types";
import { isDebugBundleFile } from "./helpers";
import type { DebugBundleSummary } from "./types";

interface Options {
  applyImportedSession: (session: SessionInfo) => void;
}

export function useSessionImportController({ applyImportedSession }: Options) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugBundleFile, setDebugBundleFile] = useState<File | null>(null);
  const [debugBundleSummary, setDebugBundleSummary] = useState<DebugBundleSummary | null>(null);

  const resetDebugBundle = useCallback(() => {
    setDebugBundleFile(null);
    setDebugBundleSummary(null);
  }, []);

  const openPicker = useCallback(() => {
    setError(null);
    resetDebugBundle();
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  }, [resetDebugBundle]);

  const handleFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    resetDebugBundle();
    try {
      const form = new FormData();
      form.append("file", file);
      if (isDebugBundleFile(file)) {
        const response = await fetch(apiPath("debug-bundles/inspect"), { method: "POST", body: form });
        const data = await response.json().catch(() => ({})) as { summary?: DebugBundleSummary; error?: string };
        if (!response.ok || !data.summary) throw new Error(data.error ?? `HTTP ${response.status}`);
        setDebugBundleFile(file);
        setDebugBundleSummary(data.summary);
        return;
      }

      const response = await fetch(apiPath("sessions/import"), { method: "POST", body: form });
      const data = await response.json().catch(() => ({})) as { session?: SessionInfo; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error ?? `HTTP ${response.status}`);
      applyImportedSession(data.session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setImporting(false);
      input.value = "";
    }
  }, [applyImportedSession, resetDebugBundle]);

  const confirmDebugBundle = useCallback(async () => {
    if (!debugBundleFile) return;
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", debugBundleFile);
      form.append("confirm", "1");
      const response = await fetch(apiPath("debug-bundles/import"), { method: "POST", body: form });
      const data = await response.json().catch(() => ({})) as { session?: SessionInfo; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error ?? `HTTP ${response.status}`);
      resetDebugBundle();
      applyImportedSession(data.session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setImporting(false);
    }
  }, [applyImportedSession, debugBundleFile, resetDebugBundle]);

  const cancelDebugBundle = useCallback(() => {
    resetDebugBundle();
    setError(null);
  }, [resetDebugBundle]);

  return {
    inputRef,
    importing,
    error,
    debugBundleSummary,
    openPicker,
    handleFile,
    confirmDebugBundle,
    cancelDebugBundle,
  };
}
