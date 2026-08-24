import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Semantic tokens for ingest feedback. Row-level invariant failures and
        // unmapped records are first-class UI, not incidental error states.
        warn: {
          bg: 'rgb(254 249 231)',
          fg: 'rgb(133 77 14)',
          border: 'rgb(234 179 8)',
        },
        unmapped: {
          bg: 'rgb(254 242 242)',
          fg: 'rgb(153 27 27)',
          border: 'rgb(248 113 113)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
