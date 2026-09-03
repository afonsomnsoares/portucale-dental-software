'use client';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import EquipmentTab from '@/components/inventory/EquipmentTab';
import ForecastTab from '@/components/inventory/ForecastTab';
import ItemsTab from '@/components/inventory/ItemsTab';
import PurchaseOrdersTab from '@/components/inventory/PurchaseOrdersTab';
import { AlertBanner, MetricCard, PageHeader, Spinner, Tabs } from '@/components/ui';
import type { InventoryItem, InventoryStock } from '@/lib/types';

// Inventário da própria clínica. O ledger da versão de plataforma
// (components/super-admin/pages/Inventory.tsx) é uma matriz item × clínica, que só faz
// sentido com a lista de tenants — e essa lista é 403 para um admin de clínica. Aqui o
// ledger é uma coluna só: o stock desta clínica.
//
// A rota já só devolve as linhas desta clínica (app/api/inventory/stock/route.ts,
// tenant: 'optional'), por isso o filtro por tenant deixou de ser feito aqui.
export default function ClinicInventoryPage() {
  const { api, user } = useAuth();
  const tenantId = user?.tenantId || '';
  const [tab, setTab] = useState('ledger');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stock, setStock] = useState<InventoryStock[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Sem `.catch(() => null)`: uma falha aqui saía como ledger vazio e cartões de rutura a
  // zero, que é a leitura oposta à verdade — "não há nada em falta" quando na realidade
  // ninguém foi ver. Um inventário que não carregou tem de o dizer.
  const loadInventory = useCallback(async () => {
    try {
      const inv = await api('/inventory/stock');
      setItems(inv?.items || []);
      setStock(inv?.stock || []);
      setError('');
    } catch (e) {
      setItems([]);
      setStock([]);
      setError(
        e instanceof Error && e.message
          ? `Não foi possível carregar o inventário: ${e.message}`
          : 'Não foi possível carregar o inventário. Os valores abaixo não estão atualizados.',
      );
    }
  }, [api]);

  useEffect(() => {
    loadInventory().finally(() => setLoading(false));
  }, [loadInventory]);

  const stockMap = new Map<number, InventoryStock>();
  for (const s of stock) {
    stockMap.set(s.item_id, s);
  }

  const rows = items.map((item) => {
    const row = stockMap.get(item.id);
    const qty = Number(row?.quantity || 0);
    // Ponto de reposição desta clínica quando há linha de stock; sem linha a quantidade é
    // 0 e o item conta como esgotado, onde o ponto de reposição é irrelevante.
    const reorderAt = Number(row?.reorder_at ?? item.reorder_at);
    return { item, qty, reorderAt, out: qty === 0, low: qty > 0 && qty <= reorderAt };
  });
  const outCount = rows.filter((r) => r.out).length;
  const lowCount = rows.filter((r) => r.low).length;

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Inventário" sub="Stock da clínica, previsão de consumo, validade e reposição" />

      {error && <AlertBanner type="danger">{error}</AlertBanner>}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'ledger', label: 'Stock' },
          { key: 'items', label: 'Itens' },
          { key: 'forecast', label: 'Previsão & Validade' },
          { key: 'orders', label: 'Encomendas' },
          { key: 'equipment', label: 'Equipamento' },
        ]}
      />

      {tab === 'ledger' ? (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
            <MetricCard label="SEM STOCK" value={outCount} color="#DE350B" />
            <MetricCard label="STOCK BAIXO" value={lowCount} color="#FF8B00" />
            <MetricCard label="ITENS SEGUIDOS" value={items.length} color="#0052CC" />
          </div>
          <div className="card" style={{ padding: 0 }}>
            {!rows.length ? (
              <div style={{ padding: '18px 16px', color: '#97A0AF', fontSize: 13 }}>
                {/* Sem esta distinção, uma falha de carregamento passava-se por catálogo
                    vazio e convidava a criar um item que já existe. */}
                {error
                  ? 'Inventário não carregado — ver o erro acima.'
                  : 'Sem itens de inventário. Cria o primeiro no separador Itens.'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="data-th">Item</th>
                    <th className="data-th">Unidade</th>
                    <th className="data-th">Quantidade</th>
                    <th className="data-th">Repor a</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, qty, reorderAt, out, low }) => (
                    <tr key={item.id}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {item.item}
                      </td>
                      <td className="data-td" style={{ color: '#97A0AF' }}>
                        {item.unit}
                      </td>
                      <td
                        className="data-td"
                        style={{ fontWeight: 700, color: out ? '#DE350B' : low ? '#FF8B00' : '#00875A' }}
                      >
                        {out ? (
                          <span
                            style={{
                              background: '#FFEBE6',
                              color: '#DE350B',
                              borderRadius: 4,
                              padding: '2px 8px',
                              fontSize: 11,
                            }}
                          >
                            ESGOTADO
                          </span>
                        ) : (
                          qty
                        )}
                        {low && !out && (
                          <AlertTriangle size={10} color="#FF8B00" style={{ marginLeft: 4, display: 'inline' }} />
                        )}
                      </td>
                      <td className="data-td" style={{ color: '#97A0AF' }}>
                        {reorderAt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : tab === 'items' ? (
        <ItemsTab api={api} tenantId={tenantId} onChanged={loadInventory} />
      ) : tab === 'forecast' ? (
        <ForecastTab api={api} tenantId={tenantId} />
      ) : tab === 'orders' ? (
        <PurchaseOrdersTab api={api} tenantId={tenantId} items={items} onReceived={loadInventory} />
      ) : (
        <EquipmentTab api={api} />
      )}
    </div>
  );
}
