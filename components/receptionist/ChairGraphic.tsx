export const CHAIR_COLORS = ['#0052CC', '#00875A', '#FF8B00'];

export default function ChairGraphic({ color, occupied }: { color: string; occupied: boolean }) {
  return (
    <div style={{ width: 64, height: 64, position: 'relative', opacity: occupied ? 1 : 0.45 }}>
      <div
        style={{
          position: 'absolute',
          left: 10,
          right: 10,
          top: 6,
          height: 24,
          borderRadius: 10,
          background: occupied ? `${color}1A` : '#F4F7FA',
          border: `2px solid ${occupied ? `${color}55` : '#DFE1E6'}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          top: 30,
          height: 18,
          borderRadius: 10,
          background: occupied ? `${color}22` : '#F4F7FA',
          border: `2px solid ${occupied ? `${color}66` : '#DFE1E6'}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 14,
          bottom: 6,
          width: 10,
          height: 16,
          borderRadius: 6,
          background: occupied ? `${color}66` : '#DFE1E6',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 14,
          bottom: 6,
          width: 10,
          height: 16,
          borderRadius: 6,
          background: occupied ? `${color}66` : '#DFE1E6',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 6,
          top: 28,
          width: 8,
          height: 18,
          borderRadius: 6,
          background: occupied ? `${color}55` : '#DFE1E6',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 6,
          top: 28,
          width: 8,
          height: 18,
          borderRadius: 6,
          background: occupied ? `${color}55` : '#DFE1E6',
        }}
      />
    </div>
  );
}
