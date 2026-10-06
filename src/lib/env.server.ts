// Server-only env access. In local dev, loads .env.local into process.env once
// (Vite only exposes VITE_* to the client and does not populate process.env for
// server code). In production (Vercel) the vars come from project settings and the
// .env.local read simply no-ops.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {
    /* no .env.local (prod) — rely on real process.env */
  }
}

export function env(key: string, fallback?: string): string {
  ensureLoaded();
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function optionalEnv(key: string): string | undefined {
  ensureLoaded();
  return process.env[key];
}
