'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type TimeoutId = ReturnType<typeof setTimeout>;

interface SSEEvent {
  event: string;
  data: unknown;
}

interface UseSSEOptions {
  url: string;
  onEvent?: (event: SSEEvent) => void;
  reconnectInterval?: number;
  heartbeatTimeout?: number;
}

interface UseSSEReturn {
  isConnected: boolean;
  lastEvent: SSEEvent | null;
  error: string | null;
}


export function useSSE({
  url,
  onEvent,
  reconnectInterval = 5000,
  heartbeatTimeout = 20000,
}: UseSSEOptions): UseSSEReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<any>(null);
  const lastHeartbeatRef = useRef<number>(Date.now());
  const reconnectTimeoutRef = useRef<TimeoutId | null>(null);

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

      source.addEventListener('message', (e) => {
        lastHeartbeatRef.current = Date.now();
        try {
          const data = JSON.parse(e.data);
          const event: SSEEvent = { event: 'message', data };
          setLastEvent(event);
          onEvent?.(event);
        } catch {}
      });

      source.addEventListener('heartbeat', () => {
        lastHeartbeatRef.current = Date.now();
      });

      source.addEventListener('error', () => {
        setIsConnected(false);
        if (sourceRef.current?.readyState === EventSource.CLOSED) {
          setError('SSE connection closed');
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
      reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
    }
  }, [url, onEvent, reconnectInterval]);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // Detect stale connections (no heartbeat within timeout)
  useEffect(() => {
    const interval = setInterval(() => {
      if (isConnected && Date.now() - lastHeartbeatRef.current > heartbeatTimeout) {
        sourceRef.current?.close();
        setIsConnected(false);
        reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isConnected, connect, reconnectInterval, heartbeatTimeout]);

  return { isConnected, lastEvent, error };
}
