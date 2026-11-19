import { z } from "zod";
import { getPath, isPresent, setPath } from "./path";
import { lineSchema } from "./schemas";
import type { Carrier, CarrierField, Line, RiskProfile } from "./types";

export type MappedSubmission = {
  payload: Record<string, unknown>;
  mapped: string[];
  missing: string[];
};

/** Lines that this carrier can actually quote out of the lines the client asked for. */
export function quotableLines(carrier: Carrier, requested: Line[]): Line[] {
  return requested.filter((l) => carrier.lines.includes(l));
}

export function isRequired(field: CarrierField, lines: Line[]): boolean {
  if (!field.required) return false;
  if (!field.forLines) return true;
  return field.forLines.some((l) => lines.includes(l));
}

/**
 * Generic mapper: walks the carrier's own field schema and pulls values from the RiskProfile by path.
 * Fields with no value are recorded as missing but the submission still goes out ("partial data").
 */
export function mapProfileToCarrier(carrier: Carrier, profile: RiskProfile): MappedSubmission {
  const lines = quotableLines(carrier, profile.requestedLines);
  const payload: Record<string, unknown> = { lines_requested: profile.requestedLines };
  const mapped: string[] = [];
  const missing: string[] = [];
  for (const [name, field] of Object.entries(carrier.fieldSchema)) {
    const value = getPath(profile, field.path);
    if (isPresent(value)) {
      payload[name] = value;
      mapped.push(name);
    } else if (isRequired(field, lines) || field.required) {
      missing.push(name);
    }
  }
  return { payload, mapped, missing };
}

/** The carrier's zod validator: carrier-specific field names and types. Presence is checked separately. */
export function carrierBodySchema(carrier: Carrier) {
  const shape: Record<string, z.ZodType> = {
    lines_requested: z.array(lineSchema).min(1),
  };
  for (const [name, field] of Object.entries(carrier.fieldSchema)) {
    const base =
      field.type === "number" ? z.number() : field.type === "boolean" ? z.boolean() : z.string().min(1);
    shape[name] = base.optional();
  }
  return z.object(shape).strict();
}

/** Reverse of mapProfileToCarrier: carrier body -> partial RiskProfile shape (used by rating). */
export function unmapBody(carrier: Carrier, body: Record<string, unknown>): RiskProfile {
  let profile: RiskProfile = { requestedLines: (body.lines_requested as Line[]) ?? [] };
  for (const [name, field] of Object.entries(carrier.fieldSchema)) {
    if (isPresent(body[name])) profile = setPath(profile, field.path, body[name]);
  }
  return profile;
}

export function missingRequired(carrier: Carrier, body: Record<string, unknown>, lines: Line[]): string[] {
  return Object.entries(carrier.fieldSchema)
    .filter(([name, f]) => isRequired(f, lines) && !isPresent(body[name]))
    .map(([name]) => name);
}
