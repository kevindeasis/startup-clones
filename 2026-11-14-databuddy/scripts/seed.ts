import { seedDemo } from "../src/lib/seed";

const result = seedDemo();
console.log(result.seeded ? `Seeded demo site with ${result.events} events.` : `Demo site already has ${result.events} events; nothing to do.`);
