import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Source tests only: `dist/` holds the compiled build (and its compiled tests).
    include: ['test/**/*.test.ts'],
    // The silhouette test sweeps 680 combinations of state x shape x expression over 60
    // instants; it is the heaviest thing in the repo and it is the one that proves what the
    // eye sees.
    testTimeout: 120_000
  }
})
