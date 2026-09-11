// A cache de leituras do cliente — lógica pura, sem React e sem fetch, testável
// como lib/forecastCalc.ts e companhia.
//
// ─── Porque é que isto existe ───────────────────────────────────────────────
// Setenta e seis componentes escreviam a mesma dança à mão: `useState` para os
// dados, `useState` para o `loading`, um `useEffect` que chama `api()` e um
// `.catch(() => [])` no fim. Nenhuma das cópias deduplicava, nenhuma revalidava
// e nenhuma sabia dizer se uma lista vazia era mesmo vazia ou um servidor em
// baixo. É a mesma classe de repetição que o lib/route.ts foi escrito para
// absorver do lado do servidor — com a mesma consequência: quando o preâmbulo
// se copia, a omissão não se vê.
//
// ─── Porque é que a cache é separada do hook ────────────────────────────────
// O que aqui está — quando é que um valor está velho, quem partilha o pedido em
// voo, o que é que uma invalidação apaga — são regras, e regras testam-se sem
// infraestrutura. O hooks/useQuery.ts fica com o que é mesmo de React: subscrever,
// re-renderizar e desistir a tempo. Foi o que permitiu que isto tivesse testes
// num projeto sem renderizador de componentes instalado.

export type ReadStatus = 'fresh' | 'stale' | 'miss';

export interface ReadResult {
  status: ReadStatus;
  /** Só definido quando o status é 'fresh' ou 'stale'. */
  data?: unknown;
}

interface Entry {
  data: unknown;
  /** Momento em que os dados foram escritos (ms, epoch). */
  ts: number;
}

export interface QueryCache {
  read(key: string, staleMs: number, now?: number): ReadResult;
  write(key: string, data: unknown, now?: number): void;
  /**
   * Partilha um pedido em voo entre chamadores simultâneos da mesma chave.
   *
   * Dois componentes montados no mesmo tick a pedir `/patients` faziam dois
   * pedidos; passam a fazer um. É a diferença mais visível num ecrã com vários
   * painéis — a Visão Geral pedia `/dashboard/stats` uma vez por cartão.
   */
  dedupe<T>(key: string, run: () => Promise<T>): Promise<T>;
  /**
   * Apaga tudo o que começa por `prefix` e avisa quem estiver a ouvir.
   *
   * Prefixo e não chave exata de propósito: quem grava um doente quer invalidar
   * `/patients`, `/patients?q=ana` e `/patients/123` de uma vez, e obrigar cada
   * chamador a enumerar as variantes seria garantir que uma fica esquecida.
   * Devolve as chaves afetadas — é o que os testes verificam.
   */
  invalidate(prefix: string): string[];
  /** Esquece tudo. O logout chama-o: a cache tem dados de uma sessão que acabou. */
  clear(): void;
  subscribe(key: string, listener: () => void): () => void;
  /** Quantas entradas guardadas. Só para testes e diagnóstico. */
  size(): number;
}

export function createQueryCache(): QueryCache {
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();
  const listeners = new Map<string, Set<() => void>>();

  function notify(prefix: string) {
    for (const [key, set] of listeners) {
      if (key === prefix || key.startsWith(prefix)) {
        for (const listener of set) listener();
      }
    }
  }

  return {
    read(key, staleMs, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry) return { status: 'miss' };
      // `stale` devolve os dados à mesma: mostrar o valor de há um minuto
      // enquanto o novo vem a caminho é melhor do que piscar um spinner sobre
      // uma tabela que a pessoa estava a ler.
      return { status: now - entry.ts <= staleMs ? 'fresh' : 'stale', data: entry.data };
    },

    write(key, data, now = Date.now()) {
      entries.set(key, { data, ts: now });
    },

    dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key) as Promise<T> | undefined;
      if (existing) return existing;
      const promise = run().finally(() => {
        // Sai do mapa mesmo em caso de erro: uma chave que falhou tem de poder
        // ser tentada outra vez, e não ficar presa a uma promessa já rejeitada.
        inflight.delete(key);
      });
      inflight.set(key, promise);
      return promise;
    },

    invalidate(prefix) {
      const afetadas: string[] = [];
      for (const key of entries.keys()) {
        if (key === prefix || key.startsWith(prefix)) afetadas.push(key);
      }
      for (const key of afetadas) entries.delete(key);
      notify(prefix);
      return afetadas;
    },

    clear() {
      entries.clear();
      inflight.clear();
    },

    subscribe(key, listener) {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },

    size() {
      return entries.size;
    },
  };
}

/**
 * Quanto tempo um valor conta como fresco, por omissão.
 *
 * Trinta segundos é o intervalo em que navegar entre dois ecrãs e voltar ao
 * primeiro não volta a pedir nada — que é o movimento que a recepção faz o dia
 * inteiro. Acima disto arriscava-se mostrar uma agenda desatualizada; abaixo,
 * a cache deixava de servir para o que foi feita.
 *
 * Não é a rede de segurança da atualidade dos dados: essa é o SSE
 * (lib/realtime.ts), que invalida à medida que as coisas acontecem.
 */
export const DEFAULT_STALE_MS = 30_000;

/** A instância que a aplicação usa. Os testes criam a sua com createQueryCache(). */
export const queryCache = createQueryCache();
