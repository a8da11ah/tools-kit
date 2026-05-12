import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
