/** @type {import('tailwindcss').Config} */

/* O Tailwind aqui trata de LAYOUT, ESPAÇAMENTO e TIPO. Cor não — cor vive nos
   tokens de app/globals.css e escreve-se `var(--token)`.
   Essa regra não é preferência: é o que o código já fazia. Em todo o dashboard
   não havia uma única utilidade de cor do Tailwind, e o bloco que este ficheiro
   tinha para as expor (text-primary, bg-surface, border-subtle e mais oito)
   contava zero consumidores. Saiu.

   ─── E a escala de tipo passa a APONTAR para os tokens ────────────────────
   Este ficheiro tinha a sua própria escala, e não coincidia com a do CSS:
   `text-sm` valia 12px enquanto `var(--text-sm)` valia 13px. O mesmo nome, dois
   tamanhos — que é pior do que não ter nome nenhum, porque convida a assumir
   que são a mesma coisa.

   Apontando para as variáveis, passam a ser a mesma coisa por construção. É o
   que a escala de espaçamento (gap-3 = 12px = var(--space-3)) já fazia de
   graça, e é o que torna as duas formas de escrever estilo neste projeto
   compatíveis em vez de concorrentes. */

const passo = (nome, comTracking = true) => [
  `var(--text-${nome})`,
  {
    lineHeight: `var(--text-${nome}-leading)`,
    ...(comTracking ? { letterSpacing: `var(--text-${nome}-tracking)` } : {}),
  },
];

const config = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        // Os nomes antigos do Tailwind encaixam nos três valores do sistema,
        // para um `rounded-lg` já escrito apontar para o token do cartão em vez
        // de para um 10px avulso.
        none: '0',
        DEFAULT: 'var(--radius-control)',
        sm: 'var(--radius-control)',
        md: 'var(--radius-control)',
        lg: 'var(--radius-card)',
        xl: 'var(--radius-card)',
        full: 'var(--radius-pill)',
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        // `shadow-none` é o defeito de tudo o que está assente. Um componente
        // que precise de `shadow-1` ou acima está a afirmar que flutua.
        DEFAULT: 'var(--elev-1)',
        none: 'var(--elev-0)',
        1: 'var(--elev-1)',
        2: 'var(--elev-2)',
        3: 'var(--elev-3)',
        focus: 'var(--ring-focus)',
      },
      fontFamily: {
        sans: ['var(--font-plus-jakarta)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      fontWeight: {
        normal: 'var(--weight-normal)',
        medium: 'var(--weight-medium)',
        semibold: 'var(--weight-semibold)',
        bold: 'var(--weight-bold)',
      },
      fontSize: {
        '2xs': passo('2xs'),
        xs: passo('xs', false),
        sm: passo('sm', false),
        base: passo('base', false),
        lg: passo('lg'),
        xl: passo('xl'),
        '2xl': passo('2xl'),
        '3xl': passo('3xl'),
      },
    },
  },
  plugins: [],
};
export default config;
