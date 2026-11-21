import { seedAll } from "../src/lib/seed";

seedAll()
  .then((r) => {
    console.log("Seeded:", JSON.stringify(r));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
