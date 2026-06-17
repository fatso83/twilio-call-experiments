export const HANGUP_TWIML = "<Response><Hangup/></Response>";

export type GateInput = {
  code?: string;
};

export type GateConfig = {
  gateOpenCode?: string;
  twilioFromNumber?: string;
  gateTargetNumber?: string;
};

export type GateCallCommand = {
  from: string;
  to: string;
  twiml: string;
};

export type GateDecision =
  | {
      ok: true;
      call: GateCallCommand;
    }
  | {
      ok: false;
      status: 401 | 500;
      error: "invalid_code" | "config_missing";
    };

export function planGateOpen(input: GateInput, config: GateConfig): GateDecision {
  if (
    !config.gateOpenCode ||
    !config.twilioFromNumber ||
    !config.gateTargetNumber
  ) {
    return {
      ok: false,
      status: 500,
      error: "config_missing",
    };
  }

  if (!input.code || input.code !== config.gateOpenCode) {
    return {
      ok: false,
      status: 401,
      error: "invalid_code",
    };
  }

  return {
    ok: true,
    call: {
      from: config.twilioFromNumber,
      to: config.gateTargetNumber,
      twiml: HANGUP_TWIML,
    },
  };
}
