import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Hebrew-first stack per RTL playbook §11
        sans: ['Assistant', 'Heebo', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#1f6feb',
          dark: '#1a5fce',
        },
      },
    },
  },
  plugins: [],
};

export default config;
