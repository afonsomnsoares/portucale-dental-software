'use client';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import EfficiencyTab from '@/components/receptionist/EfficiencyTab';
import HeatmapTab from '@/components/receptionist/HeatmapTab';
import OptimizerTab from '@/components/receptionist/OptimizerTab';
import PendingOffersTable from '@/components/receptionist/PendingOffersTable';
import RiskTab from '@/components/receptionist/RiskTab';
import WaitlistCreateModal, {
  EMPTY_WAITLIST_FORM,
  type NewWaitlistForm,
} from '@/components/receptionist/WaitlistCreateModal';
import WaitlistEntriesTable from '@/components/receptionist/WaitlistEntriesTable';
import { GhostBtn, PageHeader, PrimaryBtn, Spinner, Tabs } from '@/components/ui';
import type {
  AgendaEfficiency,
  Patient,
  RiskData,
  RiskHeatmapData,
  ScheduleOptimization,
  SlotOffer,
  WaitlistData,
  WaitlistEntry,
} from '@/lib/types';

export default function ScheduleIntelReceptionistPage() {
  const { api } = useAuth();
  const [tab, setTab] = useState('risk');

  const [risk, setRisk] = useState<RiskData | null>(null);
  const [heatmap, setHeatmap] = useState<RiskHeatmapData | null>(null);
  const [efficiency, setEfficiency] = useState<AgendaEfficiency | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistData | null>(null);
  const [optimization, setOptimization] = useState<ScheduleOptimization | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [dentists, setDentists] = useState<Array<{ id: string; name: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<NewWaitlistForm>(EMPTY_WAITLIST_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    const [r, h, e, w, o] = await Promise.all([
      api('/schedule-intel/risk?days=14').catch((err) => {
        setErr(err instanceof Error ? err.message : 'Falha ao carregar');
        return null;
      }),
      api('/schedule-intel/heatmap').catch(() => null),
      api('/schedule-intel/efficiency?days=14').catch(() => null),
      api('/waitlist').catch(() => null),
      api('/schedule-intel/optimizer?days=14').catch(() => null),
    ]);
    setRisk(r);
    setHeatmap(h);
    setEfficiency(e);
    setWaitlist(w);
    setOptimization(o);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api('/patients?q=')
      .then((d) => setPatients(d || []))
      .catch(() => {});
    api('/dentists')
      .then((d) => setDentists(d || []))
      .catch(() => {});
  }, [api]);

  function patientName(id: string) {
    return patients.find((p) => p.id === id)?.name || id?.slice(0, 8) || '—';
  }

  async function respondOffer(offer: SlotOffer, action: 'book' | 'decline') {
    setBusyId(offer.id);
    await api(`/waitlist/${offer.waitlist_entry_id}/offers/${offer.id}`, { method: 'PUT', body: { action } }).catch(
      () => null,
    );
    setBusyId(null);
    load();
  }

  async function cancelEntry(entry: WaitlistEntry) {
    setBusyId(entry.id);
    await api(`/waitlist/${entry.id}`, { method: 'PUT', body: { status: 'cancelled' } }).catch(() => null);
    setBusyId(null);
    load();
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.patientId || !form.treatmentType) return;
    setSaving(true);
    await api('/waitlist', {
      method: 'POST',
      body: {
        patientId: form.patientId,
        treatmentType: form.treatmentType,
        preferredDentistId: form.preferredDentistId || null,
        preferredDays: form.preferredDays.length ? form.preferredDays : null,
        preferredTimeStart: form.preferredTimeStart || null,
        preferredTimeEnd: form.preferredTimeEnd || null,
        minDuration: Number(form.minDuration) || 30,
        maxWaitUntil: form.maxWaitUntil || null,
        notes: form.notes,
      },
    }).catch(() => null);
    setSaving(false);
    setModal(false);
    setForm(EMPTY_WAITLIST_FORM);
    load();
  }

  const highRiskCount = risk?.highRisk?.length || 0;

  return (
    <div>
      <PageHeader title="Agenda Inteligente" sub="Previsão de faltas, eficiência da agenda e lista de espera">
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {err && (
        <div
          className="card p-4 mb-4"
          style={{ border: '1px solid #FFBDAD', background: '#FFEBE6', color: '#DE350B', fontWeight: 700 }}
        >
          {err}
        </div>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'risk', label: 'Risco', count: highRiskCount || undefined },
          { key: 'heatmap', label: 'Heatmap' },
          { key: 'efficiency', label: 'Eficiência' },
          { key: 'optimizer', label: 'Otimizador', count: optimization?.totals.moves || undefined },
          { key: 'waitlist', label: 'Lista de Espera', count: waitlist?.pendingOffers?.length || undefined },
        ]}
      />

      {loading ? (
        <Spinner />
      ) : (
        <>
          {tab === 'risk' && <RiskTab appointments={risk?.appointments || []} />}
          {tab === 'heatmap' && <HeatmapTab heatmap={heatmap} />}
          {tab === 'efficiency' && <EfficiencyTab efficiency={efficiency} />}
          {tab === 'optimizer' && <OptimizerTab optimization={optimization} />}

          {tab === 'waitlist' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  {waitlist?.entries?.length || 0} na lista · {waitlist?.pendingOffers?.length || 0} ofertas pendentes
                </span>
                <PrimaryBtn onClick={() => setModal(true)}>+ Adicionar à lista de espera</PrimaryBtn>
              </div>

              <PendingOffersTable
                offers={waitlist?.pendingOffers || []}
                busyId={busyId}
                onRespond={respondOffer}
                patientName={patientName}
              />

              <div className="section-label mb-2">Lista de espera</div>
              <WaitlistEntriesTable entries={waitlist?.entries || []} busyId={busyId} onCancel={cancelEntry} />
            </div>
          )}
        </>
      )}

      {modal && (
        <WaitlistCreateModal
          form={form}
          onChange={setForm}
          onSubmit={handleCreate}
          saving={saving}
          patients={patients}
          dentists={dentists}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}
