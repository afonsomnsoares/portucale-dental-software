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

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (u: AuthUser) => void;
  logout: () => Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint, callers type their own state
  api: (path: string, opts?: ApiOptions) => Promise<any>;
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
    fetch('/api/auth/csrf', { method: 'GET' }).catch(() => {});
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
    // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint, callers type their own state
    async (path: string, opts: ApiOptions = {}): Promise<any> => {
      const method = String(opts.method || 'GET').toUpperCase();
      const isMutation = !(method === 'GET' || method === 'HEAD' || method === 'OPTIONS');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...opts.headers,
      };
      if (isMutation && !headers['x-csrf-token'] && !headers['X-CSRF-Token']) {
        let csrf = getCookieValue('dent_csrf');
        if (!csrf) {
          await fetch('/api/auth/csrf', { method: 'GET' }).catch(() => {});
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
        let code = null;
        let details = null;
        if (contentType.includes('application/json')) {
          const err = await res.json().catch(() => null);
          code = err?.code || null;
          details = err?.details ?? null;
          message = err?.message || err?.error || message;
        } else {
          const text = await res.text().catch(() => '');
          if (text) message = text;
        }
        const suffix = details ? ` (${typeof details === 'string' ? details : JSON.stringify(details)})` : '';
        throw new Error(
          `${method} /api${path} → ${res.status} ${code ? `${code}: ` : ''}${message || 'Request failed'}${suffix}`,
        );
      }
      return res.json();
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
