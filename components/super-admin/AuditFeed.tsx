'use client';
import { useState } from 'react';
import { Badge, DataTable, Empty, ErrorState, GhostBtn, Inp, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { AuditLogEntry } from '@/lib/types';

// Um recorte do audit_log por conjunto de ações. Era a base de três páginas do menu
// (Registos de Acesso, Eventos de Segurança, Eventos de Sistema) e hoje é a de dois
// separadores de Auditoria — ver components/super-admin/pages/Auditoria.tsx, que explica
// porque é que quatro entradas sobre a mesma tabela eram três a mais.
//
// É um painel e não uma página: quem o mostra é que tem o cabeçalho e a nota de rodapé,
// porque um separador dentro de um ecrã não pode trazer um <h1> atrás de si.
//
// O filtro é do lado do cliente porque /api/audit filtra por uma ação de cada vez e
// estes recortes são conjuntos de ações; pedir uma vez e recortar aqui poupa três idas
// ao servidor por página. O limite de 200 linhas da rota vale à mesma.
const ACTION_META: Record<string, { bg: string; color: string }> = {
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
  actions,
  emptyMessage,
}: {
  /** Ações a mostrar. Vazio = todas. */
  actions?: string[];
  emptyMessage?: string;
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
    </div>
  );
}
