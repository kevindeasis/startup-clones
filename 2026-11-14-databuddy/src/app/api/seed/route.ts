import { json } from "@/lib/http";
import { seedDemo } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const POST = () => json(seedDemo());
