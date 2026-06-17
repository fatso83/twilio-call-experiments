import { planGateOpen } from "./gate";
import {
  TwilioFakeAdapter,
  TwilioPort,
  TwilioRealAdapter,
} from "./twilio";

export type Env = {
  GATE_OPEN_CODE?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  GATE_TARGET_NUMBER?: string;
  TWILIO_ADAPTER?: "fake" | "real";
};

export async function handleRequest(
  request: Request,
  env: Env,
  twilio: TwilioPort,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname !== "/api/gate/open") {
    return json({ ok: false, error: "not_found" }, 404);
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, {
      Allow: "POST",
    });
  }

  const code = await readCode(request);
  const decision = planGateOpen(
    { code },
    {
      gateOpenCode: env.GATE_OPEN_CODE,
      twilioFromNumber: env.TWILIO_FROM_NUMBER,
      gateTargetNumber: env.GATE_TARGET_NUMBER,
    },
  );

  if (!decision.ok) {
    return json({ ok: false, error: decision.error }, decision.status);
  }

  try {
    const call = await twilio.createCall(decision.call);

    return json({
      ok: true,
      callSid: call.sid,
      status: call.status,
    }, 200);
  } catch {
    return json({ ok: false, error: "twilio_call_failed" }, 502);
  }
}

export function createTwilioAdapter(env: Env): TwilioPort {
  if (env.TWILIO_ADAPTER === "fake") {
    return new TwilioFakeAdapter();
  }

  return new TwilioRealAdapter({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
  });
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
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, createTwilioAdapter(env));
  },
};
