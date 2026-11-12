import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 90000, hookTimeout: 90000, fileParallelism: false } });
