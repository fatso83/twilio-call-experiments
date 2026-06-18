import {
  TwilioFakeAdapter,
  TwilioPort,
  resolveTwilioAdapterMode,
  TwilioRealAdapter,
} from "./twilio";

import { planGateOpen } from "./gate";

export type Env = {
  GATE_OPEN_CODE?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  GATE_TARGET_NUMBER?: string;
  TWILIO_ADAPTER?: "fake" | "real";
  TWILIO_CALL_TIMEOUT_SECONDS?: string;
  TWILIO_CALL_TIME_LIMIT_SECONDS?: string;
};

export type Logger = Pick<Console, "error" | "info" | "warn">;

const ALLOWED_ORIGINS = [
  "https://holmevann.no",
  "https://www.holmevann.no",
] as const as readonly string[];

const COMMON_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Credentials": "false",
};

const ENDPOINT_CORS_PRESET = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const TWILIO_STATUS_CALLBACK_PATH = "/api/twilio/status-callback";
const TWILIO_STATUS_CALLBACK_EVENT_FIELDS = [
  "CallSid",
  "CallStatus",
  "ErrorCode",
  "ErrorMessage",
  "SipResponseCode",
  "SipResponseText",
] as const;

const TWILIO_SIP_RESPONSE_INTERPRETATION: Record<string, string> = {
  "403": "Call rejected by destination network (carrier policy, number filtering, or blocked caller ID)",
  "404": "Destination not found / unavailable target endpoint",
  "486": "Called party is busy",
  "487": "Call cancelled or terminated during setup",
  "488": "Not acceptable to destination endpoint",
  "503": "Service unavailable at destination (retry later)",
  "480": "Destination did not answer (no response)",
  "484": "Address incomplete or invalid number format",
  "410": "Temporary network failure or unreachable destination",
};

export async function handleRequest(
  request: Request,
  env: Env,
  twilio: TwilioPort,
  logger: Logger = console,
): Promise<Response> {
  const url = new URL(request.url);
  const allowedOrigin = resolveAllowedOrigin(request.headers.get("Origin"));
  const corsHeaders = createCorsHeaders(allowedOrigin);

  if (url.pathname === TWILIO_STATUS_CALLBACK_PATH) {
    return handleTwilioStatusCallback(request, logger);
  }

  if (url.pathname !== "/api/gate/open") {
    return json({ ok: false, error: "not_found" }, 404, corsHeaders);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...ENDPOINT_CORS_PRESET,
        ...corsHeaders,
      },
    });
  }

  if (request.method !== "POST") {
    return json(
      { ok: false, error: "method_not_allowed" },
      405,
      {
        Allow: "POST",
        ...corsHeaders,
      },
    );
  }

  const code = await readCode(request);
  logger.info("gate.open.request", {
    contentType: request.headers.get("Content-Type") ?? "",
    hasCode: code !== undefined,
    path: url.pathname,
  });

  const decision = planGateOpen(
    { code },
    {
      gateOpenCode: env.GATE_OPEN_CODE,
      twilioFromNumber: env.TWILIO_FROM_NUMBER,
      gateTargetNumber: env.GATE_TARGET_NUMBER,
    },
  );

  if (!decision.ok) {
    if (decision.error === "config_missing") {
      logger.warn("gate.open.config_missing", {
        missing: missingConfigNames(env),
        path: url.pathname,
      });
    } else {
      logger.warn("gate.open.invalid_code", {
        path: url.pathname,
      });
    }

    return json({ ok: false, error: decision.error }, decision.status, corsHeaders);
  }

  try {
    const callbackUrl = buildStatusCallbackUrl(url);
    const call = {
      ...decision.call,
      statusCallbackUrl: callbackUrl,
    };

    logger.info("gate.open.twilio_call_create", {
      adapter: resolveTwilioAdapterMode(env.TWILIO_ADAPTER),
      to: decision.call.to,
      from: decision.call.from,
      toConfigured: decision.call.to.length > 0,
      statusCallbackUrl: callbackUrl,
      statusCallbackEnabled: callbackUrl.length > 0,
    });

    const callResult = await twilio.createCall(call);
    logger.info("gate.open.twilio_call_created", {
      callSid: callResult.sid,
      status: callResult.status,
    });

    return json(
      {
        ok: true,
        callSid: callResult.sid,
        status: callResult.status,
      },
      200,
      corsHeaders,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    logger.error("gate.open.twilio_call_failed", {
      error: message,
      to: decision.call.to,
      from: decision.call.from,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return json(
      { ok: false, error: "twilio_call_failed" },
      502,
      corsHeaders,
    );
  }
}

export async function handleTwilioStatusCallback(
  request: Request,
  logger: Logger,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(
      { ok: false, error: "method_not_allowed" },
      405,
      {
        Allow: "POST",
      },
    );
  }

  const payload = await readTwilioStatusCallbackPayload(request);
  const eventSummary = summarizeCallbackPayload(payload);
  const sipSummary = summarizeSipResponse(payload);

  logger.info("twilio.status_callback", {
    payload,
    ...eventSummary,
    ...sipSummary,
  });

  return json({ ok: true }, 200);
}

function summarizeCallbackPayload(
  payload: Record<string, string>,
): Record<string, string | undefined> {
  const fields = {} as Record<string, string | undefined>;

  for (const name of TWILIO_STATUS_CALLBACK_EVENT_FIELDS) {
    fields[name] = payload[name];
  }

  return fields;
}

function summarizeSipResponse(
  payload: Record<string, string>,
): Record<string, string | undefined> {
  const sipResponseCode = payload.SipResponseCode;
  const sipResponseText = payload.SipResponseText;

  if (!sipResponseCode) {
    return {};
  }

  const interpretation =
    TWILIO_SIP_RESPONSE_INTERPRETATION[sipResponseCode] ??
    `Unknown SIP response ${sipResponseCode}${sipResponseText ? `: ${sipResponseText}` : ""}`;

  return {
    SipResponseInterpretation: interpretation,
  };
}

async function readTwilioStatusCallbackPayload(
  request: Request,
): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      return normalizePayloadRecord(payload);
    } catch {
      return {};
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const form = await request.formData();
      const entries = Object.fromEntries(form.entries());
      return normalizePayloadRecord(entries as Record<string, unknown>);
    } catch {
      return {};
    }
  }

  try {
    const body = await request.text();
    if (!body) {
      return {};
    }

    return normalizePayloadRecord(Object.fromEntries(new URLSearchParams(body)));
  } catch {
    return {};
  }
}

