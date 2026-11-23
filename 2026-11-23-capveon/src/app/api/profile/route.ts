import { getProfile } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { rescoreAllSignals } from "@/lib/pipeline";
import { profileInputSchema } from "@/lib/schemas";
import { writeProfile } from "@/lib/store";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = () => handle(async () => json(await getProfile()));

export const PUT = (req: Request) =>
  handle(async () => {
    const input = profileInputSchema.parse(await readJson(req));
    const profile: Profile = { ...input, id: "default" };
    await writeProfile(profile);
    await rescoreAllSignals(profile);
    return json(profile);
  });
