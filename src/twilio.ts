export type TwilioCallRequest = {
  from: string;
  to: string;
  twiml: string;
};

export type TwilioCallResult = {
  sid: string;
  status: string;
};

export interface TwilioPort {
  createCall(call: TwilioCallRequest): Promise<TwilioCallResult>;
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
};

type Fetch = typeof fetch;

export class TwilioRealAdapter implements TwilioPort {
  constructor(
    private readonly config: TwilioRealAdapterConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async createCall(call: TwilioCallRequest): Promise<TwilioCallResult> {
    if (!this.config.accountSid || !this.config.authToken) {
      throw new Error("twilio_config_missing");
    }

    const body = new URLSearchParams();
    body.set("To", call.to);
    body.set("From", call.from);
    body.set("Twiml", call.twiml);

    const response = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(
            `${this.config.accountSid}:${this.config.authToken}`,
          )}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      throw new Error("twilio_request_failed");
    }

    const payload = (await response.json()) as {
      sid?: string;
      status?: string;
    };

    return {
      sid: payload.sid ?? "",
      status: payload.status ?? "",
    };
  }
}
