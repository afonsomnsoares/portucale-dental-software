import { ChevronLeft, ChevronRight, GitCompareArrows, Scan } from 'lucide-react';

const FINDINGS: Array<[string, string[], string]> = [
  [
    '2024 Baseline Findings',
    [
      '• Caries on Tooth #14 (D2 depth)',
      '• Tooth #18 vital, no pathology',
      '• Bone levels within normal limits',
      '• No periapical pathology noted',
    ],
    '#FF8B00',
  ],
  [
    '2026 Post-Treatment Status',
    [
      '• Tooth #14 composite restoration done',
      '• Tooth #18 root canal complete',
      '• Periapical healing confirmed',
      '• Stable bone levels maintained',
    ],
    '#00875A',
  ],
];

export default function ImagingCompareView({
  divider,
  onDividerChange,
}: {
  divider: number;
  onDividerChange: (value: number) => void;
}) {
  return (
    <div className="card p-5">
      <div
        style={{
          fontSize: 13,
          color: '#FF8B00',
          fontWeight: 700,
          marginBottom: 16,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <GitCompareArrows size={16} /> TIME-LAPSE COMPARATOR — Panoramic Sep 2024 vs Apr 2026
      </div>
      {/* Viewer */}
      <div
        style={{
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #DFE1E6',
          height: 340,
          userSelect: 'none',
        }}
      >
        {/* BEFORE */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#EEF2F8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            clipPath: `inset(0 ${100 - divider}% 0 0)`,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <Scan size={64} opacity={0.08} color="#172B4D" />
            <div style={{ fontSize: 14, color: '#5E6C84', marginTop: 12, fontWeight: 700 }}>Sep 2024 · Baseline</div>
            <div style={{ fontSize: 12, color: '#97A0AF' }}>Pre-treatment panoramic</div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#DE350B', fontWeight: 600 }}>
              Caries visible on #14 · #18 intact
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 14,
              background: '#FF8B00',
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 4,
              padding: '3px 9px',
            }}
          >
            BEFORE
          </div>
        </div>
        {/* AFTER */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#E8F0FA',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            clipPath: `inset(0 0 0 ${divider}%)`,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <Scan size={64} opacity={0.12} color="#0052CC" />
            <div style={{ fontSize: 14, color: '#0052CC', marginTop: 12, fontWeight: 700 }}>
              Apr 2026 · Post-Treatment
            </div>
            <div style={{ fontSize: 12, color: '#97A0AF' }}>Root canal + composite complete</div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#00875A', fontWeight: 600 }}>
              #14 restored · #18 RCT complete
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 14,
              background: '#00875A',
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 4,
              padding: '3px 9px',
            }}
          >
            AFTER
          </div>
        </div>
        {/* Handle */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${divider}%`,
            width: 3,
            background: 'white',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 8px rgba(0,0,0,.2)',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,82,204,.25)',
              color: '#0052CC',
            }}
          >
            <GitCompareArrows size={16} />
          </div>
        </div>
      </div>
      {/* Slider */}
      <div style={{ marginTop: 16 }}>
        <input
          type="range"
          min={5}
          max={95}
          step={1}
          value={divider}
          onChange={(e) => onDividerChange(+e.target.value)}
          style={{ width: '100%', accentColor: '#0052CC', height: 6, cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#97A0AF', marginTop: 4 }}>
          <span>
            <ChevronLeft size={12} style={{ display: 'inline' }} /> Show Before (Sep 2024)
          </span>
          <span>
            Show After (Apr 2026) <ChevronRight size={12} style={{ display: 'inline' }} />
          </span>
        </div>
      </div>
      {/* Findings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 20 }}>
        {FINDINGS.map(([title, items, color]) => (
          <div
            key={title}
            style={{ background: '#F4F7FA', borderRadius: 6, padding: '14px 16px', borderLeft: `3px solid ${color}` }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color,
                letterSpacing: '.07em',
                marginBottom: 10,
                textTransform: 'uppercase',
              }}
            >
              {title}
            </div>
            {items.map((item) => (
              <div key={item} style={{ fontSize: 12, color: '#5E6C84', marginBottom: 5, lineHeight: 1.5 }}>
                {item}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
