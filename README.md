# Twilio Call Experiments

Small Cloudflare Worker that exposes a single endpoint:
`POST /api/gate/open`.

It validates a code and creates a Twilio voice call with a `<Hangup/>` TwiML, then
returns the call SID/status.

## Endpoint

- `POST /api/gate/open`
- Accepts:
  - form data: `code=...`
  - JSON: `{"code":"..."}`
- Success response:
  - `200 { "ok": true, "callSid": "...", "status": "queued" }`
- Failure responses:
  - `401` `{ "ok": false, "error": "invalid_code" }`
  - `500` `{ "ok": false, "error": "config_missing" }`
  - `502` `{ "ok": false, "error": "twilio_call_failed" }`

## Environment Variables

The worker reads these from its environment.

### Core required vars

- `GATE_OPEN_CODE`
  - Shared secret required to open the gate.
  - Must match `code` in request payload.
- `TWILIO_FROM_NUMBER`
  - Caller ID you own/configured in Twilio (E.164 format).
- `GATE_TARGET_NUMBER`
  - Phone number to call (E.164 format).
- `TWILIO_ACCOUNT_SID`
  - Twilio account SID. Required unless using `TWILIO_ADAPTER=fake`.
- `TWILIO_AUTH_TOKEN`
  - Twilio auth token. Required unless using `TWILIO_ADAPTER=fake`.

### Twilio adapter behavior

- `TWILIO_ADAPTER`
  - `fake` → no network calls, uses local fake adapter.
  - `real` (or unset) → real Twilio API calls.

### Call shape controls (optional)

- `TWILIO_CALL_TIMEOUT_SECONDS` (default: `10`)
  - How long Twilio rings before giving up.
- `TWILIO_CALL_TIME_LIMIT_SECONDS` (default: `1`)
  - Maximum call duration in seconds.

## Local development

Cloudflare Workers local env is loaded from `.dev.vars`, not `.env`.

1. Copy example env:
   - `cp .dev.vars.example .dev.vars`
2. Fill real values (keep secrets out of git).
3. Start local dev server:
   - `bun run dev`
   - or verbose logs: `bun run dev:debug`

Then call the endpoint:

```bash
curl -X POST http://localhost:8787/api/gate/open \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "code=<your-gate-open-code>"
```

## Deployed worker configuration

For deployed workers, configure values as Cloudflare environment bindings (not `.env` / `.dev.vars`):

```bash
wrangler secret put GATE_OPEN_CODE
wrangler secret put GATE_TARGET_NUMBER
wrangler secret put TWILIO_FROM_NUMBER
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put TWILIO_CALL_TIMEOUT_SECONDS
wrangler secret put TWILIO_CALL_TIME_LIMIT_SECONDS
```

You can also set non-secret vars through the Cloudflare dashboard if preferred.

## CORS

This endpoint currently allows browser requests from:

- `https://holmevann.no`
- `https://www.holmevann.no`
- `localhost` (any port/protocol)

## Notes

- This project is intentionally built with a small functional core and an imperative shell:
  - `src/gate.ts` contains pure logic
  - Twilio interaction happens in `src/twilio.ts` adapters
- See [AGENTS.md](/Users/carlerik/dev/twilio-call-experiments/AGENTS.md) for architecture guidance.
