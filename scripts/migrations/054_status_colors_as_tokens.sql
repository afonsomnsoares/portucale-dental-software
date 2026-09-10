-- ─── CORES DOS ESTADOS COMO TOKENS, NÃO COMO HEX ──────────────────────────
-- `statuses.bg` e `statuses.color` guardavam hex literais, semeados por
-- scripts/seed.ts e servidos por app/api/settings/route.ts como STATUS_META.
-- O componente Badge (components/ui.tsx) injeta-os diretamente em
-- style={{ background, color }} — ou seja, a paleta dos estados vivia na base
-- de dados e não no CSS, e ganhava sempre ao FALLBACK_STATUS do próprio
-- componente, que raramente chegava a correr.
--
-- Isso tornava a folha de estilos incapaz de corrigir o que quer que fosse.
-- Em concreto: o âmbar dos estados "A aguardar", "A provisionar", "Proposto" e
-- "Parcial" era #FF8B00, que sobre o seu fundo dá 2.35:1 de contraste — abaixo
-- do mínimo de 4.5:1 da WCAG AA, num rótulo de 11px. Não havia como corrigir
-- isso sem uma migração, porque o valor não estava em lado nenhum do código.
--
-- Passam a guardar-se nomes de tokens. `var(--urgency-soon)` é um valor de cor
-- CSS válido num style inline, portanto o Badge não muda uma linha — mas a cor
-- passa a ser decidida em app/globals.css, onde pode ser auditada e corrigida.
--
-- Só se reescrevem os valores que vieram do catálogo semeado. Uma clínica que
-- tenha personalizado a cor de um estado fica com o hex que escolheu.

UPDATE statuses SET bg = v.token
FROM (VALUES
  ('#DEEBFF', 'var(--accent-bg)'),
  ('#EBECF0', 'var(--bg-sunken)'),
  ('#FFF7E6', 'var(--urgency-soon-bg)'),
  ('#FFEBE6', 'var(--urgency-critical-bg)'),
  ('#E3FCEF', 'var(--urgency-ok-bg)'),
  ('#E6FCFF', 'var(--cat-teal-bg)')
) AS v(hex, token)
WHERE upper(statuses.bg) = v.hex;

UPDATE statuses SET color = v.token
FROM (VALUES
  ('#0052CC', 'var(--accent)'),
  ('#5E6C84', 'var(--text-secondary)'),
  ('#FF8B00', 'var(--urgency-soon)'),
  ('#DE350B', 'var(--urgency-critical)'),
  ('#00875A', 'var(--urgency-ok)'),
  ('#00A3BF', 'var(--cat-teal)')
) AS v(hex, token)
WHERE upper(statuses.color) = v.hex;
