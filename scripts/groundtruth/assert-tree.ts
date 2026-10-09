/* Guard for the eval scripts: the "@/..." path alias must resolve inside the same checkout as the script.
   Running a worktree's scripts from the main folder made the alias load the main folder's engine code (2026-10-09:
   every branch test scored with main's scoring-v4). Import this first in every entry script. Fix by running with
   TSX_TSCONFIG_PATH=<this checkout>/tsconfig.json. */
import path from "node:path";

const tree = path.resolve(__dirname, "../..");
// Under vitest the alias is resolved by vite from this checkout's config, and require.resolve cannot see it.
const underTest = !!process.env.VITEST;
const resolved = underTest ? null : require.resolve("@/src/shared/config");
if (resolved && !resolved.startsWith(tree + path.sep)) {
  console.error(`WRONG CODE TREE: "@/src/..." resolves to ${resolved}, but this script lives in ${tree}.\n` +
    `Run with TSX_TSCONFIG_PATH=${path.join(tree, "tsconfig.json")}`);
  process.exit(2);
}
