import { analyze } from "../src/lib/analyze";

analyze(process.argv[2]).then(({ analyzed, newActions }) => {
  console.log(`analyzed ${analyzed} account(s); ${newActions.length} new action(s)`);
  for (const a of newActions) console.log(` - [${a.priority}] ${a.type}/${a.play}: ${a.title}`);
}).catch((e) => { console.error(e); process.exit(1); });
