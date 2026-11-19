import carriersJson from "@/data/carriers.json";
import industriesJson from "@/data/industries.json";
import bookJson from "@/data/book.json";
import type { Account, Carrier, Industry } from "./types";

export const carriers = carriersJson as unknown as Carrier[];
export const industries = industriesJson as unknown as Industry[];
export const book = bookJson as unknown as Account[];

export function getCarrier(id: string): Carrier | undefined {
  return carriers.find((c) => c.id === id);
}

export function getIndustry(id: string | undefined): Industry | undefined {
  return id ? industries.find((i) => i.id === id) : undefined;
}
