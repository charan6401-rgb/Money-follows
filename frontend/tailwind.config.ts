import type { Config } from 'tailwindcss';

/**
 * Money Follows design tokens.
 *
 * Direction: a receivables ledger for building-material distributors.
 * Cool cement-grey pages, white ledger sheets with fine rules, fountain-pen ink for text,
 * a "stamp" red reserved for overdue money and a ledger green reserved for money received.
 * Amounts are set in a serif with lining, tabular numerals so columns of rupees line up.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cement: {
          50: '#F7F8F6',
          100: '#ECEEEB',
          200: '#DFE3DE',
          300: '#CBD1C9',
        },
        ink: {
          DEFAULT: '#16233A',
          900: '#16233A',
          700: '#2B3A55',
          600: '#44526B',
          500: '#566176',
        },
        stamp: {
          DEFAULT: '#B42318',
          soft: '#FDECEA',
          ring: '#F0B4AD',
        },
        ledger: {
          DEFAULT: '#17603F',
          soft: '#E3F1E9',
        },
        ochre: {
          DEFAULT: '#8A5A00',
          soft: '#FBF1D8',
        },
        // Aging buckets run from calm blue-grey to deep red. Always paired with text, never colour alone.
        aging: {
          current: '#9DB0C9',
          d30: '#D9A441',
          d60: '#D9722B',
          d90: '#C4412F',
          d90plus: '#8E1B12',
        },
        focus: '#1F5FBF',
      },
      fontFamily: {
        sans: [
          '"Hanken Grotesk Variable"',
          '"Noto Sans Telugu Variable"',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        serif: ['"Source Serif 4 Variable"', 'Georgia', 'Cambria', 'serif'],
      },
      borderRadius: {
        card: '12px',
        control: '10px',
        sheet: '20px',
      },
      boxShadow: {
        bar: '0 -1px 0 #CBD1C9, 0 -8px 20px rgba(22, 35, 58, 0.06)',
        sheet: '0 -10px 40px rgba(22, 35, 58, 0.22)',
      },
      minHeight: {
        touch: '2.75rem',
      },
      minWidth: {
        touch: '2.75rem',
      },
    },
  },
  plugins: [],
};

export default config;
