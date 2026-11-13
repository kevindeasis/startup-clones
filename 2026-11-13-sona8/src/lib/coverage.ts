import { generateStructured, isMockMode } from "./llm";
import { Area, AREAS } from "./schemas";
import { z } from "zod";
import { COVERAGE_SYSTEM } from "./prompts";

const KEYWORDS: Record<Area, RegExp> = {
  trigger: /\b(start|starts|begin|begins|trigger|triggered|request|receive|received|comes in|kick(s)? off|when a)\b/i,
  steps: /\b(then|first|next|after|finally|step|create|check|prepare|review|send|approve|enter|update)\b/i,
  tools: /\b(excel|sap|crm|salesforce|erp|email|outlook|slack|teams|spreadsheet|system|tool|software|sharepoint|word|pdf)\b/i,
  manual_work: /\b(manual|manually|by hand|copy|paste|retype|re-?enter|type it|typing)\b/i,
  handoffs: /\b(hand|handoff|send(s)? (it )?to|forward|pass(es)? (it )?to|ask(s)? (the )?\w+ team|approval from|colleague|manager)\b/i,
  exceptions: /\b(exception|if (not|the|a|it|there|they)|unless|except|goes wrong|error|rejected|new customer|special case|otherwise|fails?)\b/i,
  pain_points: /\b(slow|wait|waiting|twice|annoying|frustrat\w*|painful|problem|delay|delays|bottleneck|wasted|hate|takes forever)\b/i,
};

/** Cheap keyword heuristic used in mock mode. */
export function heuristicCoverage(userMessage: string): Area[] {
  return AREAS.filter((a) => KEYWORDS[a].test(userMessage));
}

/** Returns the areas newly covered by the latest participant message. */
export async function classifyCoverage(userMessage: string, already: Area[]): Promise<Area[]> {
  const found = isMockMode()
    ? heuristicCoverage(userMessage)
    : (
        await generateStructured({
          schema: z.object({ newlyCovered: z.array(Area) }),
          system: COVERAGE_SYSTEM,
          prompt: `Already covered: ${already.join(", ") || "none"}\n\nParticipant message:\n${userMessage}`,
        })
      ).newlyCovered;
  return found.filter((a) => !already.includes(a));
}
