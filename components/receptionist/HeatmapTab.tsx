import { useMemo } from 'react';
import { Empty } from '@/components/ui';
import type { RiskHeatmapData } from '@/lib/types';
import { BUCKETS, heatColor, WEEKDAYS } from './scheduleIntelConstants';

export default function HeatmapTab({ heatmap }: { heatmap: RiskHeatmapData | null }) {
  const heatCells = useMemo(() => {
    const map = new Map<string, { total: number; rate: number }>();
    for (const c of heatmap?.cells || []) map.set(`${c.weekday}:${c.bucket}`, { total: c.total, rate: c.rate });
    return map;
  }, [heatmap]);

  if (!heatmap?.cells?.length) {
    return <Empty message="Ainda sem histórico suficiente (faltas/cancelamentos) para calcular o heatmap." />;
  }

  return (
    <div className="card p-5">
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Taxa de falta/cancelamento por dia da semana e período, com base nos últimos {heatmap.historyMonths} meses (
        {heatmap.sampleSize} registos).
      </p>
      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="data-th">Período</th>
              {WEEKDAYS.map((w) => (
                <th key={w.key} className="data-th" style={{ textAlign: 'center' }}>
                  {w.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BUCKETS.map((b) => (
              <tr key={b.key}>
                <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)', whiteSpace: 'nowrap' }}>
                  {b.label}
                </td>
                {WEEKDAYS.map((w) => {
                  const cell = heatCells.get(`${w.key}:${b.key}`);
                  const rate = cell?.rate || 0;
                  const cfg = heatColor(rate);
                  return (
                    <td key={w.key} className="data-td" style={{ textAlign: 'center', padding: 8 }}>
                      <div
                        style={{
                          background: cfg.bg,
                          color: cfg.color,
                          borderRadius: 'var(--radius-control)',
                          padding: '8px 4px',
                          fontWeight: 'var(--weight-bold)',
                          fontSize: 'var(--text-sm)',
                        }}
                      >
                        {cell?.total ? `${Math.round(rate * 100)}%` : '—'}
                      </div>
                      {cell?.total ? (
                        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          {cell.total} marc.
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
