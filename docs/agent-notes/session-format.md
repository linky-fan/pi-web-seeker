# Pi Session File Format

Session files live at:

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

Each line is one JSON object. The first line is the session header, followed by entries such as model changes, messages, compactions, and session metadata.

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],"...":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":0}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is parallel to `messages[]`. It maps each displayed message to its `.jsonl` entry id and is used for fork and `navigate_tree` calls.

## Notes

- `parentSession` is display metadata and does not affect message context.
- Orphaned sessions are files whose first line cannot be parsed as a valid session header.
- Stored tool calls may use `{ id, name, arguments }`; UI code expects `{ toolCallId, toolName, input }`, so use `normalizeToolCalls()` when loading or streaming.
- Plan Mode is runtime UI/RPC state and does not add fields to session entries. It is remembered by Pi Web localStorage per session or cwd.
- Debug Bundle import/export does not change the JSONL schema. Export writes normalized entries to `session/session.jsonl`, externalizes inline media into `media/*`, and records workspace files and diagnostics in the bundle manifest. Import rehydrates media back into entries and rewrites the restored session header `cwd` to the new sandbox directory; the original absolute cwd stays metadata only.
