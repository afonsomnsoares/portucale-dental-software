'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/providers';
import { DEFAULT_STALE_MS, queryCache } from '@/lib/queryCache';

// ─── Uma leitura de /api, com os três estados que ela tem mesmo ─────────────
// O que estava escrito à mão em setenta e seis componentes tinha dois estados:
// «a carregar» e «tenho dados». O terceiro — «não consegui» — era engolido por
// um `.catch(() => [])`, e a partir daí uma lista vazia e um servidor em baixo
// ficavam indistinguíveis. Para quem usa, e para quem depura.
//
// Este hook devolve os três, e é por isso que existe. A deduplicação, a cache e
// o cancelamento vêm por acréscimo — são bons, mas não são o motivo.
//
// ─── O que ele NÃO faz ──────────────────────────────────────────────────────
// Não serve para escritas. Um POST tem confirmação, tem botão preso enquanto
// corre e tem consequências que se veem noutros ecrãs; continua a chamar-se
// `api()` diretamente e a invalidar o que mudou (ver `useInvalidate`). Uma
// leitura é idempotente e repetível, uma escrita não — misturar as duas num só
// hook é como o lib/db.ts deixaria de distinguir queryRead de query.

export interface QueryResult<T> {
  /** `undefined` até haver resposta. Nunca é um valor inventado para tapar um erro. */
  data: T | undefined;
  /** O ApiError do lib/providers, com status e code. Null quando correu bem. */
  error: Error | null;
  /** Só true quando não há nada para mostrar. Uma revalidação por cima de dados
   *  em cache não acende o spinner: piscar uma tabela que a pessoa está a ler é
   *  pior do que mostrá-la com um segundo de atraso. */
  loading: boolean;
  /** True enquanto corre um pedido, haja ou não dados. Para um indicador discreto. */
  validating: boolean;
  /** Volta a pedir, ignorando a cache. */
  refetch: () => void;
}

export interface QueryOptions {
  /** A false, o hook não pede nada e fica em espera — para o que depende de
   *  um id que ainda não existe, ou de um separador que ainda não abriu. */
  enabled?: boolean;
  /** Quanto tempo os dados contam como frescos. Ver DEFAULT_STALE_MS. */
  staleMs?: number;
}

/**
 * Lê `path` de /api e mantém-no.
 *
 * `path` a null é o mesmo que `enabled: false` — poupa o `enabled` explícito no
 * caso comum de o caminho depender de um id que ainda não se sabe.
 */
export function useQuery<T = unknown>(path: string | null, options: QueryOptions = {}): QueryResult<T> {
  const { api } = useAuth();
  const { enabled = true, staleMs = DEFAULT_STALE_MS } = options;
  const active = path !== null && enabled;

  const [, forceRender] = useState(0);
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; validating: boolean }>({
    data: undefined,
    error: null,
    validating: false,
  });

  // Identifica o pedido em curso deste hook. Uma resposta que chegue quando já
  // não é a que interessa — porque o caminho mudou, ou porque o componente foi
  // desmontado — é descartada em vez de escrever num estado que já não existe.
  //
  // ─── Porquê isto e não um AbortController ─────────────────────────────────
  // Porque o pedido é PARTILHADO: dois componentes a pedir a mesma coisa no
  // mesmo tick recebem a mesma promessa, e abortá-la porque um deles desmontou
  // deixaria o outro sem dados. O contador resolve as duas coisas que fazem
  // mal (escrever depois de desmontar, e uma resposta lenta a sobrepor-se a uma
  // rápida); o que se perde é poupar largura de banda de um pedido que já
  // ninguém quer, e essa é a troca certa das duas.
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (key: string, { force }: { force: boolean }) => {
      const id = ++requestId.current;
      const cached = force ? { status: 'miss' as const, data: undefined } : queryCache.read(key, staleMs);

      if (cached.status === 'fresh') {
        setState({ data: cached.data as T, error: null, validating: false });
        return;
      }

      // Com dados velhos, mostra-os já e revalida por baixo.
      setState((prev) => ({
        data: cached.status === 'stale' ? (cached.data as T) : prev.data,
        error: null,
        validating: true,
      }));

      try {
        const data = await queryCache.dedupe(key, () => api<T>(key));
        if (!mounted.current || id !== requestId.current) return;
        queryCache.write(key, data);
        setState({ data, error: null, validating: false });
      } catch (e) {
        if (!mounted.current || id !== requestId.current) return;
        // O erro NÃO se guarda na cache: um 500 passageiro não pode ficar a
        // responder por trinta segundos a quem entrar no ecrã a seguir.
        setState((prev) => ({
          data: prev.data,
          error: e instanceof Error ? e : new Error(String(e)),
          validating: false,
        }));
      }
    },
    [api, staleMs],
  );

  useEffect(() => {
    if (!active || path === null) {
      setState({ data: undefined, error: null, validating: false });
      return;
    }
    void run(path, { force: false });
  }, [path, active, run]);

  // Uma invalidação vinda de outro sítio (uma escrita, o SSE) faz este hook
  // voltar a pedir — é o que torna a cache segura: quem escreve não precisa de
  // saber que ecrãs estão abertos.
  useEffect(() => {
    if (!active || path === null) return;
    return queryCache.subscribe(path, () => {
      void run(path, { force: true });
      forceRender((n) => n + 1);
    });
  }, [path, active, run]);

  const refetch = useCallback(() => {
    if (path !== null) void run(path, { force: true });
  }, [path, run]);

  return {
    data: state.data,
    error: state.error,
    loading: state.validating && state.data === undefined,
    validating: state.validating,
    refetch,
  };
}

/**
 * Devolve a função que apaga da cache tudo o que começa por um prefixo.
 *
 * É o que uma escrita chama depois de correr bem. Prefixo e não caminho exato:
 * quem grava um doente invalida `/patients` e apanha `/patients?q=ana` e
 * `/patients/123` de uma vez — enumerar as variantes à mão seria garantir que
 * uma fica esquecida.
 */
export function useInvalidate() {
  return useCallback((...prefixes: string[]) => {
    for (const prefix of prefixes) queryCache.invalidate(prefix);
  }, []);
}
