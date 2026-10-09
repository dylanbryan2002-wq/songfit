import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F1419",
        steel: { light: "#8FA8C8", DEFAULT: "#5B7190", dark: "#2E3A4A" },
        canvas: "#F7F8FA",
        muted: "#6B7280",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        // next/font variables, set on <html> in app/layout.tsx.
        display: ["var(--font-display)", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
