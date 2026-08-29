'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import OperatoryPanel from '@/components/receptionist/OperatoryPanel';
import WaitingRoomPanel from '@/components/receptionist/WaitingRoomPanel';
import { GhostBtn, PageHeader, Spinner } from '@/components/ui';
import type { Appointment } from '@/lib/types';

function toMins(t = '00:00') {
  const p = String(t).slice(0, 5).split(':');
  return (+p[0] || 0) * 60 + (+p[1] || 0);
}

export default function LiveFloorPage() {
  const { api, settings, user } = useAuth();
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const isInitial = syncedAt == null;
    if (isInitial) setLoading(true);
    const a = await api('/appointments').catch(() => []);
    setAppts(a || []);
    setSyncedAt(new Date());
    if (isInitial) setLoading(false);
  }, [api, syncedAt]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function setStatus(apt: Appointment, nextStatus: string) {
    setUpdatingId(apt.id);
    try {
      const updated = await api(`/appointments/${apt.id}/status`, {
        method: 'PUT',
        body: { status: nextStatus },
      }).catch(() => null);
      if (updated) {
        setAppts((prev) => prev.map((a) => (a.id === apt.id ? { ...a, ...updated } : a)));
      }
    } finally {
      setUpdatingId(null);
    }
  }

  const STATUS_TRANSITIONS = settings?.STATUS_TRANSITIONS || {};
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const syncedLabel = syncedAt ? syncedAt.toTimeString().slice(0, 5) : '';

  const todays = useMemo(() => {
    return (appts || []).slice().sort((a, b) => toMins(a.start_time) - toMins(b.start_time));
  }, [appts]);

  const active = useMemo(() => {
    return todays.filter((a) => !['departed', 'no-show'].includes(a.status));
  }, [todays]);

  const waiting = useMemo(() => {
    return todays.filter((a) => ['registered', 'waiting'].includes(a.status));
  }, [todays]);

  const chairs = useMemo(() => {
    const n = Math.max(1, Number(user?.operatories || 3));
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [user?.operatories]);

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Live Floor"
        sub={`${active.length} appointment${active.length !== 1 ? 's' : ''} active · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}${syncedLabel ? ` · synced ${syncedLabel}` : ''}`}
      >
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Refresh
        </GhostBtn>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <OperatoryPanel
            chairs={chairs}
            todays={todays}
            nowMins={nowMins}
            statusTransitions={STATUS_TRANSITIONS}
            updatingId={updatingId}
            onSetStatus={setStatus}
          />
          <WaitingRoomPanel waiting={waiting} />
        </div>
      </div>
    </div>
  );
}
