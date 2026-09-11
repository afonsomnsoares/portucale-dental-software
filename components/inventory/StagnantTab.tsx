'use client';
// ─── Produtos parados ───────────────────────────────────────────────────────
// O contrário da rutura, e o mais fácil de ignorar: dinheiro imobilizado em coisas que
// não saem. `computeStagnantInventory` existia com rota e nenhum consumidor.
//
// Os quatro estados aparecem separados e não somados num só «parado», porque decidem
// coisas diferentes: «nunca consumido» é uma compra errada, «parado e a expirar» é uma
// perda com data marcada, e «rotação lenta» pode ser perfeitamente normal num material
// de especialidade. A ordenação vem do servidor (`rankStagnant`): primeiro o que expira,
// depois o que tem mais capital preso.
import { Empty, ErrorState, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatEUR } from '@/lib/constants';

interface Item {
  itemId: number;
  item: string;
  status: string;
  currentQty: number;
  tiedUpValue: number | null;
  daysSinceConsumed: number | null;
  nearestExpiry: string | null;
}

const LABELS: Record<string, string> = {
  never_moved: 'Nunca consumido',
  stagnant: 'Parado',
  slow: 'Rotação lenta',
  expiring_dead: 'Parado e a expirar',
  active: 'Em uso',
};

const TOM: Record<string, string> = {
  expiring_dead: 'var(--urgency-critical)',
  never_moved: 'var(--urgency-soon)',
  stagnant: 'var(--urgency-soon)',
  slow: 'var(--text-muted)',
  active: 'var(--urgency-ok)',
};

export default function StagnantTab() {
  const dados = useQuery<{ items: Item[]; totals: { count: number; tiedUpValue: number; itemsWithoutCost: number } }>(
    '/inventory/stagnant',
  );
  const items = dados.data?.items || [];
  const totais = dados.data?.totals || null;

  if (dados.loading) return <Spinner />;
  if (dados.error)
    return <ErrorState error={dados.error} onRetry={dados.refetch} message="Não foi possível ler o stock parado." />;
  if (!items.length) return <Empty message="Nada parado. Todo o stock com movimento registado está a sair." />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div
            style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', fontVariantNumeric: 'tabular-nums' }}
          >
            {totais?.count ?? 0}
          </div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>itens sem rotação</div>
        </div>
        <div>
          <div
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--urgency-soon)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatEUR(totais?.tiedUpValue ?? 0)}
          </div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
            de capital imobilizado
            {totais?.itemsWithoutCost
              ? ` · ${totais.itemsWithoutCost} ${totais.itemsWithoutCost === 1 ? 'item sem preço' : 'itens sem preço'}, fora da conta`
              : ''}
          </div>
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-card)',
          background: 'var(--bg-surface)',
          overflowX: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 580 }}>
          <thead>
            <tr>
              {['Item', 'Estado', 'Em stock', 'Sem sair há', 'Validade', 'Capital preso'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i >= 2 ? 'right' : 'left',
                    padding: '9px 14px',
                    fontSize: 'var(--text-2xs)',
                    letterSpacing: '.08em',
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
            {items.map((i) => (
              <tr key={i.itemId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '10px 14px', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                  {i.item}
                </td>
                <td
                  style={{
                    padding: '10px 14px',
                    fontSize: 'var(--text-xs)',
                    color: TOM[i.status],
                    fontWeight: 'var(--weight-semibold)',
                  }}
                >
                  {LABELS[i.status] || i.status}
                </td>
                <td
                  style={{
                    padding: '10px 14px',
                    fontSize: 'var(--text-xs)',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {i.currentQty}
                </td>
                <td
                  style={{
                    padding: '10px 14px',
                    fontSize: 'var(--text-xs)',
                    textAlign: 'right',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {i.daysSinceConsumed === null ? 'nunca saiu' : `${i.daysSinceConsumed} dias`}
                </td>
                <td
                  style={{
                    padding: '10px 14px',
                    fontSize: 'var(--text-xs)',
                    textAlign: 'right',
                    color: i.status === 'expiring_dead' ? 'var(--urgency-critical)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {i.nearestExpiry ? String(i.nearestExpiry).slice(0, 10) : '—'}
                </td>
                <td
                  style={{
                    padding: '10px 14px',
                    fontSize: 'var(--text-xs)',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {/* Null e não 0 €: um item sem preço registado não vale zero — não se sabe. */}
                  {i.tiedUpValue === null ? (
                    <span style={{ color: 'var(--text-muted)' }}>sem preço</span>
                  ) : (
                    formatEUR(i.tiedUpValue)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
