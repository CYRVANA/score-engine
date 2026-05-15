import type { Config } from "tailwindcss";

/**
 * CYRVANA brand tokens, sourced from the cyrvana.com root config.
 * Update here to retheme; CSS variables in globals.css mirror these for runtime use.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary brand orange — used for CTAs, active links, accents
        brand: {
          DEFAULT: "#ec6202",
          50: "#fff4ec",
          100: "#ffe5d2",
          200: "#ffc7a5",
          300: "#ffa16d",
          400: "#ff7a3a",
          500: "#ec6202",
          600: "#cc4f00",
          700: "#a33d00",
          800: "#7d2f02",
          900: "#5c2202",
        },
        // Secondary deep navy — card backdrops, footers
        navy: {
          DEFAULT: "#1A2332",
          deep: "#0D1117", // background for dark sections
        },
        // Semantic aliases
        background: "#ffffff",
        foreground: "#0D1117",
        muted: "#6b7280",
        border: "#e5e7eb",
      },
      fontFamily: {
        // Brand-wide: Inter (sans-serif, weights 400–900 loaded from Google Fonts)
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        heading: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        prose: "65ch",
        page: "72rem",
      },
    },
  },
  plugins: [],
};

export default config;
