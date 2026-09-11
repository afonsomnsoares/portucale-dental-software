'use client';
// ─── Fornecedores ───────────────────────────────────────────────────────────
// A tabela existe desde a migração 044 e as três rotas também; faltava o ecrã. É um
// separador do Inventário e não uma página própria porque um fornecedor só existe para
// se lhe encomendar alguma coisa — separá-lo das encomendas seria arrumar por tabela em
// vez de por trabalho.
//
// Desativar em vez de apagar: uma encomenda antiga aponta para o fornecedor, e apagá-lo
// deixaria o histórico a falar de um id que já não diz nada. `active` é o que a rota já
// suporta e o índice único é por (tenant_id, lower(name)) — dois fornecedores com o
// mesmo nome não entram, e a rota devolve isso em português.
import { useCallback, useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { Empty, Inp, PrimaryBtn, Spinner, Textarea } from '@/components/ui';

interface Props {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
}

interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
}

const VAZIO = { name: '', email: '', phone: '', notes: '' };

export default function SuppliersTab({ api }: Props) {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [novo, setNovo] = useState(VAZIO);
  const [aCarregar, setACarregar] = useState(true);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setACarregar(true);
    try {
      setRows((await api(`/suppliers${mostrarInativos ? '?includeInactive=1' : ''}`)) || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os fornecedores.');
    } finally {
      setACarregar(false);
    }
  }, [api, mostrarInativos]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = useCallback(async () => {
    if (!novo.name.trim()) return;
    setAGravar(true);
    setErro('');
    try {
      await api('/suppliers', { method: 'POST', body: novo });
      setNovo(VAZIO);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o fornecedor.');
    } finally {
      setAGravar(false);
    }
  }, [api, novo, carregar]);

  const alternarAtivo = useCallback(
    async (s: Supplier) => {
      setErro('');
      try {
        await api(`/suppliers/${s.id}`, { method: 'PUT', body: { active: !s.active } });
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível alterar o fornecedor.');
      }
    },
    [api, carregar],
  );

  return (
    <div>
      {/* ── Novo fornecedor ── */}
      <div
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--bg-surface)',
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Novo fornecedor</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Inp
            value={novo.name}
            onChange={(e) => setNovo({ ...novo, name: e.target.value })}
            placeholder="Nome (obrigatório)"
          />
          <Inp value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="E-mail" />
          <Inp
            value={novo.phone}
            onChange={(e) => setNovo({ ...novo, phone: e.target.value })}
            placeholder="Telefone"
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <Textarea
            value={novo.notes}
            onChange={(e) => setNovo({ ...novo, notes: e.target.value })}
            rows={2}
            placeholder="Notas — prazos de entrega, condições, pessoa de contacto…"
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <PrimaryBtn onClick={criar} disabled={aGravar || !novo.name.trim()}>
            {aGravar ? 'A criar…' : 'Adicionar'}
          </PrimaryBtn>
        </div>
      </div>

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

      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12.5,
          color: 'var(--text-muted)',
          marginBottom: 10,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={mostrarInativos}
          onChange={(e) => setMostrarInativos(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        Mostrar também os desativados
      </label>

      {aCarregar ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty message="Nenhum fornecedor registado. Acrescenta o primeiro acima para o poderes escolher numa encomenda." />
      ) : (
        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--bg-surface)',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead>
              <tr>
                {['Fornecedor', 'Contacto', 'Notas', ''].map((h) => (
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
              {rows.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: s.active ? 1 : 0.55 }}>
                  <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600 }}>
                    {s.name}
                    {!s.active && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}> · desativado</span>
                    )}
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {s.email || '—'}
                    {s.phone && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.phone}</div>}
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text-muted)' }}>{s.notes || '—'}</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      onClick={() => alternarAtivo(s)}
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--border-subtle)',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {s.active ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
