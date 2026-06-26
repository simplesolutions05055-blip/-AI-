import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Heebo everywhere, no exceptions
        sans: ['Heebo', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand color is driven by a runtime CSS variable so the whole app can be
        // themed to the user's single assigned brand (see useBrandTheme). The RGB
        // triplet + <alpha-value> form keeps opacity modifiers like `bg-brand/5`
        // working. Falls back to the default blue (#1f6feb / #1a5fce).
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb, 31 111 235) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark-rgb, 26 95 206) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
