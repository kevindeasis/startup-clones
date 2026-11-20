export type VoiceProfile = { slot: number; pitch: number; rate: number; preferredVoiceName?: string };

export type Character = {
  id: string;
  name: string;
  aliases: string[];
  isNarrator: boolean;
  genderHint: "female" | "male" | "neutral" | "unknown";
  ageHint: "child" | "young" | "adult" | "elder" | "unknown";
  personality: string;
  voice: VoiceProfile;
  color: string;
};

export type Segment = {
  index: number;
  chunkIndex: number;
  kind: "narration" | "dialogue";
  characterId: string;
  text: string;
  emotion?: string;
};

export type StoryStatus = "imported" | "generating" | "ready" | "error";

export type Story = {
  id: string;
  title: string;
  source: { kind: "paste" | "file" | "url" | "sample"; url?: string; filename?: string };
  text: string;
  wordCount: number;
  status: StoryStatus;
  error?: string;
  chunksTotal: number;
  chunksDone: number;
  mode: "mock" | "live";
  model?: string;
  cast: Character[];
  segments: Segment[];
  createdAt: string;
  updatedAt: string;
};

export type StorySummary = {
  id: string;
  title: string;
  sourceKind: Story["source"]["kind"];
  status: StoryStatus;
  wordCount: number;
  castSize: number;
  chunksDone: number;
  chunksTotal: number;
  mode: Story["mode"];
  createdAt: string;
  updatedAt: string;
};

/** Story as returned by GET /api/stories/[id]: everything except the (large) raw text. */
export type StoryView = Omit<Story, "text">;

export type GenderHint = Character["genderHint"];
export type AgeHint = Character["ageHint"];
