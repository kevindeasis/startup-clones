import crypto from "node:crypto";

export const newId = (): string => crypto.randomBytes(5).toString("hex");
