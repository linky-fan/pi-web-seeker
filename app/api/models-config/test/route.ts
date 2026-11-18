import { NextResponse } from "next/server";
import { literalCredentialRejection, nonLiteralHeaderName } from "@/lib/model-test-credentials";
import { runModelConnectionTest } from "@/lib/model-test-runner";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function credentialErrorMessage(rejection: "empty" | "command" | "env-reference", subject: string): string {
  if (rejection === "empty") return `${subject} must be entered in this form to run a connection test`;
  if (rejection === "command") return `${subject} cannot run a shell command during a connection test; enter the literal value`;
  return `${subject} cannot reference an environment variable during a connection test; enter the literal value`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown; model?: unknown; allowNoAuth?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ ok: false, error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ ok: false, error: "provider is required" }, { status: 400 });
    if (!isRecord(body.model)) return NextResponse.json({ ok: false, error: "model is required" }, { status: 400 });

    const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
    if (!modelId) return NextResponse.json({ ok: false, error: "Model ID is required" }, { status: 400 });

    const apiKey = typeof body.provider.apiKey === "string" ? body.provider.apiKey : "";
    const allowNoAuth = body.allowNoAuth === true;
    const keyRejection = literalCredentialRejection(apiKey);
    // A keyless endpoint may send no key at all, but a typed key is still never resolved.
    if (keyRejection && !(allowNoAuth && keyRejection === "empty")) {
      return NextResponse.json({ ok: false, error: credentialErrorMessage(keyRejection, "API key") }, { status: 400 });
    }

    const headerName = nonLiteralHeaderName(body.provider, body.model);
    if (headerName) {
      return NextResponse.json({
        ok: false,
        error: `Header "${headerName}" cannot use shell commands or environment variables during a connection test; enter a literal value`,
      }, { status: 400 });
    }

    const result = await runModelConnectionTest({ providerName, provider: body.provider, model: body.model, apiKey, allowNoAuth });
    if (result.ok) return NextResponse.json(result);
    const { httpStatus, ...failure } = result;
    return NextResponse.json(failure, httpStatus ? { status: httpStatus } : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}