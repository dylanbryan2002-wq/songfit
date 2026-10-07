import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": process.cwd(),
      // The real package throws outside Next's server runtime.
      "server-only": path.join(process.cwd(), "tests", "stubs", "server-only.ts"),
    },
  },
});
