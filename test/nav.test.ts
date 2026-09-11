// ─── O menu e as páginas não podem divergir ─────────────────────────────────
// Duas formas de isto correr mal, ambas invisíveis a olho e ambas silenciosas:
//
//   • uma entrada de menu sem página — 404 para quem lá carrega;
//   • uma página sem entrada de menu — trabalho feito que ninguém alcança, e que apodrece
//     porque ninguém repara que existe.
//
// A segunda é a que este projeto teve mesmo: sete módulos de API inteiros
// (patient-scoring, forecast, analytics, conversations, care-pathways,
// data-subject-requests, suppliers) foram construídos e testados sem que uma única
// página os chamasse. Um teste não os teria evitado — mas evita o próximo.
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { NAV } from '../lib/constants.ts';

const DASHBOARD = path.join(import.meta.dirname, '..', 'app', 'dashboard');

function pageRoutes(dir: string, prefix = '/dashboard'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pageRoutes(full, `${prefix}/${entry}`));
    else if (entry === 'page.tsx') out.push(prefix);
  }
  return out;
}

const onDisk = new Set(pageRoutes(DASHBOARD));
const inNav = new Map<string, { role: string; label: string }>();
for (const [role, items] of Object.entries(NAV)) {
  for (const item of items) inNav.set(item.href, { role, label: item.label });
}

// ─── Páginas deliberadamente sem link ───────────────────────────────────────
// Cada uma tem de dizer porquê. Uma página que caia aqui sem razão escrita é uma página
// esquecida a fingir-se de decisão.
const SEM_LINK = new Map<string, string>([
  [
    '/dashboard/dentist/notes',
    'Redireciona para /patients — um URL antigo que alguém pode ter guardado nos favoritos.',
  ],
  // ─── Estacionadas: descrevem o que fariam, sem dados por baixo ─────────────
  // Ficam no repositório porque o texto de cada uma (components/super-admin/NotInstrumented)
  // nomeia as tabelas que faltariam — é a especificação, e apagá-la perderia o raciocínio.
  // O que saiu foi o LINK: um menu que promete nove secções e entrega uma é pior do que um
  // menu honesto de seis.
  ...(
    [
      ['billing/subscriptions', 'Faturação'],
      ['billing/payments', 'Faturação'],
      ['billing/usage', 'Faturação'],
      ['billing/invoices', 'Faturação'],
      ['integrations', 'Integrações'],
      ['integrations/connections', 'Integrações'],
      ['integrations/sync', 'Integrações'],
      ['integrations/api', 'Integrações'],
    ] as const
  ).map(
    ([p, grupo]) =>
      [
        `/dashboard/super-admin/${p}`,
        `${grupo}: precisa de um modelo de dados que não existe, e que não deve ser inventado antes do primeiro cliente.`,
      ] as [string, string],
  ),
  [
    '/dashboard/super-admin/locations',
    'Não há nada acima de `tenants`: a tabela é plana. Um dono com várias clínicas é uma migração, não um menu.',
  ],
  ['/dashboard/super-admin/organizations', 'Mesma razão de locations — não existe organização acima da clínica.'],
  [
    '/dashboard/super-admin/permissions',
    'A matriz de permissões é por clínica (role_permissions.tenant_id). Ao nível da plataforma não há matriz a editar — entra-se na clínica e usa-se a dela.',
  ],
]);

test('nenhuma entrada de menu leva a uma página que não existe', () => {
  const mortos = [...inNav.entries()]
    .filter(([href]) => !onDisk.has(href))
    .map(([href, m]) => `${m.role} · «${m.label}» → ${href}`);
  assert.deepEqual(mortos, [], `Entradas de menu sem página:\n  ${mortos.join('\n  ')}`);
});

test('nenhuma página fica sem forma de lá chegar', () => {
  const orfas = [...onDisk]
    .filter((p) => !inNav.has(p))
    .filter((p) => !/\/\[[^\]]+\]$/.test(p)) // segmentos dinâmicos: alcançados por link interno
    .filter((p) => !SEM_LINK.has(p))
    .sort();
  assert.deepEqual(
    orfas,
    [],
    'Páginas sem entrada de menu:\n  ' +
      orfas.join('\n  ') +
      '\n\nAcrescenta a entrada no NAV, ou declara-a em SEM_LINK com a razão por escrito.',
  );
});

test('a lista de páginas sem link não guarda entradas que já não existem', () => {
  // Uma exceção que sobrevive à página que a justificava é uma mentira a acumular.
  const fantasmas = [...SEM_LINK.keys()].filter((p) => !onDisk.has(p));
  assert.deepEqual(fantasmas, [], `SEM_LINK aponta para páginas apagadas: ${fantasmas.join(', ')}`);
});

test('cada papel tem uma navegação agrupada e não vazia', () => {
  for (const [role, items] of Object.entries(NAV)) {
    assert.ok(items.length > 0, `${role} ficou sem navegação`);
    const semGrupo = items.filter((i) => !i.group).map((i) => i.label);
    assert.deepEqual(semGrupo, [], `${role}: entradas sem grupo — ${semGrupo.join(', ')}`);
  }
});

test('a raiz de cada papel é alcançável a partir do próprio menu', () => {
  // O logótipo e o redirecionamento pós-login levam a ROLE_HOME; se essa página não
  // estiver no menu, a pessoa aterra num sítio de onde não sabe sair.
  for (const [role, items] of Object.entries(NAV)) {
    const raiz = role === 'super_admin' ? '/dashboard/super-admin' : `/dashboard/${role.replace('_', '-')}`;
    assert.ok(
      items.some((i) => i.href === raiz),
      `${role}: a home (${raiz}) não está no menu`,
    );
  }
});
