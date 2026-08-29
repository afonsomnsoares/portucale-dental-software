import { GitCompareArrows, ImagePlus } from 'lucide-react';

export interface ImagingScan {
  id: number;
  type: string;
  date: string;
  region: string;
  label: string;
  icon: string;
  patientId: string | null;
}

export default function ImagingScanGrid({
  scans,
  onSelectScan,
  typeColors,
}: {
  scans: ImagingScan[];
  onSelectScan: (scan: ImagingScan) => void;
  typeColors: Record<string, string>;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
      {scans.map((scan) => {
        const col = typeColors[scan.type] || '#0052CC';
        return (
          <button
            type="button"
            key={scan.id}
            className="card"
            style={{
              padding: 0,
              cursor: 'pointer',
              overflow: 'hidden',
              border: 'none',
              font: 'inherit',
              textAlign: 'left',
              width: '100%',
            }}
            onClick={() => onSelectScan(scan)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectScan(scan);
              }
            }}
          >
            <div
              style={{
                height: 140,
                background: '#F4F7FA',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderBottom: '1px solid #DFE1E6',
                position: 'relative',
              }}
            >
              <div style={{ fontSize: 48, opacity: 0.1, color: '#172B4D' }}>{scan.icon}</div>
              <div style={{ fontSize: 11, color: '#5E6C84', marginTop: 4, fontWeight: 600 }}>{scan.type}</div>
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  background: `${col}18`,
                  border: `1px solid ${col}44`,
                  color: col,
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {scan.type}
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  background: 'rgba(23,43,77,.5)',
                  color: 'white',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <GitCompareArrows size={10} /> Compare
              </div>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#172B4D', marginBottom: 3 }}>{scan.label}</div>
              <div style={{ fontSize: 11, color: '#97A0AF', display: 'flex', justifyContent: 'space-between' }}>
                <span>Region: {scan.region}</span>
                <span>{scan.date}</span>
              </div>
            </div>
          </button>
        );
      })}
      {/* Upload placeholder */}
      <div
        className="card"
        style={{ padding: 0, cursor: 'pointer', overflow: 'hidden', border: '2px dashed #DFE1E6', boxShadow: 'none' }}
      >
        <div
          style={{
            height: 140,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#C1C7D0',
          }}
        >
          <ImagePlus size={32} opacity={0.5} />
          <div style={{ fontSize: 12, fontWeight: 600 }}>Upload New Scan</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>DICOM · JPEG · PNG</div>
        </div>
      </div>
    </div>
  );
}
