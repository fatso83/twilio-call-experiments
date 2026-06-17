import { describe, expect, it, vi } from "vitest";
import { TwilioFakeAdapter, TwilioRealAdapter } from "../src/twilio";

describe("TwilioFakeAdapter", () => {
  it("records calls without performing network I/O", async () => {
    const adapter = new TwilioFakeAdapter();

    const result = await adapter.createCall({
      from: "+15551234567",
      to: "+15557654321",
      twiml: "<Response><Hangup/></Response>",
    });

    expect(result).toEqual({ sid: "fake-call", status: "queued" });
    expect(adapter.calls).toEqual([
      {
        from: "+15551234567",
        to: "+15557654321",
        twiml: "<Response><Hangup/></Response>",
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
      },
      fetch,
    );

    await adapter.createCall({
      from: "+15551234567",
      to: "+15557654321",
      twiml: "<Response><Hangup/></Response>",
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
    expect(init?.body?.toString()).toBe(
      "To=%2B15557654321&From=%2B15551234567&Twiml=%3CResponse%3E%3CHangup%2F%3E%3C%2FResponse%3E",
    );
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
      },
      fetch,
    );

    await expect(
      adapter.createCall({
        from: "+15551234567",
        to: "+15557654321",
        twiml: "<Response><Hangup/></Response>",
      }),
    ).rejects.toThrow("twilio_request_failed");
  });
});
