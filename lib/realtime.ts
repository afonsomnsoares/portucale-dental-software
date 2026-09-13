import pg from 'pg';

// ─── O lado servidor do tempo real ──────────────────────────────────────────
// O trigger da migração 051 publica em `portucale_realtime` sempre que uma das tabelas
// que se olha num ecrã muda. Isto subscreve esse canal e distribui pelas ligações SSE
// abertas neste processo.
//
// ─── Uma ligação dedicada, e não o pool ─────────────────────────────────────
// LISTEN é uma propriedade da LIGAÇÃO, não da consulta: uma ligação devolvida ao pool
// deixa de estar à escuta, e a seguinte que sair do pool não está. Fazer LISTEN com
// lib/db.ts's query() subscreveria uma ligação ao acaso e perderia a subscrição no
// COMMIT seguinte — um bug que só aparece com carga, que é o pior tipo.
//
// Por isso: uma ligação própria, fora do pool, partilhada por todas as ligações SSE
// deste processo. Uma por processo, não uma por separador aberto — com uma clínica de
// seis pessoas e três separadores cada, o contrário esgotaria o pool.

export interface RealtimeEvent {
  tenantId: string;
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  status: string | null;
}

type Subscriber = (event: RealtimeEvent) => void;

declare global {
  // eslint-disable-next-line no-var
  var __realtimeSubscribers: Map<string, Set<Subscriber>> | undefined;
  // eslint-disable-next-line no-var
  var __realtimeClient: pg.Client | undefined;
}

// Subscritores agrupados por clínica: um evento só é entregue a quem tem sessão nessa
// clínica. É a segunda camada — a primeira é o payload não levar nada sensível — mas é
// a que impede um separador de uma clínica de saber sequer QUANDO outra tem movimento.
function subscribers() {
  if (!globalThis.__realtimeSubscribers) globalThis.__realtimeSubscribers = new Map();
  return globalThis.__realtimeSubscribers;
}

let connecting: Promise<void> | null = null;

async function ensureListener(): Promise<void> {
  if (globalThis.__realtimeClient) return;
  // Várias ligações SSE a abrir ao mesmo tempo no arranque criariam várias ligações de
  // escuta; a promessa partilhada faz com que a segunda espere pela primeira.
  if (connecting) return connecting;

  connecting = (async () => {
    const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const client = new pg.Client({ connectionString });

    client.on('notification', (msg) => {
      if (msg.channel !== 'portucale_realtime' || !msg.payload) return;
      let event: RealtimeEvent;
      try {
        event = JSON.parse(msg.payload) as RealtimeEvent;
      } catch {
        console.warn('[realtime] payload inválido ignorado:', msg.payload);
        return;
      }
      // Um subscritor que rebente não pode levar os outros atrás — uma ligação SSE que
      // o cliente fechou a meio da entrega é o caso normal, não a exceção.
      for (const fn of subscribers().get(event.tenantId) || []) {
        try {
          fn(event);
        } catch {
          // intentional — a subscriber throwing must not kill the broadcast loop
        }
      }
    });

    client.on('error', (err) => {
      console.error('[realtime] ligação de escuta caiu:', err.message);
      globalThis.__realtimeClient = undefined;
      connecting = null;
      // Sem reconexão automática agressiva: a próxima ligação SSE a abrir volta a
      // chamar ensureListener e reestabelece. Tentar reconectar em ciclo enquanto a
      // base de dados está em baixo só produz ruído no log.
    });

    // ─── O caminho de falha tem de limpar `connecting` ────────────────────────
    // O handler de 'error' acima só dispara em ligações JÁ ESTABELECIDAS. Uma falha
    // AQUI — o connect() ou o LISTEN — não passa por lá, e deixava `connecting` a
    // apontar para uma promessa rejeitada. Como a porta de entrada é
    // `if (connecting) return connecting`, todas as chamadas seguintes recebiam a
    // mesma rejeição: o tempo real ficava morto até alguém reiniciar o processo.
    //
    // O caso concreto é banal — um Postgres que demore um segundo a mais a aceitar
    // ligações no arranque — e o sintoma não é um erro, é a sala de espera a deixar
    // de atualizar sem ninguém reparar porquê.
    try {
      await client.connect();
      await client.query('LISTEN portucale_realtime');
      globalThis.__realtimeClient = client;
    } catch (err) {
      // A ligação pode ter ficado meio-aberta; fechá-la evita deixar sockets pendurados
      // a cada tentativa falhada.
      await client.end().catch(() => {});
      throw err;
    } finally {
      // Em ambos os desfechos: a próxima chamada a ensureListener volta a tentar em vez
      // de receber o resultado desta.
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Subscreve os eventos de uma clínica. Devolve a função de cancelamento — que TEM de
 * ser chamada quando a ligação SSE fecha, senão cada separador que alguém abriu e
 * fechou deixa um subscritor para sempre e o processo cresce até morrer.
 */
export async function subscribeRealtime(tenantId: string, fn: Subscriber): Promise<() => void> {
  await ensureListener();
  const map = subscribers();
  const set = map.get(tenantId) || new Set<Subscriber>();
  set.add(fn);
  map.set(tenantId, set);

  return () => {
    const current = map.get(tenantId);
    if (!current) return;
    current.delete(fn);
    if (!current.size) map.delete(tenantId);
  };
}
