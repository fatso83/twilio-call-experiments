import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/worker";
import { TwilioFakeAdapter } from "../src/twilio";

const env = {
  GATE_OPEN_CODE: "open-sesame",
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "secret",
  TWILIO_FROM_NUMBER: "+15551234567",
  GATE_TARGET_NUMBER: "+15557654321",
};

describe("handleRequest", () => {
  it("returns 404 outside the gate endpoint", async () => {
    const twilio = new TwilioFakeAdapter();

    const response = await handleRequest(
      new Request("https://example.com/api/other", { method: "POST" }),
      env,
      twilio,
    );

    expect(response.status).toBe(404);
    expect(twilio.calls).toHaveLength(0);
  });

  it("only accepts POST requests", async () => {
    const twilio = new TwilioFakeAdapter();

    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", { method: "GET" }),
      env,
      twilio,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(twilio.calls).toHaveLength(0);
  });

  it("preflights CORS for allowed origin", async () => {
    const twilio = new TwilioFakeAdapter();
    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", {
        method: "OPTIONS",
        headers: { Origin: "https://www.holmevann.no" },
      }),
      env,
      twilio,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://www.holmevann.no",
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
  });

  it("adds CORS allow-origin on success for allowed origin", async () => {
    const twilio = new TwilioFakeAdapter();

    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", {
        method: "POST",
        headers: {
          Origin: "https://holmevann.no",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ code: "open-sesame" }),
      }),
      env,
      twilio,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://holmevann.no",
    );
  });

  it("does not set CORS allow-origin for disallowed origin", async () => {
    const twilio = new TwilioFakeAdapter();
    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", {
        method: "POST",
        headers: { Origin: "https://evil.example.com" },
        body: new URLSearchParams({ code: "open-sesame" }),
      }),
      env,
      twilio,
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("rejects an invalid code without calling Twilio", async () => {
    const twilio = new TwilioFakeAdapter();

    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", {
        method: "POST",
        body: new URLSearchParams({ code: "wrong" }),
      }),
      env,
      twilio,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_code" });
    expect(twilio.calls).toHaveLength(0);
  });

  it("logs missing config names without calling Twilio", async () => {
    const twilio = new TwilioFakeAdapter();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", {
        method: "POST",
        body: new URLSearchParams({ code: "open-sesame" }),
      }),
      {
        ...env,
        TWILIO_FROM_NUMBER: "",
        GATE_TARGET_NUMBER: "",
      },
      twilio,
      logger,
    );

    expect(response.status).toBe(500);
    expect(logger.warn).toHaveBeenCalledWith("gate.open.config_missing", {
      missing: ["TWILIO_FROM_NUMBER", "GATE_TARGET_NUMBER"],
      path: "/api/gate/open",
    });
    expect(twilio.calls).toHaveLength(0);
  });

  it("calls Twilio once for a valid form code", async () => {
    const twilio = new TwilioFakeAdapter();

    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", {
        method: "POST",
        body: new URLSearchParams({ code: "open-sesame" }),
      }),
      env,
      twilio,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      callSid: "fake-call",
      status: "queued",
    });
    expect(twilio.calls).toEqual([
      {
        from: "+15551234567",
        to: "+15557654321",
        twiml: "<Response><Hangup/></Response>",
      },
    ]);
  });

  it("accepts a valid JSON code", async () => {
    const twilio = new TwilioFakeAdapter();

    const response = await handleRequest(
      new Request("https://example.com/api/gate/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "open-sesame" }),
      }),
      env,
      twilio,
    );

    expect(response.status).toBe(200);
    expect(twilio.calls).toHaveLength(1);
  });
});
