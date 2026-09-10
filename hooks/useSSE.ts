'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── O consumidor do canal de tempo real ────────────────────────────────────
// Este hook existia antes de existir alguma coisa que valesse a pena consumir: o
// endpoint mandava um retrato do estado e depois só heartbeats, e nenhuma página o
// chamava. Hoje app/api/sse/route.ts emite eventos `change` vindos do LISTEN/NOTIFY do
// Postgres (migração 051), e por isso o hook passou a distinguir os eventos com nome em
// vez de tratar tudo como `message` — que era o único que sabia ouvir, e justamente o
// único que o servidor nunca envia.

type TimeoutId = ReturnType<typeof setTimeout>;

export interface SSEChange {
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  status: string | null;
}

interface UseSSEOptions {
  url: string;
  /** Chamado a cada mudança relevante. Estável entre renders — ver a nota do ref abaixo. */
  onChange?: (change: SSEChange) => void;
  /** Chamado uma vez por (re)ligação, com o retrato do estado atual. */
  onSnapshot?: (data: unknown) => void;
  /** Só as tabelas que interessam à página. Vazio ou omitido = todas. */
  tables?: string[];
  reconnectInterval?: number;
  heartbeatTimeout?: number;
  /** Permite desligar o canal sem desmontar o componente (ex.: separador escondido). */
  enabled?: boolean;
}

interface UseSSEReturn {
  isConnected: boolean;
  lastChange: SSEChange | null;
  error: string | null;
}

export function useSSE({
  url,
  onChange,
  onSnapshot,
  tables,
  reconnectInterval = 5000,
  heartbeatTimeout = 20000,
  enabled = true,
}: UseSSEOptions): UseSSEReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastChange, setLastChange] = useState<SSEChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const lastHeartbeatRef = useRef<number>(Date.now());
  const reconnectTimeoutRef = useRef<TimeoutId | null>(null);

  // Os callbacks vivem em refs e não nas dependências do connect(): uma página que
  // passe uma arrow function inline (o caso normal) criaria uma função nova a cada
  // render, o que reconstruiria o connect, que fecharia e reabriria a ligação SSE a
  // cada render. O resultado era uma ligação por segundo — a versão anterior deste
  // ficheiro tinha exatamente esse problema latente, escondido por não ter chamadores.
  const onChangeRef = useRef(onChange);
  const onSnapshotRef = useRef(onSnapshot);
  const tablesRef = useRef(tables);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSnapshotRef.current = onSnapshot;
    tablesRef.current = tables;
  });

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }

    try {
      const source = new EventSource(url);
      sourceRef.current = source;

      source.addEventListener('open', () => {
        setIsConnected(true);
        setError(null);
        lastHeartbeatRef.current = Date.now();
      });

      source.addEventListener('snapshot', (e) => {
        lastHeartbeatRef.current = Date.now();
        try {
          onSnapshotRef.current?.(JSON.parse((e as MessageEvent).data));
        } catch {}
      });

      source.addEventListener('change', (e) => {
        lastHeartbeatRef.current = Date.now();
        try {
          const change = JSON.parse((e as MessageEvent).data) as SSEChange;
          const filter = tablesRef.current;
          if (filter?.length && !filter.includes(change.table)) return;
          setLastChange(change);
          onChangeRef.current?.(change);
        } catch {}
      });

      source.addEventListener('heartbeat', () => {
        lastHeartbeatRef.current = Date.now();
      });

      source.addEventListener('error', () => {
        setIsConnected(false);
        if (sourceRef.current?.readyState === EventSource.CLOSED) {
          setError('Ligação de tempo real perdida');
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ligar');
      reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
    }
  }, [url, reconnectInterval]);

  useEffect(() => {
    if (!enabled) {
      sourceRef.current?.close();
      sourceRef.current = null;
      setIsConnected(false);
      return;
    }
    connect();
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect, enabled]);

  // Uma ligação que morre sem disparar 'error' fica aberta e muda — acontece com
  // proxies e com portáteis que adormecem. Sem heartbeat há mais de `heartbeatTimeout`,
  // fecha-se e volta a ligar.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      if (isConnected && Date.now() - lastHeartbeatRef.current > heartbeatTimeout) {
        sourceRef.current?.close();
        setIsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isConnected, connect, reconnectInterval, heartbeatTimeout, enabled]);

  return { isConnected, lastChange, error };
}
