import { generateStructured, isMockMode, modelName } from "./llm";
import { mockExtract, mockSynthesise } from "./mock-pipeline";
import { buildMermaid } from "./mermaid";
import { EXTRACTION_SYSTEM, SYNTHESIS_SYSTEM, synthesisPrompt, transcriptText } from "./prompts";
import * as repo from "./repo";
import { InterviewExtraction, StudySynthesis, type Participant } from "./schemas";

/** Extract a structured workflow record from a finished interview and store it. */
export async function extractInterview(participant: Participant): Promise<InterviewExtraction> {
  const messages = repo.getMessages(participant.id);
  const extraction = isMockMode()
    ? mockExtract(messages, participant)
    : await generateStructured({ schema: InterviewExtraction, system: EXTRACTION_SYSTEM, prompt: transcriptText(messages) });
  repo.saveExtraction(participant.id, extraction, modelName());
  return extraction;
}

/** Merge all completed extractions of a study into a synthesis + Mermaid map and store it. */
export async function synthesiseStudy(studyId: string): Promise<repo.StoredSynthesis> {
  const items = repo
    .listParticipants(studyId)
    .map((participant) => ({ participant, extraction: repo.getExtraction(participant.id) }))
    .filter((i): i is { participant: Participant; extraction: InterviewExtraction } => Boolean(i.extraction));
  if (items.length === 0) throw new Error("No completed interviews to synthesise");

  const synthesis = isMockMode()
    ? mockSynthesise(items)
    : await generateStructured({ schema: StudySynthesis, system: SYNTHESIS_SYSTEM, prompt: synthesisPrompt(items) });
  repo.saveSynthesis(studyId, synthesis, buildMermaid(synthesis), modelName(), items.length);
  return repo.getSynthesis(studyId)!;
}
