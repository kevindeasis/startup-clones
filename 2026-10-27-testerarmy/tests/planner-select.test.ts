import { describe, it, expect, afterEach } from 'vitest';
import { createPlanner, plannerKind } from '@/lib/agent';

const old = { ...process.env };
afterEach(() => { process.env = { ...old }; });

describe('planner selection', () => {
  it('defaults to mock without a key', () => {
    delete process.env.ANTHROPIC_API_KEY; delete process.env.PLANNER;
    expect(plannerKind()).toBe('mock');
    expect(createPlanner().name).toBe('mock');
  });
  it('selects anthropic when the key is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'; delete process.env.PLANNER;
    expect(plannerKind()).toBe('anthropic');
    expect(createPlanner().name).toBe('anthropic');
  });
  it('PLANNER=mock overrides the key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'; process.env.PLANNER = 'mock';
    expect(createPlanner().name).toBe('mock');
  });
});