function normalizePayloadRecord(
  raw: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      out[key] = value;
    } else if (value instanceof File) {
      // Ignore non-scalar fields from form parsing.
      continue;
    }
  }

  return out;
}

function buildStatusCallbackUrl(url: URL): string {
  const callbackBase = new URL(url.origin);
  callbackBase.pathname = TWILIO_STATUS_CALLBACK_PATH;
  callbackBase.search = "";
  callbackBase.hash = "";
  return callbackBase.toString();
}

export function createTwilioAdapter(env: Env): TwilioPort {
  if (resolveTwilioAdapterMode(env.TWILIO_ADAPTER) === "fake") {
    return new TwilioFakeAdapter();
  }

  return new TwilioRealAdapter({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    callTimeoutSeconds: parsePositiveInt(
      env.TWILIO_CALL_TIMEOUT_SECONDS,
      10,
    ),
    callTimeLimitSeconds: parsePositiveInt(
      env.TWILIO_CALL_TIME_LIMIT_SECONDS,
      15,
    ),
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const number = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(number) || number <= 0) {
    return fallback;
  }

  return number;
}

function missingConfigNames(env: Env): string[] {
  const required: Array<keyof Env> = [
    "GATE_OPEN_CODE",
    "TWILIO_FROM_NUMBER",
    "GATE_TARGET_NUMBER",
  ];

  if (resolveTwilioAdapterMode(env.TWILIO_ADAPTER) !== "fake") {
    required.push("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN");
  }

  return required.filter((name) => !env[name]);
}

async function readCode(request: Request): Promise<string | undefined> {
  const contentType = request.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await request.json()) as { code?: unknown };
      return typeof payload.code === "string" ? payload.code : undefined;
    } catch {
      return undefined;
    }
  }

  try {
    const form = await request.formData();
    const code = form.get("code");
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function json(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...COMMON_RESPONSE_HEADERS,
      ...headers,
    },
  });
}

function createCorsHeaders(origin: string | undefined): HeadersInit {
  if (!origin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function resolveAllowedOrigin(origin: string | null): string | undefined {
  if (!origin) {
    return undefined;
  }

  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }

  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.hostname === "localhost") {
      return origin;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, createTwilioAdapter(env));
  },
};
