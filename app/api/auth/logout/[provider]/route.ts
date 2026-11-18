import { createAppModelRuntime } from "@/lib/model-registry";
import { invalidateModelsPayloadCache } from "@/lib/models-payload";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const runtime = await createAppModelRuntime();
  if (!runtime.getProvider(provider)?.auth.oauth) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await runtime.logout(provider);
  invalidateModelsPayloadCache();
  return Response.json({ ok: true });
}
