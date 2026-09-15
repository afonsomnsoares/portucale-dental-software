// ─── O primeiro arranque de quem clona o repositório ────────────────────────
// O docker-compose.yml declara algumas variáveis com `${VAR:?...}`, que é a forma de
// dizer ao Compose «sem isto, não arranques». Três delas — POSTGRES_PASSWORD,
// POSTGRES_APP_PASSWORD e PGADMIN_PASSWORD — não estavam no .env.example, por isso o
// caminho documentado no README
//
//     cp .env.example .env && docker compose up -d
//
// morria antes de subir um único contentor:
//
//     error while interpolating services.postgres.environment.POSTGRES_PASSWORD:
//     required variable POSTGRES_PASSWORD is missing
//
// Nada apanhava isto: o CI corre contra um Postgres de serviço e nunca lê o compose,
// e quem já tinha o .env feito à mão não voltava a passar por aqui. Só um clone
// limpo é que reproduzia — ou seja, exatamente quem ainda não conhece o projeto.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const raiz = path.join(import.meta.dirname, '..');
const compose = readFileSync(path.join(raiz, 'docker-compose.yml'), 'utf8');
const exemplo = readFileSync(path.join(raiz, '.env.example'), 'utf8');

/** Nomes declarados no .env.example, com ou sem valor, incluindo os comentados. */
function declaradasNoExemplo(src: string): Set<string> {
  const nomes = new Set<string>();
  for (const linha of src.split('\n')) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(linha);
    if (m) nomes.add(m[1] as string);
  }
  return nomes;
}

test('todas as variáveis obrigatórias do compose estão no .env.example', () => {
  // `${VAR:?mensagem}` — o Compose recusa arrancar sem ela.
  const obrigatorias = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1] as string);
  const unicas = [...new Set(obrigatorias)].sort();

  assert.ok(unicas.length > 0, 'nenhuma variável obrigatória encontrada — o padrão mudou?');

  const temos = declaradasNoExemplo(exemplo);
  const faltam = unicas.filter((v) => !temos.has(v));

  assert.deepEqual(
    faltam,
    [],
    `Variáveis que o docker-compose.yml exige e o .env.example não menciona: ${faltam.join(', ')}.\n` +
      'Sem elas, `cp .env.example .env && docker compose up -d` aborta sem arrancar nada.',
  );
});

test('as passwords obrigatórias ficam vazias no exemplo, não preenchidas', () => {
  // Um valor por omissão numa password é pior do que campo vazio: passa despercebido
  // e vai para produção. O `:?` do compose já garante que ninguém arranca sem
  // escolher uma — mas só se o exemplo não trouxer nenhuma escrita.
  const segredos = ['POSTGRES_PASSWORD', 'POSTGRES_APP_PASSWORD', 'PGADMIN_PASSWORD', 'JWT_SECRET'];
  const preenchidas: string[] = [];

  for (const nome of segredos) {
    const m = new RegExp(`^${nome}=(.*)$`, 'm').exec(exemplo);
    if (m && (m[1] as string).trim() !== '') preenchidas.push(`${nome}=${m[1]}`);
  }

  assert.deepEqual(preenchidas, [], `Segredos com valor escrito no .env.example: ${preenchidas.join(', ')}`);
});
