'use client';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  name: string;
  role: string;
  clinic?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantCity?: string | null;
  operatories?: number;
  // Ações efetivas, vindas de /api/auth/me e /api/auth/login (lib/permissions.ts,
  // effectiveActions). A Sidebar filtra o menu por elas.
  permissions?: string[];
  // Clínica em que o super_admin entrou (POST /api/tenants/enter). Ausente para todos os
  // outros papéis e para o super_admin fora de qualquer clínica.
  actingTenantId?: string | null;
  actingTenantName?: string | null;
}

interface StatusMeta {
  label: string;
  bg: string;
  color: string;
}

export interface AppSettings {
  TANOMD_CODES: Array<{ code: string; desc: string; category: string; fee: number }>;
  STATUS_META: Record<string, StatusMeta>;
  STATUS_TRANSITIONS: Record<string, string[]>;
}

export interface ApiOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  cache?: RequestCache;
  [key: string]: unknown;
}

/**
 * O erro que `api()` lança. Existe para que quem apanha possa decidir pelo CÓDIGO em
 * vez de pelo texto: a página de login chegava a fazer `message.includes('401')`, o que
 * só funcionava porque o estado ia embutido na mensagem — e deixava de funcionar assim
 * que alguém melhorasse a frase.
 *
 * A `message` passa a ser o que o servidor diz, sem o prefixo `GET /api/x → 401` que
 * antes ia à frente. Cinquenta ecrãs mostram `err.message` diretamente ao utilizador, e
 * nenhum deles ganhava alguma coisa com o método e o caminho lá dentro; o detalhe
 * técnico vive nos campos abaixo e na consola.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;
  readonly path: string;
  readonly method: string;

  constructor(init: {
    status: number;
    code: string | null;
    details: unknown;
    path: string;
    method: string;
    message: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.path = init.path;
    this.method = init.method;
  }
}

// Caminhos onde um 401 é uma resposta normal e não uma sessão que caiu: o login com a
// password errada, e o /me de quem ainda não entrou. Terminar a sessão aqui seria
// reagir a um erro que já está a ser tratado no sítio certo.
const AUTH_PATHS = ['/auth/login', '/auth/me', '/auth/csrf'];

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (u: AuthUser) => void;
  logout: () => Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — callers provide their own return type
  api: <T = any>(path: string, opts?: ApiOptions) => Promise<T>;
  settings: AppSettings | null;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = String(document.cookie || '')
    .split(';')
    .map((s) => s.trim());
  for (const p of parts) {
    if (!p) continue;
    const idx = p.indexOf('=');
    const k = idx >= 0 ? p.slice(0, idx) : p;
    if (k !== name) continue;
    const v = idx >= 0 ? p.slice(idx + 1) : '';
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    fetch('/api/auth/csrf', { method: 'GET' }).catch(() => {}); // intentional — warm-up; CSRF cookie arrives either way
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { method: 'GET' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUser(data.user || null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const api = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: response shape varies per endpoint, callers type their own state
    async <T = any>(path: string, opts: ApiOptions = {}): Promise<T> => {
      const method = String(opts.method || 'GET').toUpperCase();
      const isMutation = !(method === 'GET' || method === 'HEAD' || method === 'OPTIONS');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...opts.headers,
      };
      if (isMutation && !headers['x-csrf-token'] && !headers['X-CSRF-Token']) {
        let csrf = getCookieValue('dent_csrf');
        if (!csrf) {
          await fetch('/api/auth/csrf', { method: 'GET' }).catch(() => {}); // intentional — retry after missing cookie
          csrf = getCookieValue('dent_csrf');
        }
        if (csrf) headers['x-csrf-token'] = csrf;
      }
      const res = await fetch(`/api${path}`, {
        ...opts,
        credentials: 'same-origin',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        const contentType = res.headers.get('content-type') || '';
        let message = res.statusText;
        let code: string | null = null;
        let details: unknown = null;
        if (contentType.includes('application/json')) {
          const err = await res.json().catch(() => null); // intentional — response may not be JSON
          code = err?.code || null;
          details = err?.details ?? null;
          message = err?.message || err?.error || message;
        } else {
          const text = await res.text().catch(() => ''); // intentional — body may be unreadable
          if (text) message = text;
        }

        // ─── A sessão pode ter morrido a meio ────────────────────────────────
        // lib/permissions.ts's revalidateSession recusa, a cada pedido, um token cuja
        // conta foi desativada, despromovida, movida de clínica ou cuja password mudou.
        // O servidor fazia a sua parte e o cliente não tinha contraparte nenhuma: o
        // estado `user` continuava preenchido, a Sidebar continuava a desenhar o menu, e
        // a pessoa via o painel encher-se de erros sem perceber que tinha sido desligada.
        //
        // Limpar o utilizador chega para a expulsar: app/dashboard/layout.tsx já tem
        // `if (!loading && !user) router.replace('/')`. Reaproveitar esse caminho em vez
        // de navegar daqui mantém o provider fora de assuntos de rotas — e faz com que
        // exista um só sítio a decidir para onde vai quem não tem sessão.
        if (res.status === 401 && !AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}?`))) {
          setUser(null);
          setSettings(null);
        }

        // O detalhe técnico deixa de ir na mensagem que o utilizador lê, mas não se
        // perde — quem estiver a depurar precisa dele.
        console.error(`[api] ${method} /api${path} → ${res.status}`, { code, details, message });

        throw new ApiError({
          status: res.status,
          code,
          details,
          path,
          method,
          message: message || 'Não foi possível concluir o pedido.',
        });
      }
      // 204 e afins não trazem corpo; res.json() rebentaria sobre um corpo vazio.
      if (res.status === 204 || res.headers.get('content-length') === '0') return null as T;
      return res.json() as Promise<T>;
    },
    [],
  );

  useEffect(() => {
    if (user && !settings) {
      api('/settings').then(setSettings).catch(console.error);
    }
  }, [user, settings, api]);

  const login = useCallback((u: AuthUser) => {
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
    setUser(null);
    setSettings(null);
  }, [api]);

  return <AuthCtx.Provider value={{ user, loading, login, logout, api, settings }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
