'use client';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import EquipmentTab from '@/components/inventory/EquipmentTab';
import ForecastTab from '@/components/inventory/ForecastTab';
import ItemsTab from '@/components/inventory/ItemsTab';
import PurchaseOrdersTab from '@/components/inventory/PurchaseOrdersTab';
import { MetricCard, PageHeader, Sel, Spinner, Tabs } from '@/components/ui';
import type { InventoryItem, InventoryStock, Tenant } from '@/lib/types';

export default function InventoryPage() {
  const { api, user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [tab, setTab] = useState('ledger');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stock, setStock] = useState<InventoryStock[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);

  // /api/inventory returns items+stock together (the pre-existing cross-clinic ledger
  // query) — reused as the source for the item picker in Encomendas/Ledger too, so it's
  // refetched (via ItemsTab's onChanged) whenever a new item is created there, not just
  // once on mount.
  const loadInventory = useCallback(async () => {
    const inv = await api('/inventory').catch(() => null);
    setItems(inv?.items || []);
    setStock(inv?.stock || []);
  }, [api]);

  useEffect(() => {
    Promise.all([loadInventory(), api('/tenants').catch(() => [])])
      .then(([, t]) => {
        setTenants(t || []);
        // A tenant-scoped admin only ever manages their own clinic — no picker needed for
        // them, only a super_admin (whose own tenantId is null) sees the selector.
        const initial = !isSuperAdmin ? user?.tenantId || '' : (t || [])[0]?.id || '';
        if (initial) setTenantId(initial);
      })
      .finally(() => setLoading(false));
  }, [api, isSuperAdmin, user?.tenantId, loadInventory]);

  const stockMap = new Map<string, number>();
  for (const s of stock) {
    stockMap.set(`${s.item_id}:${s.tenant_id}`, Number(s.quantity || 0));
  }

  const outCount = items.flatMap((i) => tenants.filter((t) => (stockMap.get(`${i.id}:${t.id}`) || 0) === 0)).length;
  const lowCount = items.flatMap((i) =>
    tenants.filter((t) => {
      const q = stockMap.get(`${i.id}:${t.id}`) || 0;
      return q > 0 && q <= Number(i.reorder_at);
    }),
  ).length;

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Inventário" sub="Stock por clínica, previsão de consumo, validade e reposição">
        {tab !== 'ledger' && isSuperAdmin && (
          <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ maxWidth: 260 }}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Sel>
        )}
      </PageHeader>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'ledger', label: 'Ledger' },
          { key: 'items', label: 'Itens' },
          { key: 'forecast', label: 'Previsão & Validade' },
          { key: 'orders', label: 'Encomendas' },
          { key: 'equipment', label: 'Equipamento' },
        ]}
      />

      {tab === 'ledger' ? (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
            <MetricCard label="OUT OF STOCK" value={outCount} color="#DE350B" />
            <MetricCard label="LOW STOCK ALERTS" value={lowCount} color="#FF8B00" />
            <MetricCard label="CLINICS TRACKED" value={tenants.length} color="#0052CC" />
          </div>
          <div className="card" style={{ padding: 0 }}>
            {tenants.length === 0 ? (
              <div style={{ padding: '18px 16px', color: '#97A0AF', fontSize: 13 }}>
                No clinics provisioned yet. Create a clinic in Tenants first.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="data-th">Item</th>
                    <th className="data-th">Unit</th>
                    {tenants.map((t) => (
                      <th key={t.id} className="data-th">
                        {t.name}
                      </th>
                    ))}
                    <th className="data-th">Reorder At</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {item.item}
                      </td>
                      <td className="data-td" style={{ color: '#97A0AF' }}>
                        {item.unit}
                      </td>
                      {tenants.map((t) => {
                        const qty = stockMap.get(`${item.id}:${t.id}`) || 0;
                        const out = qty === 0;
                        const low = qty > 0 && qty <= Number(item.reorder_at);
                        return (
                          <td
                            key={t.id}
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
                                OUT
                              </span>
                            ) : (
                              qty
                            )}
                            {low && !out && (
                              <AlertTriangle size={10} color="#FF8B00" style={{ marginLeft: 4, display: 'inline' }} />
                            )}
                          </td>
                        );
                      })}
                      <td className="data-td" style={{ color: '#97A0AF' }}>
                        {item.reorder_at}
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
