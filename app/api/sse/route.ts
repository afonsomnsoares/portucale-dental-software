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

// ─── Um teto de ligações abertas por utilizador ─────────────────────────────
// O travão de /api/* do proxy conta PEDIDOS por minuto. Uma ligação SSE é um pedido
// que nunca acaba, por isso a janela fecha-se e reabre-se enquanto a ligação continua
// de pé: com o orçamento de 240/min de um utilizador autenticado, cada minuto permite
// abrir mais 240 e nenhuma das anteriores conta para nada.
//
// Cada uma custa um ReadableStream, um setInterval de 15s e um subscritor num Set que
// lib/realtime.ts não limita. Não é preciso má-fé para lá chegar — uma página com um
// bug de reconexão faz o mesmo sozinha, e o sintoma seria o processo a ficar sem
// memória sem nada no log a explicar porquê.
//
// Seis é folgado para o uso real (alguém com o mapa do dia, a agenda e a caixa de
// entrada abertos em separadores diferentes, mais uma reconexão a meio) e baixo o
// suficiente para o teto significar alguma coisa.
const MAX_STREAMS_PER_USER = 6;

declare global {
  // eslint-disable-next-line no-var
  var __sseOpenStreams: Map<string, number> | undefined;
}

// Em globalThis, como o contador de lib/rateLimit.ts e pela mesma razão: sobrevive ao
// hot reload do dev, que de outra forma deixaria contagens órfãs a fechar a porta a
// quem não tem ligação aberta nenhuma.
function openStreams() {
  if (!globalThis.__sseOpenStreams) globalThis.__sseOpenStreams = new Map();
  return globalThis.__sseOpenStreams;
}

// Devolve false quando já não há lugar. O par acquire/release TEM de ser simétrico:
// uma ligação contada e nunca descontada é um lugar perdido para sempre, e ao fim de
// seis o utilizador fica sem tempo real até o processo reiniciar. É por isso que o
// release vive no `cleanup` abaixo, ao lado do clearInterval e do unsubscribe, e é
// guardado pelo mesmo `closed` que impede o cleanup de correr duas vezes.
function acquireStream(userId: string): boolean {
  const streams = openStreams();
  const current = streams.get(userId) || 0;
  if (current >= MAX_STREAMS_PER_USER) return false;
  streams.set(userId, current + 1);
  return true;
}

function releaseStream(userId: string) {
  const streams = openStreams();
  const next = (streams.get(userId) || 1) - 1;
  // Apagar a entrada em vez de a deixar a zero: a chave é o id do utilizador, e uma
  // clínica com rotatividade deixaria entradas a zero para sempre.
  if (next <= 0) streams.delete(userId);
  else streams.set(userId, next);
}

export const GET = withRoute(
  {
    authOnly:
      'Canal de tempo real da própria clínica. Não transporta dados de doente — só ' +
      'tabela, id e estado novo (ver o cabeçalho acima) — por isso não há registo ' +
      'concreto cuja permissão fizesse sentido exigir aqui',
  },
  async ({ request, user, tenantId }) => {
    // Antes de abrir o stream, e não lá dentro: recusar depois de a resposta já ter
    // começado obrigaria o cliente a interpretar um evento de erro em vez de um estado
    // HTTP, e nem todas as implementações de EventSource o fazem.
    if (!acquireStream(user.id)) {
      return Response.json(
        {
          error: 'Demasiadas ligações de tempo real abertas. Feche separadores e tente outra vez.',
          code: 'RATE_LIMIT',
        },
        { status: 429, headers: { 'Retry-After': '30' } },
      );
    }

    const encoder = new TextEncoder();

    // Do acquire acima até ao cleanup lá em baixo o lugar está tomado. Qualquer saída
    // daqui para a frente tem de passar por `cleanup` — é o que o torna simétrico.
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        // Mutáveis, e lidos pelo `cleanup` abaixo em vez de capturados: o cleanup tem
        // de poder correr ANTES de qualquer um dos dois existir — ver o `send`.
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let unsubscribe: (() => void) | null = null;

        // Declaração de função (hoisted) e não `const`: o `send` logo a seguir chama-a,
        // e a primeira chamada a `send` acontece muito antes desta linha no texto.
        function cleanup() {
          if (closed) return;
          closed = true;
          // Primeiro o lugar, depois o resto: se alguma das chamadas abaixo lançar, o
          // contador já foi acertado e a pessoa não fica sem tempo real por causa de
          // uma falha a fechar um controller que já estava fechado.
          releaseStream(user.id);
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
          // Cancelar a subscrição é obrigatório: sem isto, cada separador que alguém abriu
          // e fechou deixa um subscritor para sempre.
          unsubscribe?.();
          unsubscribe = null;
          try {
            controller.close();
          } catch {
            // intentional — controller may already be closed on abort
          }
        }

        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // O cliente desligou entre a verificação e a escrita. Não é um erro — mas é
            // o FIM desta ligação, e tem de passar pelo cleanup como qualquer outro fim.
            // Marcar `closed` e mais nada (o que aqui estava) deixava o heartbeat a
            // disparar de 15 em 15 segundos, o subscritor registado em lib/realtime.ts
            // e — desde que há teto — o lugar ocupado até o processo reiniciar.
            cleanup();
          }
        };

        // Registado ANTES do primeiro await: um cliente que desista durante a consulta
        // do snapshot emitiria o 'abort' antes de haver quem o ouvisse, e a ligação
        // ficava com heartbeat e subscritor sem nunca ninguém a fechar.
        if (request.signal.aborted) {
          cleanup();
          return;
        }
        request.signal.addEventListener('abort', cleanup);

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
          // intentional — non-fatal; client still receives subsequent events
        }

        // Desistiu durante o snapshot: não vale a pena subscrever nada.
        if (closed) return;

        const unsub = await subscribeRealtime(tenantId, (event) => {
          send('change', { table: event.table, op: event.op, id: event.id, status: event.status });
        });
        // Desistiu durante o await da subscrição: o cleanup já correu e já não vê este
        // `unsub`, por isso é aqui que ele tem de ser desfeito. Sem esta linha, a janela
        // entre o `closed` e a atribuição deixava um subscritor órfão.
        if (closed) {
          unsub();
          return;
        }
        unsubscribe = unsub;

        heartbeat = setInterval(() => send('heartbeat', { ts: Date.now() }), 15000);
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
