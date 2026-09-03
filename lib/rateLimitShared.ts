import { queryOne, withSystemContext } from './db';

// ─── Rate limit partilhado entre instâncias ──────────────────────────────────
// Irmão de lib/rateLimit.ts, para os limites que são controlos de SEGURANÇA e
// não apenas tetos anti-abuso. A diferença é onde vive a contagem:
//
//   lib/rateLimit.ts        em memória (globalThis) — rápido, por instância,
//                           usado pelo travão genérico de /api/* no middleware
//                           Edge, que não consegue falar com o Postgres.
//   lib/rateLimitShared.ts  no Postgres — partilhado por todas as instâncias,
//                           usado pelo login.
//
// Porque é que o login pode: o travão do login é aplicado dentro de
// app/api/auth/login/route.ts, que é um route handler normal (runtime Node, com
// pool de ligações). Só o *middleware* corre no Edge. Isso significa que dá para
// tornar o controlo de segurança correto sem trazer Redis para o projeto nem
// depender de flags experimentais do Next.
//
// Custo: uma ida à base de dados por tentativa de login. É desprezável — só
// acontece em POST /api/auth/login, e é a mesma ordem de grandeza do
// bcrypt.compare que vem logo a seguir.

export interface SharedRateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

// Falhar aberto ou fechado? Aberto. Se o Postgres estiver em baixo, o login já
// não funciona de qualquer forma (a verificação de credenciais precisa dele), por
// isso "fechado" não protegeria nada e "aberto" não abre nada. O que não se pode
// é rebentar com um 500 e transformar um problema de base de dados num erro
// diferente do que realmente é.
const FAIL_OPEN: SharedRateLimitResult = { ok: true, remaining: 0, retryAfterMs: 0 };

/**
 * Incrementa e avalia um contador partilhado. Uma única instrução, atómica:
 * o INSERT ... ON CONFLICT resolve a corrida entre instâncias dentro do
 * Postgres, sem SELECT-depois-UPDATE e sem transação explícita.
 *
 * A janela é deslizante-por-blocos, igual à de lib/rateLimit.ts: a primeira
 * tentativa abre a janela e todas as seguintes contam contra ela até expirar.
 */
export async function rateLimitShared(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<SharedRateLimitResult> {
  try {
    // withSystemContext porque isto corre antes de existir sessão — não há
    // clínica a estabelecer no contexto de RLS, e a tabela não é de nenhuma.
    const row = await withSystemContext(() =>
      queryOne(
        `INSERT INTO rate_limit_counters (key, window_start, count)
         VALUES ($1, NOW(), 1)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE
             WHEN rate_limit_counters.window_start < NOW() - ($2::bigint * INTERVAL '1 millisecond')
             THEN 1
             ELSE rate_limit_counters.count + 1
           END,
           window_start = CASE
             WHEN rate_limit_counters.window_start < NOW() - ($2::bigint * INTERVAL '1 millisecond')
             THEN NOW()
             ELSE rate_limit_counters.window_start
           END
         RETURNING count, window_start,
                   EXTRACT(EPOCH FROM (window_start + ($2::bigint * INTERVAL '1 millisecond') - NOW())) * 1000 AS retry_after_ms`,
        [key, Math.trunc(windowMs)],
      ),
    );
    if (!row) return FAIL_OPEN;
    const count = Number(row.count || 0);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: Math.max(0, Math.ceil(Number(row.retry_after_ms || 0))),
    };
  } catch (e) {
    console.error('[rate-limit] contador partilhado indisponível:', e instanceof Error ? e.message : e);
    return FAIL_OPEN;
  }
}

/**
 * Apaga janelas já expiradas. Chamado pelo pipeline de jobs — sem isto a tabela
 * cresce com uma linha por cada par IP/email que alguma vez tentou entrar, que é
 * espaço de chaves escolhido por quem ataca (o mesmo raciocínio que levou à
 * varredura em lib/rateLimit.ts, aqui com a vantagem de o Postgres não se
 * importar com o tamanho enquanto a limpeza acontecer).
 */
export async function sweepRateLimitCounters(olderThanMs = 24 * 60 * 60 * 1000) {
  const row = await withSystemContext(() =>
    queryOne(
      `WITH deleted AS (
         DELETE FROM rate_limit_counters
         WHERE window_start < NOW() - ($1::bigint * INTERVAL '1 millisecond')
         RETURNING 1
       )
       SELECT COUNT(*)::int AS removed FROM deleted`,
      [Math.trunc(olderThanMs)],
    ),
  );
  return { removed: Number(row?.removed || 0) };
}
