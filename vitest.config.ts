import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'test/**/*.test.ts',
      // The lifted swimlane engine keeps its v12 specs beside the code, as v12 did.
      'packages/swimlane-engine/src/**/*.spec.ts',
    ],
    environment: 'node',
  },
});
