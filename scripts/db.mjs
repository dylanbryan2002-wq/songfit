// Runs Supabase CLI commands with the secrets from the local env file (loaded by the package.json
// script via node --env-file), so nobody has to paste the database password on the command line.
//   pnpm db:push   → supabase db push
//   pnpm db:types  → regenerate src/db/types.ts
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const cmd = process.argv[2];
const pw = process.env.SUPABASE_DB_PASSWORD;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!pw || !ref) {
  console.error("SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_REF must be set in the local env file.");
  process.exit(1);
}
if (cmd === "push") {
  const r = spawnSync("supabase", ["db", "push", "-p", pw], { stdio: "inherit" });
  process.exit(r.status ?? 1);
} else if (cmd === "types") {
  const r = spawnSync("supabase", ["gen", "types", "typescript", "--project-id", ref, "--schema", "public"], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  }
  writeFileSync("src/db/types.ts", r.stdout);
  console.log("wrote src/db/types.ts");
} else {
  console.error("usage: node scripts/db.mjs push|types");
  process.exit(1);
}
