# Automation Driver Design

`pipeline.js` owns orchestration: build prompts, run the eight steps, emit socket
events, and collect results.

`claude.js` is the Claude driver boundary. Keep all Claude.ai web details here:

- browser navigation
- project lookup
- model selection
- prompt submission
- response extraction
- chat rename
- retry/continue handling

Do not put Playwright selectors or Claude.ai internal API routes in
`pipeline.js`. That keeps the pipeline replaceable.

## Current Driver

The active path is the Claude.ai web driver in
`providers/claudeWebProvider.js`, backed by the Playwright helpers in
`claude.js`. This matches the current product flow: a logged-in Claude Max
browser session on Claude.ai, Claude Projects, and visible chat history.

For stability, the driver prefers:

1. Internal Claude.ai API calls for metadata-style operations when practical.
2. UI fallback with verification for rename.
3. Conversation text snapshots before the composer for response detection,
   instead of brittle single-message DOM selectors.

## Long-Term Target

Keep `pipeline.js` selector-free. If Claude.ai changes its DOM, most fixes
should stay inside `claude.js` or the web provider wrapper. That makes the app
easier to maintain while still using the Claude Max web account flow.
