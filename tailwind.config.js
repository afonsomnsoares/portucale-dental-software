/** @type {import('tailwindcss').Config} */

/* As cores vivem em app/globals.css, não aqui. Este ficheiro só as expõe como
   utilitários, apontando para os tokens semânticos — para `text-muted` e
   `bg-sunken` significarem exatamente o mesmo que `var(--text-muted)` e
   `var(--bg-sunken)` num style inline. Uma fonte de verdade, dois sotaques.

   Nada de escalas numéricas (brand-500, ink-300): um número não diz para que
   serve, e foi por isso que a paleta anterior acabou usada 3 vezes em 208
   ficheiros enquanto o resto da app escrevia hex à mão. */

const config = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      textColor: {
        primary:   'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted:     'var(--text-muted)',
        disabled:  'var(--text-disabled)',
        onAccent:  'var(--text-onAccent)',
        accent:    'var(--accent)',
        critical:  'var(--urgency-critical)',
        soon:      'var(--urgency-soon)',
        ok:        'var(--urgency-ok)',
      },
      backgroundColor: {
        page:          'var(--bg-page)',
        surface:       'var(--bg-surface)',
        sunken:        'var(--bg-sunken)',
        raised:        'var(--bg-raised)',
        accent:        'var(--accent)',
        'accent-soft': 'var(--accent-bg)',
        'critical':    'var(--urgency-critical)',
        'critical-bg': 'var(--urgency-critical-bg)',
        'soon':        'var(--urgency-soon)',
        'soon-bg':     'var(--urgency-soon-bg)',
        'ok':          'var(--urgency-ok)',
        'ok-bg':       'var(--urgency-ok-bg)',
      },
      borderColor: {
        DEFAULT:  'var(--border-subtle)',
        subtle:   'var(--border-subtle)',
        strong:   'var(--border-strong)',
        focus:    'var(--border-focus)',
        critical: 'var(--urgency-critical-border)',
        soon:     'var(--urgency-soon-border)',
        ok:       'var(--urgency-ok-border)',
      },
      borderRadius: {
        // Três valores, e os nomes antigos do Tailwind encaixam neles. Assim
        // um `rounded-lg` já escrito passa a apontar para o token do cartão em
        // vez de para um 10px avulso, sem ter de se tocar em nenhum .tsx.
        none:    '0',
        DEFAULT: 'var(--radius-control)',
        sm:      'var(--radius-control)',
        md:      'var(--radius-control)',
        lg:      'var(--radius-card)',
        xl:      'var(--radius-card)',
        full:    'var(--radius-pill)',
        control: 'var(--radius-control)',
        card:    'var(--radius-card)',
        pill:    'var(--radius-pill)',
      },
      boxShadow: {
        // A escala completa. `shadow-none` é o defeito de tudo o que está
        // assente — se um componente precisa de `shadow-1` ou acima, é porque
        // flutua, e isso é uma afirmação sobre o que ele é.
        DEFAULT: 'var(--elev-1)',
        none:    'var(--elev-0)',
        1:       'var(--elev-1)',
        2:       'var(--elev-2)',
        3:       'var(--elev-3)',
        focus:   'var(--ring-focus)',
      },
      fontFamily: {
        sans: ['var(--font-plus-jakarta)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
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
    },
  },
  plugins: [],
};
export default config;
