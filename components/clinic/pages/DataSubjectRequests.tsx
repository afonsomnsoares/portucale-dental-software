'use client';
// ─── Proteção de dados ──────────────────────────────────────────────────────
// Os pedidos do titular (RGPD, artigos 15.º a 21.º). O motor existia — rotas de listagem,
// de criação e de execução, mais lib/dataSubject.ts com a exportação e o apagamento — e
// não havia página nenhuma. Um direito que a lei dá ao doente e que o software só
// conseguia servir por linha de comandos não estava, na prática, a ser servido.
//
// ─── Duas decisões de desenho ───────────────────────────────────────────────
// 1. A ordem vem do servidor e não se mexe: pendentes primeiro, mais antigos no topo. É
//    a ordem em que o prazo legal aperta, e deixar ordenar por outra coisa convidaria a
//    tratar o mais fácil em vez do mais urgente.
// 2. O apagamento tem confirmação por escrito, e a lista de tipos diz o que cada um faz.
//    'erasure' é irreversível e não há como o desfazer — um clique não chega.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, PageHeader, Sel, Spinner } from '@/components/ui';

const TIPO_LABEL: Record<string, string> = {
  access: 'Acesso aos dados',
  rectification: 'Retificação',
  erasure: 'Apagamento',
  portability: 'Portabilidade',
  restriction: 'Limitação do tratamento',
  objection: 'Oposição',
};

const ESTADO: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: 'Pendente', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  in_progress: { label: 'Em curso', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  completed: { label: 'Concluído', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  rejected: { label: 'Recusado', bg: 'var(--bg-sunken)', color: 'var(--text-muted)' },
};

// Só estes dois são executáveis pelo sistema. Os outros quatro são trabalho humano —
// corrigir uma morada, limitar um tratamento — e fecham-se à mão com uma nota.
const EXECUTAVEIS = new Set(['access', 'portability', 'erasure']);

interface Pedido {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  request_type: string;
  status: string;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
}

function data(v: string | null) {
  return v ? new Date(v).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

// Dias desde a entrada. O RGPD dá um mês para responder; passado esse prazo o atraso
// deixa de ser uma questão de organização e passa a ser de conformidade.
function diasEmAberto(p: Pedido) {
  if (p.status === 'completed' || p.status === 'rejected') return null;
  return Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000);
}

export default function DataSubjectRequests() {
  const { api } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [filtro, setFiltro] = useState('');
  const [aCarregar, setACarregar] = useState(true);
  const [erro, setErro] = useState('');
  const [aExecutar, setAExecutar] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setACarregar(true);
    try {
      setPedidos((await api(`/data-subject-requests${filtro ? `?status=${filtro}` : ''}`)) || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os pedidos.');
    } finally {
      setACarregar(false);
    }
  }, [api, filtro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const executar = useCallback(
    async (p: Pedido) => {
      const irreversivel = p.request_type === 'erasure';
      const aviso = irreversivel
        ? `Apagar definitivamente os dados de ${p.patient_name || 'este doente'}?\n\nIsto é irreversível e não há como o desfazer. Os registos clínicos que a lei obriga a conservar são mantidos anonimizados.`
        : `Preparar a exportação dos dados de ${p.patient_name || 'este doente'}?`;
      if (!window.confirm(aviso)) return;
      setAExecutar(p.id);
      setErro('');
      try {
        await api(`/data-subject-requests/${p.id}/fulfil`, { method: 'POST' });
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível executar o pedido.');
      } finally {
        setAExecutar(null);
      }
    },
    [api, carregar],
  );

  return (
    <div>
      <PageHeader
        title="Proteção de Dados"
        sub="Pedidos do titular dos dados. Ordenados por prazo: os pendentes mais antigos primeiro."
      >
        <Sel value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 160 }}>
          <option value="">Todos</option>
          <option value="pending">Pendentes</option>
          <option value="in_progress">Em curso</option>
          <option value="completed">Concluídos</option>
          <option value="rejected">Recusados</option>
        </Sel>
      </PageHeader>

      {erro && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {erro}
        </div>
      )}

      {aCarregar ? (
        <Spinner />
      ) : pedidos.length === 0 ? (
        <Empty message="Nenhum pedido. Quando um doente exercer um direito sobre os seus dados, registe-o aqui." />
      ) : (
        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--bg-surface)',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                {['Doente', 'Direito exercido', 'Entrada', 'Estado', ''].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '9px 14px',
                      fontSize: 10.5,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      fontWeight: 500,
                      borderBottom: '1px solid var(--border-strong)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => {
                const e = ESTADO[p.status] || ESTADO.pending;
                const dias = diasEmAberto(p);
                const atrasado = dias !== null && dias > 30;
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600 }}>
                      {p.patient_name || 'Doente removido'}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13 }}>
                      {TIPO_LABEL[p.request_type] || p.request_type}
                      {p.notes && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.notes}</div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                      {data(p.created_at)}
                      {dias !== null && (
                        <div
                          style={{ fontSize: 11, color: atrasado ? 'var(--urgency-critical)' : 'var(--text-muted)' }}
                        >
                          {atrasado ? `${dias} dias — prazo de um mês ultrapassado` : `há ${dias} dias`}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                          background: e.bg,
                          color: e.color,
                        }}
                      >
                        {e.label}
                      </span>
                      {p.resolved_by_name && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {p.resolved_by_name} · {data(p.resolved_at)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {p.status !== 'completed' && p.status !== 'rejected' && EXECUTAVEIS.has(p.request_type) && (
                        <button
                          type="button"
                          onClick={() => executar(p)}
                          disabled={aExecutar === p.id}
                          style={{
                            fontSize: 12,
                            padding: '4px 11px',
                            borderRadius: 'var(--radius-control)',
                            border: `1px solid ${p.request_type === 'erasure' ? 'var(--urgency-critical)' : 'var(--border-strong)'}`,
                            color: p.request_type === 'erasure' ? 'var(--urgency-critical)' : 'var(--text-primary)',
                            background: 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          {aExecutar === p.id
                            ? 'A executar…'
                            : p.request_type === 'erasure'
                              ? 'Apagar dados'
                              : 'Exportar dados'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
