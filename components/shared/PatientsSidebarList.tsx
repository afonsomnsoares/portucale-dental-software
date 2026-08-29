import { AlertTriangle } from 'lucide-react';
import { Badge, Empty, RiskBadge, Spinner } from '@/components/ui';
import type { Patient } from '@/lib/types';

export default function PatientsSidebarList({
  patients,
  selectedId,
  onSelect,
  loading,
  search,
  onSearchChange,
  alwaysShowRiskBadge = false,
  emptyMessage = 'No patients found',
}: {
  patients: Patient[];
  selectedId: string | undefined;
  onSelect: (p: Patient) => void;
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  // Dentist view always shows the risk badge; receptionist view only surfaces it once a
  // patient crosses the risk threshold — kept as a prop rather than forcing one behavior.
  alwaysShowRiskBadge?: boolean;
  emptyMessage?: string;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #EBECF0' }}>
        <input
          className="input"
          placeholder="Search name or ID…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
        {loading ? (
          <Spinner />
        ) : !patients.length ? (
          <Empty message={emptyMessage} />
        ) : (
          patients.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => onSelect(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(p);
                }
              }}
              style={{
                display: 'block',
                width: '100%',
                border: 'none',
                font: 'inherit',
                textAlign: 'left',
                padding: '11px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid #F4F7FA',
                background: selectedId === p.id ? '#DEEBFF' : 'white',
                borderLeft: `3px solid ${selectedId === p.id ? '#0052CC' : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#172B4D' }}>{p.name}</div>
                {(alwaysShowRiskBadge || (p.no_show_score || 0) >= 30) && <RiskBadge score={p.no_show_score || 0} />}
              </div>
              <div style={{ fontSize: 11, color: '#97A0AF', marginBottom: 3 }}>
                #{p.global_seq} · <Badge s={p.status} />
              </div>
              {p.alerts?.filter(Boolean).length > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#DE350B',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <AlertTriangle size={11} />
                  {p.alerts[0]}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
