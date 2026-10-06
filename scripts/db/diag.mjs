import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { ssl } from "./ssl.mjs";

// replicate env.server.ts loader
const loaded = {};
const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  loaded[m[1]] = v;
}
console.log("cwd:", process.cwd());
console.log("PGHOST:", JSON.stringify(loaded.PGHOST));
console.log("PGUSER:", JSON.stringify(loaded.PGUSER));
console.log("PGDATABASE:", JSON.stringify(loaded.PGDATABASE));
console.log("PGPASSWORD len:", loaded.PGPASSWORD?.length, "starts:", loaded.PGPASSWORD?.slice(0, 3), "ends:", loaded.PGPASSWORD?.slice(-3));

const client = new pg.Client({
  host: loaded.PGHOST, port: Number(loaded.PGPORT ?? 5432),
  user: loaded.PGUSER, password: loaded.PGPASSWORD,
  database: loaded.PGDATABASE ?? "postgres", ssl,
});
try {
  await client.connect();
  const r = await client.query("select current_user, current_database()");
  console.log("CONNECT OK:", r.rows[0]);
  await client.end();
} catch (e) {
  console.error("CONNECT FAILED:", e.message);
}
