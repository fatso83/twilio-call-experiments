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

export async function handleRequest(
  request: Request,
  env: Env,
  twilio: TwilioPort,
  logger: Logger = console,
): Promise<Response> {
  const url = new URL(request.url);
  const allowedOrigin = resolveAllowedOrigin(request.headers.get("Origin"));
  const corsHeaders = createCorsHeaders(allowedOrigin);

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
    logger.info("gate.open.twilio_call_create", {
      adapter: resolveTwilioAdapterMode(env.TWILIO_ADAPTER),
      to: decision.call.to,
      from: decision.call.from,
      toConfigured: decision.call.to.length > 0,
    });

    const call = await twilio.createCall(decision.call);
    logger.info("gate.open.twilio_call_created", {
      callSid: call.sid,
      status: call.status,
    });

    return json(
      {
        ok: true,
        callSid: call.sid,
        status: call.status,
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
      1,
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
