import type { Auth, Target } from '../integration.js';

export interface RecordedAction {
  type: 'goto' | 'fill' | 'select' | 'click' | 'press' | 'extract';
  target?: Target;
  value?: string;
  url?: string;
  key?: string;
  /** which example-input key the (literal) value came from, when known */
  inputKey?: string;
  label?: string;
  mode?: 'table' | 'list' | 'text';
  as?: string;
  item?: string;
  fields?: Record<string, { selector: string; attr: string }>;
  snapshotBefore: string;
}

export interface RecordedAuth {
  url: string;
  fields: Array<{ target: Target; secret: string }>;
  submit: Target;
  successCheck: Auth['successCheck'];
  secretNames: string[];
}

export interface Recording {
  startUrl: string;
  actions: RecordedAction[];
  finalSnapshot: string;
  auth?: RecordedAuth;
  summary?: string;
}

export interface ExploreInput {
  name: string;
  url: string;
  task: string;
  exampleInput: Record<string, string>;
  auth?: { url: string; secretNames: string[] };
  log: (m: string) => void;
}
