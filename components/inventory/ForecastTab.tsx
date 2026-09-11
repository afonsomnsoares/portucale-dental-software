'use client';
import { type ChangeEvent, useCallback, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import {
  Badge,
  DataTable,
  Empty,
  ErrorState,
  GhostBtn,
  Inp,
  MetricCard,
  PrimaryBtn,
  Sel,
  Spinner,
  TD,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { APPOINTMENT_TYPES } from '@/lib/constants';
import type { InventoryForecastResponse, InventoryItem, ProcedureItemUsage } from '@/lib/types';

interface ForecastTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  tenantId: string;
}

const EXPIRY_META: Record<string, { label: string; bg: string; color: string }> = {
  expired: { label: 'Expirado', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  expiring_soon: { label: 'A expirar', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  ok: { label: 'Válido', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  no_expiry: { label: 'Sem validade', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
};

const EMPTY_MAPPING_FORM = { appointmentType: APPOINTMENT_TYPES[0]?.label || '', itemId: '', qty: '1' };

// Previsão de consumo (lib/inventory.ts's computeInventoryOverview) + validade dos lotes +
// necessidades previstas a partir da agenda (computeProcedureDemandForecast) — as três
// partes do gap "sem previsão" da avaliação original andam sempre juntas na cabeça de
// quem gere stock.
export default function ForecastTab({ api, tenantId }: ForecastTabProps) {
  // `null` sem clínica escolhida: era o `if (!tenantId) return` no início do
  // callback, que deixava o `loading` preso a true e o ecrã num spinner eterno
  // em vez de chegar ao «Escolha uma clínica» que está lá em baixo.
  const dataQuery = useQuery<InventoryForecastResponse>(tenantId ? `/inventory/forecast?tenantId=${tenantId}` : null);
  const usageQuery = useQuery<ProcedureItemUsage[]>(
    tenantId ? `/inventory/procedure-usage?tenantId=${tenantId}` : null,
  );
  const itemsQuery = useQuery<InventoryItem[]>(tenantId ? '/inventory/items' : null);

  const data = dataQuery.data ?? { overview: [], procedureDemand: [] };
  const usage = usageQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const [mappingForm, setMappingForm] = useState(EMPTY_MAPPING_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    dataQuery.refetch();
    usageQuery.refetch();
  }, [dataQuery, usageQuery]);

  async function addMapping() {
    if (!mappingForm.itemId) {
      setError('Escolha um item.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api('/inventory/procedure-usage', {
        method: 'POST',
        body: {
          tenantId,
          appointmentType: mappingForm.appointmentType,
          itemId: Number(mappingForm.itemId),
          qtyPerProcedure: Number(mappingForm.qty) || 1,
        },
      });
      setMappingForm(EMPTY_MAPPING_FORM);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function removeMapping(id: string) {
    setError('');
    try {
      await api(`/inventory/procedure-usage/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível remover o consumo.');
    }
  }

  // A ordem importa: sem clínica escolhida não há nada a carregar, por isso a
  // mensagem vem ANTES do spinner — ao contrário da versão anterior, em que o
  // `loading` ficava preso a true e nunca se chegava a esta linha.
  if (!tenantId) return <Empty message="Escolha uma clínica." />;
  if (dataQuery.error)
    return (
      <ErrorState
        error={dataQuery.error}
        onRetry={dataQuery.refetch}
        message="Não foi possível ler a previsão de stock."
      />
    );
  if (dataQuery.loading) return <Spinner />;
  if (dataQuery.error) return <ErrorState error={dataQuery.error} onRetry={dataQuery.refetch} />;

  const rows = data.overview;
  const atRiskCount = rows.filter((r) => r.atRisk).length;
  const expiringCount = rows.reduce(
    (n, r) => n + r.batches.filter((b) => b.expiryStatus === 'expiring_soon' || b.expiryStatus === 'expired').length,
    0,
  );

  return (
    <div>
      <div className="grid-cards" style={{ gap: 12, marginBottom: 20 }}>
        <MetricCard label="ITENS EM RISCO DE RUTURA" value={atRiskCount} color="var(--urgency-critical)" />
        <MetricCard label="LOTES A EXPIRAR / EXPIRADOS" value={expiringCount} color="var(--urgency-soon)" />
        <MetricCard label="ITENS RASTREADOS" value={rows.length} color="var(--accent)" />
      </div>

      {!rows.length ? (
        <Empty message="Sem itens no catálogo. Crie um na aba Itens." />
      ) : (
        <div className="card mb-5" style={{ padding: 0 }}>
          <DataTable
            cols={['Artigo', 'Stock atual', 'Consumo/dia', 'Dias até esgotar', 'Risco', 'Lotes']}
            rows={rows.map((r) => (
              <tr key={r.item.id}>
                <TD bold>
                  {r.item.item}{' '}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-normal)' }}>
                    ({r.item.unit})
                  </span>
                </TD>
                <TD>{r.currentQty}</TD>
                <TD muted>{r.dailyRate > 0 ? r.dailyRate.toFixed(1) : '—'}</TD>
                <TD muted>{r.daysUntilStockout === null ? '—' : r.daysUntilStockout}</TD>
                <TD>
                  {r.atRisk ? (
                    <Badge
                      label={`Repor ${r.suggestedReorderQty}`}
                      bg="var(--urgency-critical-bg)"
                      color="var(--urgency-critical)"
                    />
                  ) : (
                    <Badge label="OK" bg="var(--urgency-ok-bg)" color="var(--urgency-ok)" />
                  )}
                </TD>
                <TD>
                  {!r.batches.length ? (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      —
                    </span>
                  ) : (
                    <div className="flex items-center gap-1" style={{ flexWrap: 'wrap' }}>
                      {r.batches.map((b) => {
                        const meta = EXPIRY_META[b.expiryStatus];
                        return (
                          <span key={b.id} title={b.batch_number || b.id}>
                            <Badge
                              label={`${b.quantity}${b.expiry_date ? ` · ${b.expiry_date.slice(0, 10)}` : ''}`}
                              bg={meta.bg}
                              color={meta.color}
                            />
                          </span>
                        );
                      })}
                    </div>
                  )}
                </TD>
              </tr>
            ))}
          />
        </div>
      )}

      <div className="section-label mb-3">NECESSIDADES PREVISTAS (PRÓXIMOS 14 DIAS)</div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Calculado a partir das consultas já marcadas, cruzadas com o consumo configurado abaixo — não com o histórico de
        consumo (essa é a tabela acima).
      </p>
      <div className="card mb-5" style={{ padding: 0 }}>
        {!data.procedureDemand.length ? (
          <Empty message="Sem necessidades previstas — configure o consumo por tipo de consulta abaixo." />
        ) : (
          <DataTable
            cols={['Artigo', 'Stock atual', 'Necessidade prevista', 'Em falta']}
            rows={data.procedureDemand.map((d) => (
              <tr key={d.itemId}>
                <TD bold>
                  {d.item}{' '}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-normal)' }}>({d.unit})</span>
                </TD>
                <TD>{d.currentQty}</TD>
                <TD>{d.projectedDemand}</TD>
                <TD>
                  {d.shortfall > 0 ? (
                    <Badge
                      label={`Faltam ${d.shortfall}`}
                      bg="var(--urgency-critical-bg)"
                      color="var(--urgency-critical)"
                    />
                  ) : (
                    <Badge label="Coberto" bg="var(--urgency-ok-bg)" color="var(--urgency-ok)" />
                  )}
                </TD>
              </tr>
            ))}
          />
        )}
      </div>

      <div className="section-label mb-3">CONSUMO POR TIPO DE CONSULTA</div>
      <div className="card p-4 mb-3">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Sel
            value={mappingForm.appointmentType}
            onChange={(e) => setMappingForm((f) => ({ ...f, appointmentType: e.target.value }))}
            style={{ minWidth: 220 }}
          >
            {APPOINTMENT_TYPES.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </Sel>
          <Sel
            value={mappingForm.itemId}
            onChange={(e) => setMappingForm((f) => ({ ...f, itemId: e.target.value }))}
            style={{ minWidth: 200 }}
          >
            <option value="">— Item —</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.item}
              </option>
            ))}
          </Sel>
          <Inp
            type="number"
            min={0.01}
            step={0.01}
            value={mappingForm.qty}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setMappingForm((f) => ({ ...f, qty: e.target.value }))}
            style={{ maxWidth: 100 }}
          />
          <PrimaryBtn onClick={addMapping} disabled={saving}>
            {saving ? 'A guardar…' : '+ Adicionar'}
          </PrimaryBtn>
        </div>
        {error && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--urgency-critical)',
              fontWeight: 'var(--weight-bold)',
              marginTop: 8,
            }}
          >
            {error}
          </div>
        )}
      </div>
      {usage.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            cols={['Tipo de consulta', 'Artigo', 'Quantidade', '']}
            rows={usage.map((u) => (
              <tr key={u.id}>
                <TD>{u.appointment_type}</TD>
                <TD>{u.item_name}</TD>
                <TD>
                  {u.qty_per_procedure} {u.unit}
                </TD>
                <TD right>
                  <GhostBtn
                    onClick={() => removeMapping(u.id)}
                    style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                  >
                    Remover
                  </GhostBtn>
                </TD>
              </tr>
            ))}
          />
        </div>
      )}
    </div>
  );
}
