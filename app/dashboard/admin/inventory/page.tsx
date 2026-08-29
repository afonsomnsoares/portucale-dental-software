'use client';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { MetricCard, PageHeader, Spinner } from '@/components/ui';
import type { InventoryItem, InventoryStock, Tenant } from '@/lib/types';
export default function InventoryPage() {
  const { api } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stock, setStock] = useState<InventoryStock[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([api('/inventory').catch(() => null), api('/tenants').catch(() => [])])
      .then(([inv, t]) => {
        setItems(inv?.items || []);
        setStock(inv?.stock || []);
        setTenants(t || []);
      })
      .finally(() => setLoading(false));
  }, [api]);

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

  return (
    <div>
      <PageHeader
        title="Global Inventory Ledger"
        sub="Cross-clinic supply chain — live stock levels"
        action="Generate Order"
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        <MetricCard label="OUT OF STOCK" value={outCount} color="#DE350B" />
        <MetricCard label="LOW STOCK ALERTS" value={lowCount} color="#FF8B00" />
        <MetricCard label="CLINICS TRACKED" value={tenants.length} color="#0052CC" />
      </div>
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Spinner />
        ) : tenants.length === 0 ? (
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
  );
}
