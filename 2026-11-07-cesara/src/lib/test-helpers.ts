import { mockAnswer } from "./llm";
import { SAMPLE_TERMS } from "./sample";

export const askContractMock = (q: string) => mockAnswer(q, SAMPLE_TERMS);
