import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TWILIO_ADAPTER,
  resolveTwilioAdapterMode,
  TwilioFakeAdapter,
  TwilioRealAdapter,
} from "../src/twilio";

describe("Twilio adapter mode", () => {
  it("defaults to fake when adapter is missing", () => {
    expect(resolveTwilioAdapterMode(undefined)).toBe(DEFAULT_TWILIO_ADAPTER);
    expect(resolveTwilioAdapterMode("other")).toBe(DEFAULT_TWILIO_ADAPTER);
  });

  it("resolves fake when explicitly configured", () => {
    expect(resolveTwilioAdapterMode("fake")).toBe("fake");
  });

  it("resolves real when explicitly configured", () => {
    expect(resolveTwilioAdapterMode("real")).toBe("real");
  });
});

describe("TwilioFakeAdapter", () => {
  it("records calls without performing network I/O", async () => {
    const adapter = new TwilioFakeAdapter();
    const twiml = "<Response><Say>Open request received</Say><Hangup/></Response>";

    const result = await adapter.createCall({
      from: "+15551234567",
      to: "+15557654321",
      twiml,
    });

    expect(result).toEqual({ sid: "fake-call", status: "queued" });
    expect(adapter.calls).toEqual([
      {
        from: "+15551234567",
        to: "+15557654321",
        twiml,
      },
    ]);
  });
});

describe("TwilioRealAdapter", () => {
  it("creates a call with Twilio's form-encoded REST API", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ sid: "CA123", status: "queued" }, { status: 201 }),
    );
    const adapter = new TwilioRealAdapter(
      {
        accountSid: "AC00000000000000000000000000000000",
        authToken: "secret",
        callTimeoutSeconds: 30,
        callTimeLimitSeconds: 1,
      },
      fetch,
    );

    await adapter.createCall({
      from: "+15551234567",
      to: "+15557654321",
      twiml: "<Response><Say>Open request received</Say><Hangup/></Response>",
      statusCallbackUrl: "https://example.com/api/twilio/status-callback",
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Calls.json",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${btoa("AC00000000000000000000000000000000:secret")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = init?.body;
    expect(typeof body).toBe("string");
    const payload = new URLSearchParams(body as string);
    expect(payload.get("To")).toBe("+15557654321");
    expect(payload.get("From")).toBe("+15551234567");
    expect(payload.get("Twiml")).toBe(
      "<Response><Say>Open request received</Say><Hangup/></Response>",
    );
    expect(payload.get("Timeout")).toBe("30");
    expect(payload.get("TimeLimit")).toBe("1");
    expect(payload.get("StatusCallback")).toBe(
      "https://example.com/api/twilio/status-callback",
    );
    expect(payload.get("StatusCallbackEvent")).toBe(
      "completed",
    );
    expect(payload.get("StatusCallbackMethod")).toBe("POST");
  });

  it("surfaces a stable error when Twilio rejects the request", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ message: "bad request" }, { status: 400 }),
    );
    const adapter = new TwilioRealAdapter(
      {
        accountSid: "AC00000000000000000000000000000000",
        authToken: "secret",
        callTimeoutSeconds: 30,
        callTimeLimitSeconds: 1,
      },
      fetch,
    );

    await expect(
      adapter.createCall({
        from: "+15551234567",
        to: "+15557654321",
        twiml: "<Response><Say>Open request received</Say><Hangup/></Response>",
      }),
    ).rejects.toThrow("twilio_request_failed");
  });
});
