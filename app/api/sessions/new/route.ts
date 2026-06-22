// Legacy no-op for older clients; new sessions are created through /api/agent/new.
export const dynamic = "force-dynamic";

export async function POST() {
  return new Response("Legacy route", { status: 410 });
}
