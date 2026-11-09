import type { Planner } from './planner';
import { MockPlanner } from './mock-planner';
import { AnthropicPlanner } from './anthropic-planner';

export function plannerKind(): 'anthropic' | 'mock' {
  const forced = (process.env.PLANNER || '').toLowerCase();
  if (forced === 'mock') return 'mock';
  if (forced === 'anthropic') return 'anthropic';
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'mock';
}

export function createPlanner(): Planner {
  return plannerKind() === 'anthropic' ? new AnthropicPlanner() : new MockPlanner();
}
