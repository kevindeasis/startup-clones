import { seed } from "../src/db/seed";

seed().then((counts) => {
  console.log("Seed complete:", JSON.stringify(counts));
});
