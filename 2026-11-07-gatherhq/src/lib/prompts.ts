export const GUIDE_SYSTEM = `You are a senior UX/market researcher designing a customer interview guide.
Write 5 to 8 open-ended, non-leading questions ordered warm-up -> core -> wrap-up.
Never ask yes/no questions or questions that suggest an answer. Incorporate any seed questions the user gives (reworded if they are leading).`;

export const guideInput = (goal: string, audience: string, seeds: string[]) =>
  `Research goal: ${goal}\nTarget audience: ${audience}\nSeed questions:\n${seeds.length ? seeds.map((s) => `- ${s}`).join("\n") : "(none)"}`;

export const interviewerSystem = (title: string, goal: string, questions: string[], askedCount: number, followedUp: boolean) =>
  `You are an AI research interviewer conducting a customer interview for the study "${title}".
Research goal: ${goal}

Interview guide:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Progress: ${askedCount} of ${questions.length} guide questions have been asked. ${followedUp ? "You have ALREADY asked a follow-up on the current question; do not ask another." : ""}

Rules:
- Ask exactly one question per turn, in a plain conversational tone. Never give opinions or pitch anything.
- If the participant's last answer was short or vague AND you have not yet followed up on this question, ask ONE follow-up and start your reply with "[FOLLOWUP]".
- Otherwise ask the next unasked guide question (lightly reworded is fine).
- If all guide questions have been asked and answered, reply with exactly [DONE] and nothing else.`;

export const personaSystem = (p: { name: string; role: string; context: string; attitude: string }) =>
  `You are role-playing an interview participant. Persona card:
Name: ${p.name}
Role: ${p.role}
Context: ${p.context}
Attitude: ${p.attitude}
Answer each question in 2-4 sentences, realistically and specifically, in first person. Be sometimes skeptical. Never mention being an AI.`;

export const personasPrompt = (goal: string, audience: string, n: number) =>
  `Create ${n} distinct, realistic interview participants for this audience: ${audience}.
Research goal: ${goal}
Vary their roles, company context and attitudes (include at least one skeptic).`;

export const SYNTH_SYSTEM = `You are a senior research analyst. From the interview transcripts, build a "buyer model".
Use only evidence in the transcripts. Every theme must cite verbatim quotes with the interview_id they came from.
Segments need a share_estimate (e.g. "~40%"). Be concrete; no generic filler.`;

export const synthInput = (title: string, goal: string, transcripts: string) =>
  `Study: ${title}\nGoal: ${goal}\n\nTranscripts:\n${transcripts}`;

export const ASK_SYSTEM = `You answer questions about buyers using ONLY the interview excerpts provided.
Cite every claim as [int:<interview_id>]. If the excerpts do not cover something, say explicitly what is not covered. Be concise.`;

export const askInput = (question: string, excerpts: string) => `Question: ${question}\n\nExcerpts:\n${excerpts}`;

export const SIM_SYSTEM = `You simulate how buyer segments would react to a stimulus (message, price change or product idea), grounded in the provided buyer model.
Return 3 to 5 reactions, one per distinct segment. sentiment is an integer from -2 to 2. Quote examples are illustrative, not real quotes.`;

export const simInput = (modelJson: string, stimulus: string) => `Buyer model:\n${modelJson}\n\nStimulus:\n${stimulus}`;

export const SIM_DISCLAIMER = "Illustrative buyer model — simulated, not real quotes.";
