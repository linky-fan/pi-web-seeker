import { AgentCommandError, isProjectTrustRequiredError } from "./agent-client";
import { apiPath } from "./api-path";

export type PackageEnable = () => Promise<void>;

export interface PackageTrustSnapshot {
  cwd: string | null;
  resolving: boolean;
}

export type PackageTrustFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class PackageTrustGateController {
  private snapshot: PackageTrustSnapshot = { cwd: null, resolving: false };
  private pendingEnable: PackageEnable | null = null;
  private listeners = new Set<() => void>();
  private readonly fetchImpl: PackageTrustFetch;

  constructor(fetchImpl: PackageTrustFetch = (...args) => fetch(...args)) {
    this.fetchImpl = fetchImpl;
  }

  getSnapshot = (): PackageTrustSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(next: PackageTrustSnapshot): void {
    if (next.cwd === this.snapshot.cwd && next.resolving === this.snapshot.resolving) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  runWithTrust = async (workspace: string, enable: PackageEnable): Promise<void> => {
    this.pendingEnable = enable;
    try {
      await enable();
      this.pendingEnable = null;
      this.update({ cwd: null, resolving: this.snapshot.resolving });
    } catch (error) {
      if (isProjectTrustRequiredError(error)) {
        this.update({ cwd: error.cwd, resolving: this.snapshot.resolving });
        return;
      }
      this.pendingEnable = null;
      this.update({ cwd: null, resolving: this.snapshot.resolving });
      throw error;
    }
  };

  resolve = async (trusted: boolean): Promise<void> => {
    const workspace = this.snapshot.cwd;
    const enable = this.pendingEnable;
    if (!workspace || !enable || this.snapshot.resolving) return;

    this.update({ cwd: workspace, resolving: true });
    try {
      const response = await this.fetchImpl(apiPath("workspaces/trust"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: workspace, trusted }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) {
        throw new AgentCommandError(result.error ?? `HTTP ${response.status}`, response.status);
      }

      if (!trusted) {
        this.pendingEnable = null;
        this.update({ cwd: null, resolving: true });
        return;
      }

      this.update({ cwd: null, resolving: true });
      await this.runWithTrust(workspace, enable);
    } finally {
      this.update({ ...this.snapshot, resolving: false });
    }
  };

  dismiss = (): void => {
    if (this.snapshot.resolving) return;
    this.pendingEnable = null;
    this.update({ cwd: null, resolving: false });
  };
}