import { getDb } from "../src/lib/db";
import { classifyCoverage } from "../src/lib/coverage";
import { nextMockReply, OPENING_MESSAGE } from "../src/lib/mock-interviewer";
import { extractInterview, synthesiseStudy } from "../src/lib/pipeline";
import * as repo from "../src/lib/repo";
import type { Area, ChatMessage } from "../src/lib/schemas";
import { DEMO_PARTICIPANTS, DEMO_TITLE, DEMO_TOPIC } from "./seed-data";

async function main() {
  getDb();
  if (repo.findStudyByTitle(DEMO_TITLE)) {
    console.log("Demo study already exists, skipping seed.");
    return;
  }
  const study = repo.createStudy({
    title: DEMO_TITLE,
    topic: DEMO_TOPIC,
    goal: "Find where quote creation is slow or manual and what could be automated.",
    teams: ["Sales", "Sales Ops", "Finance"],
  });

  for (const d of DEMO_PARTICIPANTS) {
    const p = repo.addParticipant(study.id, d);
    const history: ChatMessage[] = [{ role: "assistant", content: OPENING_MESSAGE(study.topic) }];
    repo.addMessage(p.id, "assistant", history[0].content);
    let covered: Area[] = [];
    for (const answer of d.answers) {
      history.push({ role: "user", content: answer });
      repo.addMessage(p.id, "user", answer);
      covered = repo.unionCoverage(p.id, await classifyCoverage(answer, covered));
      const reply = nextMockReply(history, covered, study.topic);
      history.push({ role: "assistant", content: reply });
      repo.addMessage(p.id, "assistant", reply);
    }
    await extractInterview(p);
    repo.setStatus(p.id, "completed", new Date().toISOString());
  }
  await synthesiseStudy(study.id);
  console.log(`Seeded demo study ${study.id} with ${DEMO_PARTICIPANTS.length} completed interviews.`);
}

main();
