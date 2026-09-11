'use client';
import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import { Badge, Empty, ErrorState, Inp, PageHeader, Sel, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Notification } from '@/lib/types';

const KIND_LABEL: Record<string, string> = {
  appointment_reminder: 'Lembrete de Consulta',
  risk_outreach: 'Confirmação de Risco',
  lifecycle_reactivation: 'Reativação',
  recall_reminder: 'Lembrete de Recall',
  slot_offer: 'Oferta de Vaga',
};

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  queued: {
    label: 'Pendente',
    bg: 'var(--amber-bg, var(--urgency-soon-bg))',
    color: 'var(--amber, var(--urgency-soon))',
  },
  retry: {
    label: 'A repetir',
    bg: 'var(--amber-bg, var(--urgency-soon-bg))',
    color: 'var(--amber, var(--urgency-soon))',
  },
  sent: { label: 'Enviado', bg: 'var(--green-bg, var(--urgency-ok-bg))', color: 'var(--green, var(--urgency-ok))' },
  failed: {
    label: 'Falhou',
    bg: 'var(--red-bg, var(--urgency-critical-bg))',
    color: 'var(--red, var(--urgency-critical))',
  },
};

function fmtDateTime(v: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReceptionistNotificationsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [search, setSearch] = useState('');

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (kindFilter) params.set('kind', kindFilter);
  const qs = params.toString();
  const itemsQuery = useQuery<Notification[]>(`/notifications${qs ? `?${qs}` : ''}`);
  const items = itemsQuery.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((n) => n.patient_name?.toLowerCase().includes(q) || n.to_addr?.toLowerCase().includes(q));
  }, [items, search]);

  return (
    <div>
      <PageHeader
        title="Lembretes"
        sub="Mensagens automáticas enviadas aos pacientes (lembretes, confirmações, reativação, lista de espera)"
      />

      <div className="card p-4 mb-5 flex items-center gap-4 flex-wrap">
        <Sel value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
          <option value="">Todos os estados</option>
          <option value="queued">Pendente</option>
          <option value="retry">A repetir</option>
          <option value="sent">Enviado</option>
          <option value="failed">Falhou</option>
        </Sel>
        <Sel value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ width: 220 }}>
          <option value="">Todos os tipos</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Sel>
        <Inp
          placeholder="Procurar por paciente ou número…"
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {filtered.length} mensagem{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {itemsQuery.error ? (
        <ErrorState
          error={itemsQuery.error}
          onRetry={itemsQuery.refetch}
          message="Não foi possível ler as notificações."
        />
      ) : itemsQuery.loading ? (
        <Spinner />
      ) : !filtered.length ? (
        <Empty message="Sem mensagens para os filtros selecionados." />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="data-th">Paciente</th>
                  <th className="data-th">Tipo</th>
                  <th className="data-th">Destinatário</th>
                  <th className="data-th">Mensagem</th>
                  <th className="data-th">Estado</th>
                  <th className="data-th">Enviado em</th>
                  <th className="data-th">Tentativas</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => {
                  const sm = STATUS_META[n.status] || {
                    label: n.status,
                    bg: 'var(--bg-sunken)',
                    color: 'var(--text-secondary)',
                  };
                  const kind = n.payload?.kind || '';
                  return (
                    <tr key={n.id} style={{ borderBottom: '1px solid var(--bg-page)' }}>
                      <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                        {n.patient_name || n.patient_id?.slice(0, 8) || '—'}
                      </td>
                      <td className="data-td">{KIND_LABEL[kind] || kind || '—'}</td>
                      <td className="data-td">{n.to_addr || '—'}</td>
                      <td
                        className="data-td"
                        style={{ maxWidth: 320, whiteSpace: 'normal' }}
                        title={n.payload?.body || ''}
                      >
                        {n.payload?.body || '—'}
                      </td>
                      <td className="data-td">
                        <Badge label={sm.label} bg={sm.bg} color={sm.color} />
                        {n.status === 'failed' && n.last_error && (
                          <div
                            style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--red, var(--urgency-critical))',
                              marginTop: 4,
                            }}
                          >
                            {n.last_error}
                          </div>
                        )}
                      </td>
                      <td className="data-td">{n.sent_at ? fmtDateTime(n.sent_at) : fmtDateTime(n.created_at)}</td>
                      <td className="data-td">{n.attempts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
