import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" }, // render components in tests without importing React
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
