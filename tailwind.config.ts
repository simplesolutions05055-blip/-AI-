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
        // working. When NO single brand is assigned the fallback kicks in as a
        // PrimeOS navy/blue pair, not the old generic saturated tech-blue.
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb, 11 79 159) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark-rgb, 7 26 51) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
