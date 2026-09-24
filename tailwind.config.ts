import type { Config } from 'tailwindcss';

/**
 * Brand kit v1.0 — Easy Cut AI
 * Dark foundation, one accent, generous spacing, rounded corners.
 */
export default {
  content: ['./src/**/*.{ts,tsx}', './remotion/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0D0D10',        // soft black — main canvas
        charcoal: '#19191F',   // cards and upload areas
        charcoal2: '#22222A',  // raised surface / hover
        line: '#2C2C36',       // hairline borders
        violet: {
          DEFAULT: '#9B7BFF',  // logo accent, primary actions
          hover: '#B39AFF',
          dim: 'rgba(155,123,255,0.14)',
        },
        chalk: '#F5F5F7',      // headings and body
        muted: '#A5A5B3',      // secondary text
        faint: '#6E6E7C',      // micro-labels, inactive icons
        'line-soft': '#232330',// the quieter hairline, for structure not edges
        ok: '#5BD6A0',
        warn: '#F5C453',
        bad: '#FF7B7B',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        display: ['48px', { lineHeight: '56px', letterSpacing: '-0.03em', fontWeight: '700' }],
      },
      borderRadius: { xl: '14px', '2xl': '18px', '3xl': '24px' },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 40px -18px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(155,123,255,0.35), 0 16px 50px -20px rgba(155,123,255,0.55)',
      },
      keyframes: {
        rise: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        /* The hero flow map. `flowRun` is a dash travelling a wire rather than
           an element moving along one, so it scales with the SVG's viewBox and
           cannot fall out of step with the curve it rides. */
        flowRun: { from: { strokeDashoffset: '1234' }, to: { strokeDashoffset: '0' } },
        flowFloat: { '0%,100%': { translate: '0 0' }, '50%': { translate: '0 -7px' } },
        flowBreathe: {
          '0%,100%': { opacity: '0.55', transform: 'scale(0.94)' },
          '50%': { opacity: '1', transform: 'scale(1.06)' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 1.6s infinite',
        pulseDot: 'pulseDot 1.4s ease-in-out infinite',
        flowRun: 'flowRun 3.4s linear infinite',
        flowFloat: 'flowFloat 7s cubic-bezier(.22,.68,.28,1) infinite',
        flowBreathe: 'flowBreathe 5.5s cubic-bezier(.22,.68,.28,1) infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
