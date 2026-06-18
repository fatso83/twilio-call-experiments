export type TwilioCallRequest = {
  from: string;
  to: string;
  twiml: string;
  timeoutSeconds?: number;
  timeLimitSeconds?: number;
  statusCallbackUrl?: string;
};

export type TwilioCallResult = {
  sid: string;
  status: string;
};

export interface TwilioPort {
  createCall(call: TwilioCallRequest): Promise<TwilioCallResult>;
}

export type TwilioAdapterMode = "fake" | "real";

export const DEFAULT_TWILIO_ADAPTER: TwilioAdapterMode = "fake";

export function resolveTwilioAdapterMode(adapter?: string): TwilioAdapterMode {
  const normalized = adapter?.trim().toLowerCase();

  if (normalized === "real") {
    return "real";
  }

  if (normalized === "fake") {
    return "fake";
  }

  return DEFAULT_TWILIO_ADAPTER;
}

export class TwilioFakeAdapter implements TwilioPort {
  readonly calls: TwilioCallRequest[] = [];

  async createCall(call: TwilioCallRequest): Promise<TwilioCallResult> {
    this.calls.push(call);

    return {
      sid: "fake-call",
      status: "queued",
    };
  }
}

export type TwilioRealAdapterConfig = {
  accountSid?: string;
  authToken?: string;
  callTimeoutSeconds: number;
  callTimeLimitSeconds: number;
};

type Fetch = typeof fetch;

export class TwilioRealAdapter implements TwilioPort {
  constructor(
    private readonly config: TwilioRealAdapterConfig,
    private readonly fetchImpl: Fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async createCall(call: TwilioCallRequest): Promise<TwilioCallResult> {
    if (!this.config.accountSid || !this.config.authToken) {
      throw new Error("twilio_config_missing");
    }

    const body = new URLSearchParams();
    body.set("To", call.to);
    body.set("From", call.from);
    body.set("Twiml", call.twiml);
    body.set("Timeout", String(call.timeoutSeconds ?? this.config.callTimeoutSeconds));
    body.set(
      "TimeLimit",
      String(call.timeLimitSeconds ?? this.config.callTimeLimitSeconds),
    );

    if (call.statusCallbackUrl) {
      body.set("StatusCallback", call.statusCallbackUrl);
      body.set(
        "StatusCallbackEvent",
        "completed",
      );
      body.set("StatusCallbackMethod", "POST");
    }

    const payload = body.toString();
    const credentials = `${this.config.accountSid}:${this.config.authToken}`;
    let auth = "";

    if (typeof globalThis.btoa === "function") {
      try {
        auth = globalThis.btoa(credentials);
      } catch {
        // no-op, fallback below
      }
    }

    if (!auth && typeof btoa === "function") {
      try {
        auth = btoa(credentials);
      } catch {
        // no-op
      }
    }

    if (!auth) {
      throw new Error("twilio_auth_encoding_unavailable");
    }

    const response = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payload,
      },
    );

    if (!response.ok) {
      const status = response.status;
      const statusText = response.statusText || "unknown";
      let message = "twilio_request_failed";

      try {
        const responseText = await response.text();
        if (responseText) {
          message = `twilio_request_failed ${status} ${statusText}: ${responseText.slice(
            0,
            500,
          )}`;
        } else {
          message = `twilio_request_failed ${status} ${statusText}`;
        }
      } catch {
        message = `twilio_request_failed ${status} ${statusText}`;
      }

      throw new Error(message);
    }

    const responsePayload = (await response.json()) as {
      sid?: string;
      status?: string;
    };

    return {
      sid: responsePayload.sid ?? "",
      status: responsePayload.status ?? "",
    };
  }
}
