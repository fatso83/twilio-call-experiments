import { describe, expect, it } from "vitest";
import { planGateOpen } from "../src/gate";

const validConfig = {
  gateOpenCode: "open-sesame",
  twilioFromNumber: "+15551234567",
  gateTargetNumber: "+15557654321",
};

describe("planGateOpen", () => {
  it("fails closed when required config is missing", () => {
    expect(
      planGateOpen({ code: "open-sesame" }, { ...validConfig, gateTargetNumber: "" }),
    ).toEqual({
      ok: false,
      status: 500,
      error: "config_missing",
    });
  });

  it("rejects a missing or incorrect code without creating a call", () => {
    expect(planGateOpen({ code: undefined }, validConfig)).toEqual({
      ok: false,
      status: 401,
      error: "invalid_code",
    });

    expect(planGateOpen({ code: "wrong" }, validConfig)).toEqual({
      ok: false,
      status: 401,
      error: "invalid_code",
    });
  });

  it("returns the Twilio call command for a valid code", () => {
    expect(planGateOpen({ code: "open-sesame" }, validConfig)).toEqual({
      ok: true,
      call: {
        from: "+15551234567",
        to: "+15557654321",
        twiml: "<Response><Hangup/></Response>",
      },
    });
  });
});
