import { tint } from '@/components/ui';
export const CHAIR_COLORS = ['var(--accent)', 'var(--urgency-ok)', 'var(--urgency-soon)'];

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
          borderRadius: 'var(--radius-control)',
          background: occupied ? tint(color, 10) : 'var(--bg-page)',
          border: `2px solid ${occupied ? tint(color, 33) : 'var(--border-subtle)'}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          top: 30,
          height: 18,
          borderRadius: 'var(--radius-control)',
          background: occupied ? tint(color, 13) : 'var(--bg-page)',
          border: `2px solid ${occupied ? tint(color, 40) : 'var(--border-subtle)'}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 14,
          bottom: 6,
          width: 10,
          height: 16,
          borderRadius: 'var(--radius-control)',
          background: occupied ? tint(color, 40) : 'var(--border-subtle)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 14,
          bottom: 6,
          width: 10,
          height: 16,
          borderRadius: 'var(--radius-control)',
          background: occupied ? tint(color, 40) : 'var(--border-subtle)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 6,
          top: 28,
          width: 8,
          height: 18,
          borderRadius: 'var(--radius-control)',
          background: occupied ? tint(color, 33) : 'var(--border-subtle)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 6,
          top: 28,
          width: 8,
          height: 18,
          borderRadius: 'var(--radius-control)',
          background: occupied ? tint(color, 33) : 'var(--border-subtle)',
        }}
      />
    </div>
  );
}
