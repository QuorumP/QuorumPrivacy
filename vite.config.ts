// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Hard-pin the deploy target to Vercel (Build Output API). Overrides the preset's
  // Cloudflare default; applies on any build outside the Lovable sandbox (local/CI/Vercel).
  nitro: { preset: "vercel" },
  vite: {
    // src/lib/zk/solvency.server.ts inlines these into the server bundle with `?inline`.
    assetsInclude: ["**/public/zk/solvency.wasm", "**/public/zk/solvency.zkey"],
    resolve: {
      alias: [
        // @coral-xyz/anchor's ESM build (dist/esm/index.js) executes
        // `exports.workspace = require(...)` at the top level — valid CommonJS, but a
        // `ReferenceError: exports is not defined` under real ESM in the Vercel Node runtime.
        // Vite bundles that ESM file into the server graph, and because the server-function
        // resolver evaluates that graph to resolve ANY server function, it 500'd EVERY server
        // function in production (auth, data reads, everything). Force the valid CJS build.
        { find: /^@coral-xyz\/anchor$/, replacement: "@coral-xyz/anchor/dist/cjs/index.js" },
      ],
    },
  },
});
