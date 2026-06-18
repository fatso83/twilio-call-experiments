# Project Guidelines

## Architecture

Use functional core, imperative shell.

- Keep business rules in pure functions that accept data and return data.
- Push side effects to the edges: HTTP parsing, environment access, logging, network calls, timers, and platform APIs.
- Model external services as ports with real and fake adapters.
- Prefer small modules with explicit inputs over modules that read global state.

For Twilio integration:

- Define a `TwilioPort` for the behavior this app needs.
- Use `TwilioRealAdapter` only at the worker edge.
- Use `TwilioFakeAdapter` for tests and local behavior checks.
- Do not import Twilio Node SDKs. Cloudflare Workers run on the edge runtime and should call Twilio with `fetch`.

## Testing

- Write tests before production code for new behavior.
- Test functional core logic without network mocks.
- Test shell/adapters with injected dependencies such as fake `fetch`.
- Avoid tests that can accidentally trigger a real Twilio call.

## Configuration

- Treat secrets as environment bindings, never checked-in values.
- Keep Twilio account credentials, phone numbers, and gate codes in Cloudflare Worker environment variables.
- Fail closed when required config is missing.

For local development with `wrangler dev`, use `.dev.vars`:

- Keep `.env` and other shell-only files for terminal sessions only.
- Copy `.dev.vars.example` to `.dev.vars` and set local values there.
- Prefer `TWILIO_ADAPTER=fake` for development so no network I/O is attempted.

For call shape control:

- `TWILIO_CALL_TIMEOUT_SECONDS` controls how long Twilio rings before giving up (default `10`).
- `TWILIO_CALL_TIME_LIMIT_SECONDS` controls max connected call duration in seconds (default `1`).

## Style

- Prefer TypeScript and Web Platform APIs.
- Keep responses JSON-shaped for API endpoints.
- Return narrow, stable error codes from API handlers; keep sensitive details out of responses.
