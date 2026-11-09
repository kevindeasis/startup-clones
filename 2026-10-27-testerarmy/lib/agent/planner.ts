import type { Action, Observation } from './actions';

export interface Planner {
  name: 'anthropic' | 'mock';
  decide(observation: Observation): Promise<{ action: Action; reasoning: string }>;
  verdict(observation: Observation): Promise<{ pass: boolean; reason: string }>;
}
