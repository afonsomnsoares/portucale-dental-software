// ─── Rate limit genérico via Postgres ──────────────────────────────────
// Irmão de lib/rateLimitShared.ts. A diferença é que isto é usado por
// route handlers do Next.js (runtime Node, com pool de ligações),
// NÃO pelo middleware Edge — que por isso continua a usar a versão
// in-memory de lib/rateLimit.ts.
//
// Porquê: em deploy multi-instância, o rate limit in-memory por instância
// é ineficaz — quem ataca pode distribuir pedidos por réplicas e
// contornar o travão. O Postgres como contador partilhado elimina o
// problema. Ver scripts/migrations/036_shared_rate_limit.sql para a
// tabela rate_limit_counters.
//
// Uso típico: app/api/* routes que necessitam de um teto estrito
// entre instâncias, para além do rate limit in-memory do middleware.

import { queryOne, withSystemContext } from './db';

export interface GlobalRateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

const FAIL_OPEN: GlobalRateLimitResult = { ok: true, remaining: 0, retryAfterMs: 0 };

export async function rateLimitGlobal(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<GlobalRateLimitResult> {
  try {
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
    console.error('[rate-limit global] indisponível:', e instanceof Error ? e.message : e);
    return FAIL_OPEN;
  }
}

export async function sweepRateLimitCountersGlobal(olderThanMs = 24 * 60 * 60 * 1000) {
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
