import { defineConfig } from 'vitest/config';

// A light test harness — pure-function unit tests (no DB, no network) covering
// the sealed-domain privacy guarantee and the core economy math.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
