'use client';
import { useState } from 'react';
import { Badge, DataTable, Empty, ErrorState, GhostBtn, Inp, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { AuditLogEntry } from '@/lib/types';

// Três páginas do menu (Registos de Acesso, Eventos de Segurança, Eventos de Sistema)
// leem a MESMA tabela — audit_log — com recortes diferentes. Escrever três componentes
// quase iguais era garantir que divergiam à terceira alteração, por isso o recorte é um
// parâmetro e o componente é um só.
//
// O filtro é do lado do cliente porque /api/audit filtra por uma ação de cada vez e
// estes recortes são conjuntos de ações; pedir uma vez e recortar aqui poupa três idas
// ao servidor por página. O limite de 200 linhas da rota vale à mesma.
export const ACTION_META: Record<string, { bg: string; color: string }> = {
  AUTH: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  AUTH_FAIL: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  FORBIDDEN: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  RATE_LIMIT: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  CREATE: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  UPDATE: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  DELETE: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  PROVISION: { bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
};

export default function AuditFeed({
  title,
  sub,
  actions,
  emptyMessage,
  footnote,
}: {
  title: string;
  sub?: string;
  /** Ações a mostrar. Vazio = todas. */
  actions?: string[];
  emptyMessage?: string;
  footnote?: string;
}) {
  const rowsQuery = useQuery<AuditLogEntry[]>('/audit');
  const rows = rowsQuery.data ?? null;
  const [q, setQ] = useState('');

  const filtered = (rows || [])
    .filter((r) => !actions?.length || actions.includes(r.action))
    .filter((r) => {
      if (!q) return true;
      const needle = q.toLowerCase();
      return (
        r.user_name?.toLowerCase().includes(needle) ||
        r.resource?.toLowerCase().includes(needle) ||
        r.clinic?.toLowerCase().includes(needle)
      );
    });

  return (
    <div>
      <PageHeader title={title} sub={sub} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Inp
          placeholder="Filtrar por pessoa, recurso ou clínica…"
          value={q}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
        />
        {q && <GhostBtn onClick={() => setQ('')}>Limpar</GhostBtn>}
      </div>

      {rowsQuery.error ? (
        <ErrorState error={rowsQuery.error} onRetry={rowsQuery.refetch} message="Não foi possível ler o registo." />
      ) : !rows ? (
        <Spinner />
      ) : !filtered.length ? (
        <Empty message={emptyMessage || 'Sem registos'} />
      ) : (
        <DataTable
          cols={['Ação', 'Quem', 'Papel', 'Clínica', 'Recurso', 'Quando', 'Hash']}
          rows={filtered.map((r) => (
            <tr key={String(r.id)}>
              <td>
                <Badge label={r.action} {...(ACTION_META[r.action] || ACTION_META.UPDATE)} />
              </td>
              <td>{r.user_name}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{r.user_role}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{r.clinic}</td>
              <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.resource}
              </td>
              <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {new Date(r.created_at).toLocaleString('pt-PT')}
              </td>
              <td
                style={{
                  fontFamily: '"JetBrains Mono",monospace',
                  fontSize: 'var(--text-2xs)',
                  color: 'var(--text-muted)',
                }}
              >
                {r.hash}
              </td>
            </tr>
          ))}
        />
      )}

      {footnote && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 16 }}>
          {footnote}
        </p>
      )}
    </div>
  );
}
