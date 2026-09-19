// ─── Rate limit genérico via Postgres ──────────────────────────────────
// Irmão de lib/rateLimitShared.ts. A diferença é que isto é usado por
// route handlers do Next.js (runtime Node, com pool de ligações),
// NÃO pelo proxy Edge — que por isso continua a usar a versão
// in-memory de lib/rateLimit.ts.
//
// Porquê: em deploy multi-instância, o rate limit in-memory por instância
// é ineficaz — quem ataca pode distribuir pedidos por réplicas e
// contornar o travão. O Postgres como contador partilhado elimina o
// problema. Ver scripts/migrations/036_shared_rate_limit.sql para a
// tabela rate_limit_counters.
//
// Uso típico: app/api/* routes que necessitam de um teto estrito
// entre instâncias, para além do rate limit in-memory do proxy.

import { queryOne, withSystemContext } from './db';
import { rateLimit } from './rateLimit';

export interface GlobalRateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

// ─── Quando o contador partilhado não responde ──────────────────────────────
// Isto começou como uma cópia do FAIL_OPEN de lib/rateLimitShared.ts, mas o argumento
// que lá está não se transporta para cá. Lá o raciocínio é: se o Postgres está em
// baixo, o login já não funciona de qualquer maneira — logo "fechado" não protege nada.
//
// Aqui a falha que interessa não é "o Postgres está em baixo": é o POOL ESGOTADO.
// getPool().connect() espera 15s e desiste (lib/db.ts), e o que esgota o pool é
// precisamente uma rajada de escritas — ou seja, o travão desaparecia exatamente no
// momento para que foi escrito, e desaparecia por causa da própria coisa que devia
// travar. Um limite que se desliga sozinho sob carga não é um limite.
//
// A resposta não é fechar (um problema de base de dados passaria a recusar escritas
// legítimas, e o 429 mentiria sobre a causa). É cair para o travão que NÃO precisa da
// base de dados: o contador em memória de lib/rateLimit.ts. Vale por instância — com N
// réplicas o teto efetivo é N × o configurado — o que é pior do que o partilhado e
// muito melhor do que nada. É a mesma degradação que o proxy já aceita como normal.
function fallbackLimit(key: string, limit: number, windowMs: number): GlobalRateLimitResult {
  const rl = rateLimit(`fallback:${key}`, { limit, windowMs });
  return { ok: rl.ok, remaining: rl.remaining, retryAfterMs: rl.retryAfterMs };
}

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
    // Sem linha devolvida não se sabe a contagem — mesma situação de não ter chegado
    // a falar com a base, e portanto o mesmo tratamento.
    if (!row) return fallbackLimit(key, limit, windowMs);
    const count = Number(row.count || 0);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: Math.max(0, Math.ceil(Number(row.retry_after_ms || 0))),
    };
  } catch (e) {
    console.error(
      '[rate-limit global] indisponível, a usar o contador em memória:',
      e instanceof Error ? e.message : e,
    );
    return fallbackLimit(key, limit, windowMs);
  }
}
