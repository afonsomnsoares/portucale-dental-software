'use client';
// ─── Cancelamentos ──────────────────────────────────────────────────────────
// A tabela existe desde a migração 004 e alimenta o risco de falta e a previsão. Nunca
// teve rota nem ecrã: a clínica pagava o custo de os registar e nunca os podia ver.
//
// ─── A antecedência é a coluna que importa ──────────────────────────────────
// Um cancelamento com uma semana de aviso é uma vaga que se preenche; um com duas horas
// é receita perdida. São a mesma linha na base de dados e coisas completamente
// diferentes na clínica — por isso a antecedência é calculada e destacada, e a lista
// deixa de ser um registo para passar a ser um diagnóstico.
//
// A segunda coluna que importa é «voltou?». Sem ela isto era um cemitério, e um
// cemitério não é acionável.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, Inp, PageHeader, Spinner } from '@/components/ui';

interface Cancelamento {
  id: string;
  appt_date: string;
  start_time: string;
  duration: number;
  type: string | null;
  patient_id: string | null;
  patient_name: string | null;
  dentist_name: string | null;
  cancelled_by_name: string | null;
  created_at: string;
  rebooked: boolean;
}

// Horas entre o cancelamento e a hora a que a consulta seria. Negativo significa que o
// registo entrou depois da hora — acontece quando alguém fecha o dia à posteriori.
function antecedenciaHoras(c: Cancelamento) {
  const consulta = new Date(`${String(c.appt_date).slice(0, 10)}T${String(c.start_time).slice(0, 5)}:00`).getTime();
  const aviso = new Date(c.created_at).getTime();
  if (!Number.isFinite(consulta) || !Number.isFinite(aviso)) return null;
  return (consulta - aviso) / 3600000;
}

// Três faixas, e a fronteira das 24h não é arbitrária: é o horizonte em que a lista de
// espera ainda consegue oferecer a vaga a alguém que se organize para lá ir.
function faixa(h: number | null) {
  if (h === null) return { label: '—', color: 'var(--text-muted)' };
  if (h < 24) return { label: `${Math.max(0, Math.round(h))}h antes`, color: 'var(--urgency-critical)' };
  if (h < 72) return { label: `${Math.round(h / 24)} dias antes`, color: 'var(--urgency-soon)' };
  return { label: `${Math.round(h / 24)} dias antes`, color: 'var(--urgency-ok)' };
}

function dataHora(c: Cancelamento) {
  const d = new Date(`${String(c.appt_date).slice(0, 10)}T00:00:00`);
  return `${d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })} · ${String(c.start_time).slice(0, 5)}`;
}

export default function Cancellations() {
  const { api } = useAuth();
  const [rows, setRows] = useState<Cancelamento[]>([]);
  const [desde, setDesde] = useState(() => new Date(Date.now() - 89 * 86400000).toLocaleDateString('en-CA'));
  const [aCarregar, setACarregar] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setACarregar(true);
    try {
      setRows((await api(`/analytics/cancellations?from=${desde}`)) || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os cancelamentos.');
    } finally {
      setACarregar(false);
    }
  }, [api, desde]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const resumo = useMemo(() => {
    const curtos = rows.filter((c) => {
      const h = antecedenciaHoras(c);
      return h !== null && h < 24;
    }).length;
    const voltaram = rows.filter((c) => c.rebooked).length;
    const minutos = rows.reduce((a, c) => a + Number(c.duration || 0), 0);
    return { curtos, voltaram, horas: Math.round(minutos / 60) };
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Cancelamentos"
        sub="Quem cancelou, com quanta antecedência, e se voltou a marcar. A antecedência é o que separa uma vaga preenchível de receita perdida."
      >
        <Inp
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          style={{ width: 165 }}
          aria-label="Desde"
        />
      </PageHeader>

      {erro && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 12,
            fontSize: 'var(--text-sm)',
          }}
        >
          {erro}
        </div>
      )}

      {aCarregar ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty message="Nenhum cancelamento no período. É uma boa notícia." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { n: rows.length, t: 'cancelamentos' },
              { n: resumo.curtos, t: 'com menos de 24h de aviso', cor: 'var(--urgency-critical)' },
              { n: resumo.voltaram, t: 'voltaram a marcar', cor: 'var(--urgency-ok)' },
              { n: resumo.horas, t: 'horas de cadeira libertadas' },
            ].map((m) => (
              <div key={m.t}>
                <div
                  style={{
                    fontSize: 'var(--text-xl)',
                    fontWeight: 'var(--weight-bold)',
                    color: m.cor || 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {m.n}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{m.t}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-card)',
              background: 'var(--bg-surface)',
              overflowX: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  {['Doente', 'Consulta', 'Antecedência', 'Dentista', 'Voltou?'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '9px 14px',
                        fontSize: 'var(--text-2xs)',
                        letterSpacing: 'var(--text-2xs-tracking)',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        fontWeight: 'var(--weight-medium)',
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
                {rows.map((c) => {
                  const f = faixa(antecedenciaHoras(c));
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td
                        style={{
                          padding: '10px 14px',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 'var(--weight-semibold)',
                        }}
                      >
                        {c.patient_name || 'Doente removido'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                        {dataHora(c)}
                        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                          {c.type || 'Consulta'} · {c.duration} min
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '10px 14px',
                          fontSize: 'var(--text-xs)',
                          color: f.color,
                          fontWeight: 'var(--weight-semibold)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {f.label}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {c.dentist_name || '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                        {c.rebooked ? (
                          <span style={{ color: 'var(--urgency-ok)' }}>Sim</span>
                        ) : (
                          <span style={{ color: 'var(--urgency-soon)' }}>Ainda não</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
