import { seedAll } from "../src/lib/seed";
import { listSignals } from "../src/lib/data";
import { fitBand } from "../src/lib/fit";

async function main() {
  const counts = await seedAll();
  console.log(`Seeded (${counts.mode} mode, model ${counts.model}):`);
  console.log(
    `  profile ${counts.profile}, agencies ${counts.agencies}, documents ${counts.documents}, signals ${counts.signals}, awards ${counts.awards}, contacts ${counts.contacts}`,
  );
  const signals = (await listSignals()).sort((a, b) => b.fitScore - a.fitScore);
  for (const s of signals) {
    console.log(`  [${String(s.fitScore).padStart(3)} ${fitBand(s.fitScore).padEnd(8)}] ${s.stage.padEnd(12)} ${s.category.padEnd(13)} ${s.projectTitle}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
