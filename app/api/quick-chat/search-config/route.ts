import {
  getQuickChatSearchConfig,
  QuickChatSearchError,
  removeQuickChatSearchApiKey,
  saveQuickChatSearchApiKey,
} from "@/lib/quick-chat-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CONFIG_BYTES = 8 * 1024;

function errorResponse(error: unknown): Response {
  const status = error instanceof QuickChatSearchError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

export async function GET() {
  return Response.json(getQuickChatSearchConfig());
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CONFIG_BYTES) return Response.json({ error: "Request is too large" }, { status: 413 });
  try {
    const body = await req.json() as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 4_096) throw new QuickChatSearchError("A valid Tavily API key is required", 400);
    saveQuickChatSearchApiKey(apiKey);
    return Response.json(getQuickChatSearchConfig());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    removeQuickChatSearchApiKey();
    return Response.json(getQuickChatSearchConfig());
  } catch (error) {
    return errorResponse(error);
  }
}
