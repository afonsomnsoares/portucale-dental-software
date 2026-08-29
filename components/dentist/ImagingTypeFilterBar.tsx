export default function ImagingTypeFilterBar({
  types,
  filter,
  onChange,
}: {
  types: string[];
  filter: string;
  onChange: (type: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      {types.map((t) => (
        <button
          type="button"
          key={t}
          onClick={() => onChange(t)}
          style={{
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 20,
            cursor: 'pointer',
            fontFamily: 'inherit',
            border: `1.5px solid ${filter === t ? '#0052CC' : '#DFE1E6'}`,
            background: filter === t ? '#DEEBFF' : 'white',
            color: filter === t ? '#0052CC' : '#5E6C84',
            transition: 'all 0.12s',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
