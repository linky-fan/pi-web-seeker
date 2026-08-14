import assert from "node:assert/strict";
import test from "node:test";

const { createAgentEventStream } = await import("../app/api/agent/[id]/events/route.ts");

function decode(value) {
  return new TextDecoder().decode(value);
}

test("Agent SSE abort cleanup is idempotent and ignores late events", async () => {
  const requestController = new AbortController();
  let listener = null;
  let unsubscribeCalls = 0;
  const session = {
    onEvent(next) {
      listener = next;
      return () => { unsubscribeCalls += 1; };
    },
  };
  const stream = createAgentEventStream(
    new Request("http://localhost/api/agent/session/events", { signal: requestController.signal }),
    session,
    "session",
    60_000,
  );
  const reader = stream.getReader();

  const connected = await reader.read();
  assert.match(decode(connected.value), /"type":"connected"/);
  listener({ type: "agent_start" });
  const event = await reader.read();
  assert.match(decode(event.value), /"type":"agent_start"/);

  requestController.abort();
  requestController.abort();
  assert.doesNotThrow(() => listener({ type: "late_event" }));
  assert.equal((await reader.read()).done, true);
  assert.equal(unsubscribeCalls, 1);
});

test("Agent SSE reader cancellation clears heartbeat and subscription once", async () => {
  let unsubscribeCalls = 0;
  const session = {
    onEvent() {
      return () => { unsubscribeCalls += 1; };
    },
  };
  const stream = createAgentEventStream(
    new Request("http://localhost/api/agent/session/events"),
    session,
    "session",
    60_000,
  );
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
  await reader.cancel();
  assert.equal(unsubscribeCalls, 1);
});
