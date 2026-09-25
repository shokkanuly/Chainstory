import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Services are pure and DOM-free; component helpers under test are plain
    // functions, so the faster node environment is enough.
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // The guardian, executed in an in-process EVM against freshly compiled
      // bytecode. See contracts/evm/README.md.
      'contracts/**/*.test.ts',
    ],
  },
});
