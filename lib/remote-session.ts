import { areSameFilePath } from "./path-identity";
import { getCachedSessionFile, resolveSessionPath } from "./session-reader";

export interface RemoteSessionContext {
  id: string;
  filePath: string;
  cwd: string;
}

export class RemoteSessionNotFoundError extends Error {
  constructor() {
    super("Remote session not found");
    this.name = "RemoteSessionNotFoundError";
  }
}

export async function requireRemoteSession(agentSessionId: string, requestedCwd?: string): Promise<RemoteSessionContext> {
  const id = agentSessionId.trim();
  if (!id) throw new RemoteSessionNotFoundError();
  const filePath = await resolveSessionPath(id);
  if (!filePath) throw new RemoteSessionNotFoundError();
  try {
    const header = getCachedSessionFile(filePath).header;
    if (!header || header.type !== "session" || header.id !== id || typeof header.cwd !== "string" || !header.cwd) {
      throw new RemoteSessionNotFoundError();
    }
    if (requestedCwd !== undefined && !areSameFilePath(header.cwd, requestedCwd)) throw new RemoteSessionNotFoundError();
    return { id, filePath, cwd: header.cwd };
  } catch (error) {
    if (error instanceof RemoteSessionNotFoundError) throw error;
    throw new RemoteSessionNotFoundError();
  }
}

export function remoteSessionErrorStatus(error: unknown): number {
  return error instanceof RemoteSessionNotFoundError ? 404 : 400;
}
