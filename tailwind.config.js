/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#DEEBFF',
          100: '#B3D4FF',
          200: '#87BAFF',
          300: '#5A9EFF',
          400: '#2684FF',
          500: '#0052CC',
          600: '#0747A6',
          700: '#0535A3',
          800: '#0329A3',
          900: '#021D98',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          page:    '#F4F7FA',
          hover:   '#F4F7FA',
          active:  '#DEEBFF',
        },
        ink: {
          DEFAULT:   '#172B4D',
          secondary: '#5E6C84',
          tertiary:  '#97A0AF',
          subtle:    '#C1C7D0',
        },
        line: {
          DEFAULT: '#DFE1E6',
          subtle:  '#EBECF0',
        },
        success: { DEFAULT:'#00875A', light:'#E3FCEF', border:'#57D9A3', dark:'#006644' },
        warning: { DEFAULT:'#FF8B00', light:'#FFF7E6', border:'#FFE380', dark:'#FF991F' },
        danger:  { DEFAULT:'#DE350B', light:'#FFEBE6', border:'#FFBDAD', dark:'#BF2600' },
        info:    { DEFAULT:'#0052CC', light:'#DEEBFF', border:'#4C9AFF' },
        purple:  { DEFAULT:'#5243AA', light:'#EAE6FF', border:'#998DD9' },
        teal:    { DEFAULT:'#00A3BF', light:'#E6FCFF', border:'#79E2F2' },
      },
      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        'xs':  ['11px', { lineHeight: '16px' }],
        'sm':  ['12px', { lineHeight: '18px' }],
        'base':['13px', { lineHeight: '20px' }],
        'md':  ['14px', { lineHeight: '20px' }],
        'lg':  ['16px', { lineHeight: '24px' }],
        'xl':  ['18px', { lineHeight: '28px' }],
        '2xl': ['20px', { lineHeight: '28px' }],
        '3xl': ['24px', { lineHeight: '32px' }],
        '4xl': ['30px', { lineHeight: '36px' }],
      },
      boxShadow: {
        card:  '0 1px 3px rgba(23,43,77,0.10), 0 0 0 1px rgba(23,43,77,0.06)',
        hover: '0 4px 12px rgba(23,43,77,0.12), 0 0 0 1px rgba(23,43,77,0.08)',
        modal: '0 20px 64px rgba(23,43,77,0.22), 0 4px 16px rgba(23,43,77,0.12)',
        focus: '0 0 0 3px rgba(0,82,204,0.20)',
        'inset-brand': 'inset 0 0 0 2px #0052CC',
      },
      borderRadius: {
        sm:  '4px',
        DEFAULT: '6px',
        md:  '8px',
        lg:  '10px',
        xl:  '12px',
      },
      spacing: {
        '4.5': '18px',
        '13':  '52px',
        '15':  '60px',
        '18':  '72px',
      },
      animation: {
        'fade-in':    'fadeIn 0.15s ease-out',
        'slide-up':   'slideUp 0.2s ease-out',
        'spin-slow':  'spin 1.5s linear infinite',
        'pulse-dot':  'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' },               to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
    },
  },
  plugins: [],
};
export default config;
