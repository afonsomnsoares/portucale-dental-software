// ─── A invariante que estava escrita só num comentário ──────────────────────
// lib/route.ts promete, por escrito, que o `tenantId` que entrega ao handler já está
// resolvido e que «o handler não precisa de o voltar a verificar». Durante a migração
// das 132 rotas isso ficou por cumprir em 48 delas: declaravam `tenant: 'optional'` e
// voltavam a derivar o âmbito de `user.tenantId`, que vem do TOKEN.
//
// Para quem tem clínica própria os dois valores coincidem, e por isso nada parecia
// partido. Para o super-admin DENTRO de uma clínica (cookie acting_tenant) não
// coincidem — o `user.tenantId` dele é sempre null, por construção
// (users_role_tenant_consistency) — e o resultado dividia-se em dois:
//
//   • as rotas de leitura tratavam null como «sem filtro», e devolviam os dados de
//     TODAS as clínicas enquanto o ActingClinicBanner dizia que ele estava numa;
//   • 26 rotas de escrita faziam `if (!user.tenantId) return forbidden()`, e barravam-no
//     das páginas de admin que a Fase 3 desenhou precisamente para ele usar.
//
// Um comentário não impede isto de voltar. Este ficheiro impede: é uma leitura estática
// do que as rotas escrevem, e falha o build. Mesmo papel do
// test/integration/rls-coverage.test.ts para as tabelas sem política.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const API_DIR = path.join(import.meta.dirname, '..', 'app', 'api');

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

// Comentários fora: neste projeto eles falam do código, e falam muito. Uma menção a
// `user.tenantId` numa frase explicativa não é uma utilização.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const files = routeFiles(API_DIR).map((file) => ({
  rel: path.relative(path.join(API_DIR, '..', '..'), file),
  code: stripComments(readFileSync(file, 'utf8')),
}));

// ─── As exceções, e porque é que cada uma é uma ─────────────────────────────
// Só entra aqui uma rota cuja pergunta seja mesmo sobre a PESSOA («esta pessoa pertence
// a uma clínica?») e não sobre o pedido («de que clínica falamos?»). A segunda pergunta
// tem uma resposta só, e é a do wrapper.
const EXCECOES = new Map<string, string>([
  [
    'app/api/shift-handoffs/route.ts',
    'O ?scope=forMe filtra pelas passagens de turno da própria pessoa, e um super-admin ' +
      'não faz turnos numa clínica. A pergunta é sobre quem chama, não sobre o âmbito.',
  ],
]);

test('nenhuma rota deriva o âmbito de user.tenantId — vem resolvido do withRoute', () => {
  const infratores = files
    .filter(({ rel, code }) => code.includes('user.tenantId') && !EXCECOES.has(rel))
    .map(({ rel }) => rel);

  assert.deepEqual(
    infratores,
    [],
    'Estas rotas leem a clínica do token em vez da que o withRoute resolveu, e por isso ' +
      'não funcionam para um super-admin que tenha entrado numa clínica:\n  ' +
      infratores.join('\n  ') +
      '\n\nUsa o `tenantId` do contexto do handler. Se a pergunta for mesmo sobre a pessoa ' +
      'e não sobre o âmbito, acrescenta a rota a EXCECOES aqui com a razão por escrito.',
  );
});

test('o guardião de posse recebe a clínica resolvida, não o utilizador', () => {
  // getOwnedPatient/getOwnedUser filtram por `($2::uuid IS NULL OR tenant_id=$2::uuid)`:
  // com um tenantId nulo a condição desaparece e o guardião deixa de guardar. Passar
  // `user` era exatamente isso para o super-admin dentro de uma clínica — e a RLS não o
  // apanhava, porque a política começa por `is_super_admin = 'true' OR …`. As duas
  // defesas caíam pela mesma razão, no mesmo pedido.
  const infratores: string[] = [];
  for (const { rel, code } of files) {
    for (const m of code.matchAll(/getOwned(?:Patient|User)\(\s*[^,)]+,\s*(user)\b/g)) {
      infratores.push(`${rel} — getOwned…(…, ${m[1]})`);
    }
  }
  assert.deepEqual(
    infratores,
    [],
    'Passa `{ tenantId }` em vez de `user`:\n  ' + infratores.join('\n  '),
  );
});

test("'optional' significa mesmo «o super-admin fora de qualquer clínica»", () => {
  // A política existe para as rotas de plataforma, onde a ausência de clínica quer dizer
  // «todas». Uma rota que a declare e depois exija uma clínica concreta está a pedir ao
  // wrapper o oposto do que precisa — e paga isso com um 403 para quem entrou numa.
  const infratores: string[] = [];
  for (const { rel, code } of files) {
    if (!code.includes("tenant: 'optional'")) continue;
    if (/if \(!tenantId\) return (forbidden|unauthorized)\(\)/.test(code)) {
      infratores.push(`${rel} — declara 'optional' e depois exige uma clínica`);
    }
  }
  assert.deepEqual(
    infratores,
    [],
    "Usa `tenant: 'required'` (ou 'resolved', se o super-admin puder escolher a clínica) " +
      'e deixa o 403 para o wrapper:\n  ' +
      infratores.join('\n  '),
  );
});
