import { defineConfig } from "vitest/config";

// Isolated from the app's vite.config (TanStack plugins). Server functions run against PGlite
// and a fake devnet wired up in src/test/setup.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      // Everything that enforces a rule: server fns, auth, crypto, ZK, stake verification.
      include: ["src/fn/**", "src/lib/**"],
      exclude: [
        "**/*.test.ts",
        // Thin I/O adapters, replaced by PGlite / the fake devnet in tests (devnet scripts cover them).
        "src/lib/db/pool.server.ts", "src/lib/solana/anchor.server.ts", "src/lib/solana/groth16.server.ts",
        "src/lib/supabase/**", "src/lib/env.server.ts",
        // Browser-only code (wallet signing, in-browser proving) and UI error plumbing.
        "src/lib/solana/stake.browser.ts", "src/lib/solana/buffer-polyfill.ts", "src/lib/zk/prove.ts",
        "src/lib/zk/solvency.ts", "src/lib/error-*.ts", "src/lib/lovable-error-reporting.ts", "src/lib/utils.ts",
      ],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 70 },
    },
  },
});
