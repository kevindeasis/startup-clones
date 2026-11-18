import permitTypesJson from "@/data/permit-types.json";
import codeSectionsJson from "@/data/code-sections.json";
import type { CodeSection, PermitType } from "./types";

export const permitTypes = permitTypesJson as PermitType[];
export const codeSections = codeSectionsJson as CodeSection[];

export function getPermitType(id: string): PermitType | undefined {
  return permitTypes.find((p) => p.id === id);
}
export function getSection(id: string): CodeSection | undefined {
  return codeSections.find((s) => s.id === id);
}
