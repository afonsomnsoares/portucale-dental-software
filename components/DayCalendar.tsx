'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import type { Appointment } from '@/lib/types';
import { Badge, RiskBadge } from './ui';

// Some callers still pass legacy `time`/`patient` keys alongside the real columns.
type CalendarAppointment = Appointment & { time?: string; patient?: string };

const HOURS = Array.from({ length: 11 }, (_, i) => i + 7); // 07:00 – 17:00
const PX_PER_HOUR = 72;

function toMins(t = '00:00') {
  const p = String(t).split(':');
  return +p[0] * 60 + +p[1];
}
function minsToTop(m: number, start = 7) {
  return (m - start * 60) * (PX_PER_HOUR / 60);
}

interface DayCalendarProps {
  appointments?: CalendarAppointment[];
  date?: string;
  onStatusChange?: (id: string, nextStatus: string) => Promise<void> | void;
}

export default function DayCalendar({ appointments = [], date, onStatusChange }: DayCalendarProps) {
  const { settings } = useAuth();
  const [selected, setSelected] = useState<CalendarAppointment | null>(null);
  const [loading, setLoading] = useState(false);

  const STATUS_COLOR = useMemo(() => {
    const map: Record<string, string> = {};
    if (!settings?.STATUS_META) return map;
    for (const [k, v] of Object.entries(settings.STATUS_META)) {
      map[k] = v.color;
    }
    return map;
  }, [settings?.STATUS_META]);

  const NEXT = useMemo(() => {
    const map: Record<string, string> = {};
    if (!settings?.STATUS_TRANSITIONS) return map;
    for (const [k, v] of Object.entries(settings.STATUS_TRANSITIONS)) {
      if (v && v.length > 0) map[k] = v[0];
    }
    return map;
  }, [settings?.STATUS_TRANSITIONS]);

  async function advance(apt: CalendarAppointment) {
    const next = NEXT[apt.status];
    if (!next || !onStatusChange) return;
    setLoading(true);
    await onStatusChange(apt.id, next);
    setLoading(false);
    setSelected((s) => (s?.id === apt.id ? { ...s, status: next } : s));
  }

  const totalHeight = HOURS.length * PX_PER_HOUR;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const nowTop = minsToTop(nowMins);
  const showNow = nowTop >= 0 && nowTop <= totalHeight;

  return (
    <div className="flex gap-4">
      <div className="card flex-1 overflow-hidden">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '56px 1fr',
            borderBottom: '2px solid #DFE1E6',
            background: 'white',
          }}
        >
          <div className="px-3 py-3 text-xs font-bold text-ink-secondary">{date ? date.slice(5) : 'TODAY'}</div>
          <div
            className="py-3 px-3 text-xs font-bold"
            style={{ color: '#0052CC', borderLeft: '1px solid #EBECF0', letterSpacing: '0.06em' }}
          >
            LIVE AGENDA
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)', position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            {HOURS.map((h) => (
              <div
                key={h}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '56px 1fr',
                  height: PX_PER_HOUR,
                  borderBottom: '1px solid #EBECF0',
                }}
              >
                <div
                  className="text-xs font-mono text-ink-tertiary pt-2 pl-3"
                  style={{ borderRight: '1px solid #EBECF0' }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
                <div style={{ borderLeft: '1px solid #EBECF0', position: 'relative' }} />
              </div>
            ))}

            {HOURS.map((h) => (
              <div
                key={`h${h}`}
                style={{
                  position: 'absolute',
                  left: 56,
                  right: 0,
                  borderBottom: '1px dashed #EBECF0',
                  pointerEvents: 'none',
                  height: 0,
                  top: (h - 7) * PX_PER_HOUR + PX_PER_HOUR / 2,
                }}
              />
            ))}

            {showNow && (
              <div style={{ position: 'absolute', left: 56, right: 0, top: nowTop, zIndex: 10, pointerEvents: 'none' }}>
                <div style={{ height: 2, background: '#DE350B', position: 'relative' }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: -6,
                      top: -4,
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#DE350B',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: 4,
                      top: -9,
                      background: '#DE350B',
                      color: 'white',
                      fontSize: 9,
                      fontWeight: 700,
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontFamily: '"JetBrains Mono",monospace',
                    }}
                  >
                    {now.toTimeString().slice(0, 5)}
                  </div>
                </div>
              </div>
            )}

            <div style={{ position: 'absolute', top: 0, left: 56, right: 0, bottom: 0, pointerEvents: 'none' }}>
              {appointments.map((apt, idx) => {
                const startMins = toMins(apt.start_time || apt.time || '09:00');
                const top = minsToTop(startMins);
                const height = Math.max((apt.duration || 30) * (PX_PER_HOUR / 60), 36);
                const stColor = STATUS_COLOR[apt.status] || '#0052CC';
                const isSelected = selected?.id === apt.id;
                const laneOffset = (idx % 2) * 8;
                return (
                  <button
                    type="button"
                    key={apt.id}
                    onClick={() => setSelected(apt)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(apt);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      top,
                      left: 4 + laneOffset,
                      right: 4 + (idx % 2 ? 0 : 8),
                      height,
                      font: 'inherit',
                      textAlign: 'left',
                      background: `${stColor}10`,
                      borderRadius: '0 6px 6px 0',
                      borderStyle: 'solid',
                      borderLeftStyle: 'solid',
                      borderLeftColor: stColor,
                      borderLeftWidth: 3,
                      borderTopColor: isSelected ? stColor : `${stColor}30`,
                      borderRightColor: isSelected ? stColor : `${stColor}30`,
                      borderBottomColor: isSelected ? stColor : `${stColor}30`,
                      borderTopWidth: isSelected ? 2 : 1,
                      borderRightWidth: isSelected ? 2 : 1,
                      borderBottomWidth: isSelected ? 2 : 1,
                      padding: '6px 8px',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      pointerEvents: 'all',
                      transition: 'all 0.12s',
                      boxShadow: isSelected ? `0 2px 8px ${stColor}30` : 'none',
                      zIndex: isSelected ? 3 : 2,
                    }}
                  >
                    <div className="text-xs font-bold truncate" style={{ color: '#172B4D', lineHeight: 1.3 }}>
                      {apt.patient_name || apt.patient}
                    </div>
                    {height > 44 && (
                      <div className="text-xs truncate mt-0.5" style={{ color: '#5E6C84' }}>
                        {apt.type}
                      </div>
                    )}
                    {height > 58 && (
                      <div className="mt-1">
                        <span
                          className="badge"
                          style={{ fontSize: 9, padding: '1px 5px', background: `${stColor}18`, color: stColor }}
                        >
                          {apt.status?.replace(/-/g, ' ')}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <div
          className="card"
          style={{
            width: 268,
            flexShrink: 0,
            padding: '20px',
            borderTop: `3px solid ${STATUS_COLOR[selected.status] || '#0052CC'}`,
            alignSelf: 'start',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold" style={{ color: '#172B4D' }}>
              Appointment
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{ background: 'transparent', border: 'none', fontSize: 18, color: '#97A0AF', cursor: 'pointer' }}
            >
              ×
            </button>
          </div>

          {[
            ['Patient', selected.patient_name || selected.patient],
            ['Dentist', selected.dentist_name || '—'],
            ['Type', selected.type],
            ['Time', String(selected.start_time || selected.time || '').slice(0, 5)],
            ['Duration', `${selected.duration || 30} min`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-2" style={{ borderBottom: '1px solid #F4F7FA' }}>
              <span className="text-xs font-medium" style={{ color: '#5E6C84' }}>
                {k}
              </span>
              <span className="text-xs font-semibold" style={{ color: '#172B4D' }}>
                {v}
              </span>
            </div>
          ))}

          <div className="mt-3 flex flex-col gap-2">
            <Badge s={selected.status} />
            {(selected.risk_score || 0) > 0 && <RiskBadge score={selected.risk_score || 0} />}
          </div>

          {(selected.risk_score || 0) >= 60 && (
            <div
              className="mt-3 rounded p-3 text-xs"
              style={{ background: '#FFEBE6', color: '#DE350B', border: '1px solid #FFBDAD', lineHeight: 1.6 }}
            >
              <strong>Action required:</strong> High no-show risk. Call patient to confirm.
            </div>
          )}

          {NEXT[selected.status] && (
            <button
              type="button"
              onClick={() => advance(selected)}
              disabled={loading}
              className="btn btn-primary mt-4"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {loading ? 'Updating…' : `→ Move to ${(NEXT[selected.status] || '').replace(/-/g, ' ')}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
