import { queryRead } from '@/lib/db';
import { subscribeRealtime } from '@/lib/realtime';
import { withRoute } from '@/lib/route';

// ─── Server-Sent Events ─────────────────────────────────────────────────────
// Eventos:
//
//   event: connected   {"status":"ok"}
//   event: snapshot    {"appointments":[...]}          uma vez, ao ligar
//   event: change      {"table":"appointments","op":"UPDATE","id":"...","status":"waiting"}
//   event: heartbeat   {"ts":1234567890}
//
// Antes desta versão o endpoint mandava o snapshot e depois passava a vida a mandar
// heartbeats: uma página ligada a ele ficava tão desatualizada como uma página sem ele,
// só que com uma ligação aberta a fingir o contrário. Hoje os eventos `change` vêm do
// LISTEN/NOTIFY do Postgres (migração 051 + lib/realtime.ts), por isso chegam quando
// alguma coisa acontece de facto e funcionam entre instâncias.
//
// ─── O que o evento NÃO traz ────────────────────────────────────────────────
// Só a tabela, o id e o estado novo. Nenhum nome, nenhum dado do doente. Quem receber
// um `change` e quiser saber mais vai buscá-lo pela API normal, com a sessão dele e com
// a RLS a valer. Um canal de tempo real é a última coisa que deve transportar dados
// clínicos: é fácil de esquecer aberto, difícil de auditar, e ninguém verifica o que
// passa por lá.
export const dynamic = 'force-dynamic';

export const GET = withRoute(
  {
    authOnly:
      'Canal de tempo real da própria clínica. Não transporta dados de doente — só ' +
      'tabela, id e estado novo (ver o cabeçalho acima) — por isso não há registo ' +
      'concreto cuja permissão fizesse sentido exigir aqui',
  },
  async ({ request, tenantId }) => {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // O cliente fechou entre a verificação e a escrita. Não é erro.
            closed = true;
          }
        };

        send('connected', { status: 'ok' });

        try {
          const rows = await queryRead(
            `SELECT id, status FROM appointments
           WHERE tenant_id=$1 AND status IN ('confirmed','registered','waiting','in-operatory')
           ORDER BY updated_at DESC LIMIT 20`,
            [tenantId],
          );
          send('snapshot', { appointments: rows });
        } catch {
          // Não fatal — o cliente continua a receber os eventos seguintes.
        }

        const unsubscribe = await subscribeRealtime(tenantId, (event) => {
          send('change', { table: event.table, op: event.op, id: event.id, status: event.status });
        });

        const heartbeat = setInterval(() => send('heartbeat', { ts: Date.now() }), 15000);

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          // Cancelar a subscrição é obrigatório: sem isto, cada separador que alguém abriu
          // e fechou deixa um subscritor para sempre.
          unsubscribe();
          try {
            controller.close();
          } catch {}
        };

        request.signal.addEventListener('abort', cleanup);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  },
);
