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
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
  // O que saiu foi o LINK, e a regra está escrita em lib/constants.ts: a página é honesta
  // com quem lá chega, mas só depois de a pessoa ter ido lá ver. O link é que promete.
  //
  // Esta lista é o inverso do menu, e é de propósito que custa a escrever: cada linha
  // obriga a dizer o que falta por baixo. Uma página que ganhe dados sai daqui e volta ao
  // NAV — foi o que aconteceu a settings/system, que tinha ~20 linhas de placeholder e
  // hoje lê `systemConfig()`.
  ...(
    [
      ['integrations', 'precisa de um modelo de dados que não existe, e que não deve ser inventado antes do primeiro cliente'],
      ['integrations/connections', 'idem — não há tabela de ligações a terceiros'],
      ['integrations/sync', 'idem — não há registo de sincronizações'],
      ['integrations/api', 'idem — não há chaves de API emitidas a guardar'],
      ['ai/evaluations', 'não há tabela de avaliações de agentes; o que existe é `ai_runs`, que é execução e não avaliação'],
      ['ops/tasks', 'as tarefas que existem são da clínica (`tasks.tenant_id`); tarefa ao nível da plataforma não tem tabela'],
      ['ops/support', 'não há tabela de tickets, e um canal de suporte é produto antes de ser ecrã'],
      ['security/sessions', 'a autenticação é por JWT assinado e sem estado: listar sessões exige um registo do lado do servidor que não existe. Metade da revogação já existe e é a metade difícil — `users.password_changed_at` (migração 046) invalida os tokens anteriores, e lib/permissions.ts revalida a cada pedido. O que falta é a LISTA'],
      ['settings', 'não há tabela de configuração da plataforma; o que é configurável hoje são variáveis de ambiente, e essas veem-se em settings/system'],
      ['settings/ai-policies', 'as fronteiras dos agentes estão no código (lib/agents/registry.ts) e não em dados — editá-las num ecrã é uma decisão de produto, não um CRUD'],
      ['settings/feature-flags', 'não há tabela de flags nem sítio onde o código as leia'],
    ] as const
  ).map(([p, razao]) => [`/dashboard/super-admin/${p}`, razao] as [string, string]),
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

// ─── Nenhum link escrito à mão pode apontar para o vazio ────────────────────
// Os testes acima confrontam o NAV com o disco, e é isso que sabem fazer. Passavam
// todos enquanto QUATRO links escritos directamente no corpo das páginas davam 404 —
// três deles no ecrã de entrada, o único que toda a gente vê:
//
//   app/page.tsx            → /recuperar-palavra-passe, /privacidade, /termos
//   components/shared/Reports.tsx → /dashboard/super-admin/recovery
//
// Nenhum estava no NAV, por isso nenhum era visível a este ficheiro. O «Recuperar
// acesso» é o exemplo de como isto dói: quem lá carrega está trancado fora da conta.
//
// Esta varredura lê os href/push/redirect literais de todo o app/ e components/ e
// confronta-os com as páginas que existem em disco — dashboard incluído e tudo o resto.
test('todos os links internos escritos à mão apontam para páginas que existem', () => {
  const APP = path.join(import.meta.dirname, '..', 'app');
  const COMPONENTS = path.join(import.meta.dirname, '..', 'components');

  // Rotas de página em TODO o app/, e não só em /dashboard.
  const todasAsPaginas = new Set(pageRoutes(APP, ''));
  todasAsPaginas.add('/'); // app/page.tsx dá '' acima

  function ficheiros(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...ficheiros(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  // href="/x", router.push('/x'), redirect('/x') — só literais, e só internos.
  const PADRAO = /(?:href=|router\.push\(|\bredirect\()\s*['"`](\/[^'"`\s${}]*)['"`]/g;
  const raiz = path.join(import.meta.dirname, '..');
  const partidos: string[] = [];

  for (const ficheiro of [...ficheiros(APP), ...ficheiros(COMPONENTS)]) {
    const src = readFileSync(ficheiro, 'utf8');
    for (const m of src.matchAll(PADRAO)) {
      const alvo = (m[1] as string).split(/[?#]/)[0].replace(/\/$/, '') || '/';

      // Fora de âmbito: a API não tem page.tsx, os ficheiros estáticos vivem em
      // public/, e um segmento dinâmico não se resolve sem valores.
      if (alvo.startsWith('/api/') || alvo.includes('[')) continue;
      if (/\.[a-z0-9]+$/i.test(alvo)) continue;

      // Uma rota dinâmica em disco (/portal/[token]) cobre /portal/<o-que-for>.
      const cobertaPorDinamica = [...todasAsPaginas].some((p) => {
        if (!p.includes('[')) return false;
        const re = new RegExp(`^${p.replace(/\[[^\]]+\]/g, '[^/]+')}$`);
        return re.test(alvo);
      });

      if (!todasAsPaginas.has(alvo) && !cobertaPorDinamica) {
        partidos.push(`${path.relative(raiz, ficheiro)} → ${alvo}`);
      }
    }
  }

  assert.deepEqual(
    [...new Set(partidos)].sort(),
    [],
    'Links internos para páginas que não existem:\n  ' + [...new Set(partidos)].sort().join('\n  '),
  );
});
