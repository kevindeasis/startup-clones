import { fail, handle, json } from "@/lib/http";
import { seedAll } from "@/lib/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = () =>
  handle(async () => {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "1") {
      return fail(403, "Seeding is disabled in production (set ALLOW_SEED=1 or run `npm run seed`).");
    }
    return json(await seedAll());
  });
