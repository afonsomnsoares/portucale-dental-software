'use client';
import { AlertTriangle, Check, Inbox, Info } from 'lucide-react';
import Image from 'next/image';
import {
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { useAuth } from '@/app/providers';
import type { TimelineEvent } from '@/lib/types';

const FALLBACK_STATUS = {
  confirmed: { label: 'Confirmada', bg: 'var(--accent-bg)', color: 'var(--accent)' },
  registered: { label: 'Registada', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
  waiting: { label: 'A aguardar', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  'in-operatory': { label: 'Em Consultório', bg: 'var(--accent-bg)', color: 'var(--accent)' },
  'procedure-active': {
    label: 'Procedimento Ativo',
    bg: 'var(--urgency-critical-bg)',
    color: 'var(--urgency-critical)',
  },
  'ready-dismissal': { label: 'Pronto para Saída', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  departed: { label: 'Saiu', bg: 'var(--cat-teal-bg)', color: 'var(--cat-teal)' },
  'no-show': { label: 'Não Compareceu', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  active: { label: 'Ativo', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  provisioning: { label: 'A provisionar', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  suspended: { label: 'Suspenso', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  completed: { label: 'Concluído', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  accepted: { label: 'Aceite', bg: 'var(--accent-bg)', color: 'var(--accent)' },
  proposed: { label: 'Proposto', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  paid: { label: 'Pago', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  partial: { label: 'Parcial', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  pending: { label: 'Pendente', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  proposto: { label: 'Proposto', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  aceite: { label: 'Aceite', bg: 'var(--accent-bg)', color: 'var(--accent)' },
  concluído: { label: 'Concluído', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
};

// ─── Compor cor com transparência ───────────────────────────────────────────
// `${cor}30` só funciona se `cor` for um hex de 6 dígitos. Metade das cores deste
// ficheiro são tokens — `var(--accent)`, `var(--cat-purple)` — e `var(--accent)30`
// não é uma cor válida: o browser descarta a declaração inteira, sem erro nenhum
// na consola. Era assim que o anel dos pontos da cronologia, o fundo dos avatares
// e o enchimento da cadeira estavam a desaparecer sem ninguém dar por isso.
//
// `color-mix` aceita as duas formas — hex e var() — e é por isso a única maneira
// segura de compor cor num projeto onde a paleta vive em tokens. As percentagens
// abaixo são a conversão dos alfa hexadecimais que aqui estavam (0x30 ≈ 19%).
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
export const over = (color: string, pct: number, base = 'var(--bg-surface)') =>
  `color-mix(in srgb, ${color} ${pct}%, ${base})`;

export function Badge({ s, label, color, bg }: { s?: string; label?: string; color?: string; bg?: string }) {
  const { settings } = useAuth();
  const STATUS: Record<string, { label: string; bg: string; color: string }> = settings?.STATUS_META || FALLBACK_STATUS;
  const m = s
    ? STATUS[s] || { label: s, bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' }
    : { label, bg, color };
  return (
    <span className="badge" style={{ background: m.bg, color: m.color }}>
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: m.color,
          display: 'inline-block',
          marginRight: 5,
          flexShrink: 0,
        }}
      />
      {m.label}
    </span>
  );
}

export function RiskBadge({ score = 0 }) {
  const cfg =
    score >= 60
      ? ['var(--urgency-critical-bg)', 'var(--urgency-critical)', 'ALTO']
      : score >= 30
        ? ['var(--urgency-soon-bg)', 'var(--urgency-soon)', 'MÉDIO']
        : ['var(--urgency-ok-bg)', 'var(--urgency-ok)', 'BAIXO'];
  return (
    <span className="badge" style={{ background: cfg[0], color: cfg[1] }}>
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: cfg[1],
          display: 'inline-block',
          marginRight: 5,
        }}
      />
      {score}% {cfg[2]}
    </span>
  );
}

export function Card({
  children,
  className = '',
  style = {},
  onClick,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  if (!onClick) {
    return (
      <div className={`card ${className}`} style={style}>
        {children}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: children is arbitrary ReactNode (may include block content), so a native <button> isn't a safe wrapper here.
    <div
      className={`card card-interactive ${className}`}
      style={style}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e as unknown as MouseEvent<HTMLDivElement>);
        }
      }}
    >
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  sub,
  color = 'var(--accent)',
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="card p-5" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="section-label mb-2">{label}</div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color,
              lineHeight: 1.05,
              fontFamily: '"Plus Jakarta Sans",sans-serif',
            }}
          >
            {value ?? '—'}
          </div>
          {sub && (
            <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              {sub}
            </div>
          )}
        </div>
        {icon && <div style={{ fontSize: 22, opacity: 0.28 }}>{icon}</div>}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  action,
  onAction,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: 'var(--text-primary)',
            lineHeight: 1.15,
            fontFamily: '"Plus Jakarta Sans",sans-serif',
          }}
        >
          {title}
        </h1>
        {sub && (
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-secondary)' }}>
            {sub}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
        {children}
        {action && (
          <button type="button" className="btn btn-primary" onClick={onAction}>
            {action}
          </button>
        )}
      </div>
    </div>
  );
}

export function TH({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th className="data-th" style={{ textAlign: right ? 'right' : 'left' }}>
      {children}
    </th>
  );
}
export function TD({
  children,
  bold,
  color,
  mono,
  right,
  nowrap,
  muted,
}: {
  children?: ReactNode;
  bold?: boolean;
  color?: string;
  mono?: boolean;
  right?: boolean;
  nowrap?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className="data-td"
      style={{
        fontWeight: bold ? 600 : 400,
        color: muted ? 'var(--text-secondary)' : color || 'var(--text-primary)',
        fontFamily: mono ? '"JetBrains Mono",monospace' : 'inherit',
        textAlign: right ? 'right' : 'left',
        fontSize: mono ? 12 : 13,
        whiteSpace: nowrap ? 'nowrap' : 'normal',
      }}
    >
      {children}
    </td>
  );
}
export function DataTable({ cols = [], rows = [] }: { cols?: Array<string | number>; rows?: ReactNode[] }) {
  return (
    <div className="overflow-x-auto">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} className="data-th">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

interface BtnProps {
  children?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  type?: 'button' | 'submit' | 'reset';
}

export function PrimaryBtn({ children, onClick, disabled, className = '', style = {}, type = 'button' }: BtnProps) {
  return (
    <button type={type} className={`btn btn-primary ${className}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}
export function GhostBtn({ children, onClick, disabled, className = '', style = {}, type = 'button' }: BtnProps) {
  return (
    <button type={type} className={`btn btn-ghost ${className}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}
export function SecondaryBtn({ children, onClick, disabled, className = '', style = {}, type = 'button' }: BtnProps) {
  return (
    <button
      type={type}
      className={`btn btn-secondary ${className}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}
export function DangerBtn({ children, onClick, disabled, className = '', style = {}, type = 'button' }: BtnProps) {
  return (
    <button type={type} className={`btn btn-danger ${className}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

export function Inp({ style = {}, className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`input ${className}`} style={style} {...props} />;
}
export function Sel({ children, style = {}, className = '', ...props }: ComponentProps<'select'>) {
  return (
    <select className={`select ${className}`} style={style} {...props}>
      {children}
    </select>
  );
}
export function Textarea({ style = {}, className = '', ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea className={`input ${className}`} style={{ resize: 'vertical', minHeight: 80, ...style }} {...props} />
  );
}
export function FormField({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: children is always the form control (Inp/Sel/Textarea) passed by the caller */}
      <label>
        <span className="section-label block mb-1.5">{label}</span>
        {children}
      </label>
      {hint && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  width = 480,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Focus the modal content on mount and set up focus trap
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });

    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && el) {
        const focusable = el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className="modal-content bg-white rounded-lg w-full overflow-y-auto outline-none"
        style={{
          maxWidth: width,
          maxHeight: '90vh',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <h2 id="modal-title" style={{ fontSize: 16, fontWeight: 750, color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center gap-3 py-12">
      <div
        style={{
          width: 18,
          height: 18,
          border: '2.5px solid var(--border-subtle)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }}
      />
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        A carregar…
      </span>
    </div>
  );
}

export function Empty({ message = 'Sem dados', icon }: { message?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      {icon ? <div style={{ fontSize: 32, opacity: 0.3 }}>{icon}</div> : <Inbox size={32} opacity={0.3} />}
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {message}
      </p>
    </div>
  );
}

const BANNER_ICONS = {
  info: Info,
  success: Check,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

export function AlertBanner({ type = 'info', children }: { type?: string; children?: ReactNode }) {
  const t =
    {
      info: { bg: 'var(--accent-bg)', color: 'var(--accent)', border: 'var(--accent)' },
      success: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)', border: 'var(--urgency-ok-border)' },
      warning: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)', border: 'var(--urgency-soon-border)' },
      danger: {
        bg: 'var(--urgency-critical-bg)',
        color: 'var(--urgency-critical)',
        border: 'var(--urgency-critical-border)',
      },
    }[type] || {};
  const IconComp = (BANNER_ICONS as Record<string, typeof Info>)[type] || Info;
  return (
    <div
      className="rounded px-4 py-3 flex gap-3 text-sm mb-4"
      style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}` }}
    >
      <IconComp size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function AppLogo({ size = 32, className = '', style = {} }) {
  return (
    <Image
      src="/logo.svg"
      alt="Portucale Software"
      width={size}
      height={size}
      className={className}
      draggable={false}
      style={{ display: 'block', objectFit: 'contain', ...style }}
      unoptimized
    />
  );
}

export function Timeline({ events = [] }: { events?: TimelineEvent[] }) {
  if (!events.length) return <Empty message="Sem eventos na cronologia." />;
  const COL = {
    clinical: 'var(--accent)',
    admin: 'var(--text-secondary)',
    financial: 'var(--urgency-ok)',
    note: 'var(--cat-purple)',
    interaction: 'var(--cat-teal)',
  };
  return (
    <div className="relative" style={{ paddingLeft: 28 }}>
      <div className="absolute" style={{ left: 7, top: 6, bottom: 0, width: 2, background: 'var(--border-subtle)' }} />
      {events.map((e, i) => {
        const col = (COL as Record<string, string>)[e.event_type] || 'var(--text-secondary)';
        return (
          <div key={e.id ?? i} className="relative mb-5">
            <div
              className="absolute"
              style={{
                left: -21,
                top: 2,
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: col,
                border: '2px solid white',
                boxShadow: `0 0 0 2px ${tint(col, 19)}`,
              }}
            />
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)', lineHeight: 1.4 }}>
              {e.event}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {new Date(e.created_at).toLocaleString('pt-PT', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>·</span>
              <span className="text-xs font-semibold" style={{ color: col }}>
                {e.user_name}
              </span>
              <span
                className="badge"
                style={{ background: tint(col, 8), color: col, fontSize: 10, padding: '1px 6px' }}
              >
                {e.event_type}
              </span>
            </div>
            {e.hash && (
              <div
                className="text-xs mt-1"
                style={{ fontFamily: '"JetBrains Mono",monospace', color: 'var(--text-muted)', opacity: 0.6 }}
              >
                #{e.hash}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Avatar({ name = '', size = 40, color = 'var(--accent)' }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center rounded-full font-bold select-none"
      style={{
        width: size,
        height: size,
        background: tint(color, 9),
        color,
        fontSize: size * 0.36,
        fontFamily: '"Plus Jakarta Sans",sans-serif',
      }}
    >
      {initials}
    </div>
  );
}

interface TabItem {
  key: string;
  label: ReactNode;
  count?: number | null;
}

export function Tabs({ tabs, active, onChange }: { tabs: TabItem[]; active: string; onChange: (key: string) => void }) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const idx = tabs.findIndex((t) => t.key === active);
      if (idx === -1) return;
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
      onChange(tabs[next].key);
    },
    [tabs, active, onChange],
  );

  return (
    <div
      role="tablist"
      className="flex gap-1 mb-5 p-1"
      style={{ background: 'var(--bg-sunken)', display: 'inline-flex', borderRadius: 'var(--radius-card)' }}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((t) => (
        <button
          role="tab"
          type="button"
          key={t.key}
          aria-selected={active === t.key}
          tabIndex={active === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          style={{
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: active === t.key ? 650 : 550,
            borderRadius: 'var(--radius-control)',
            border: '1px solid transparent',
            cursor: 'pointer',
            background: active === t.key ? 'var(--bg-surface)' : 'transparent',
            color: active === t.key ? 'var(--accent)' : 'var(--text-secondary)',
            boxShadow: active === t.key ? 'var(--elev-1)' : 'var(--elev-0)',
            fontFamily: 'inherit',
            borderColor: active === t.key ? 'var(--border-subtle)' : 'transparent',
          }}
        >
          {t.label}
          {t.count != null && (
            <span
              className="ml-1.5 px-1.5 py-0.5 rounded text-xs"
              style={{
                background: active === t.key ? 'var(--accent-bg)' : 'var(--bg-sunken)',
                color: active === t.key ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div style={{ fontSize: 12, color: 'var(--urgency-critical)', fontWeight: 700, marginBottom: 10 }} role="alert">
      {children}
    </div>
  );
}
