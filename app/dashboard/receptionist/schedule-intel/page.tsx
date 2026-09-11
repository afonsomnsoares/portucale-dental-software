'use client';
import type { FormEvent } from 'react';
import { useCallback, useState } from 'react';
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
import { AlertBanner, ErrorState, GhostBtn, PageHeader, PrimaryBtn, Spinner, Tabs } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
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

  // Cinco leituras independentes, uma por separador — como na versão de clínica
  // (components/clinic/pages/ScheduleIntel.tsx), e pela mesma razão: um destino
  // comum faria qualquer uma delas a falhar parar as outras quatro.
  const riskQuery = useQuery<RiskData>('/schedule-intel/risk?days=14');
  const heatmapQuery = useQuery<RiskHeatmapData>('/schedule-intel/heatmap');
  const efficiencyQuery = useQuery<AgendaEfficiency>('/schedule-intel/efficiency?days=14');
  const waitlistQuery = useQuery<WaitlistData>('/waitlist');
  const optimizationQuery = useQuery<ScheduleOptimization>('/schedule-intel/optimizer?days=14');
  const patientsQuery = useQuery<Patient[]>('/patients?q=');
  const dentistsQuery = useQuery<Array<{ id: string; name: string }>>('/dentists');

  const risk = riskQuery.data ?? null;
  const heatmap = heatmapQuery.data ?? null;
  const efficiency = efficiencyQuery.data ?? null;
  const waitlist = waitlistQuery.data ?? null;
  const optimization = optimizationQuery.data ?? null;
  const patients = patientsQuery.data ?? [];
  const dentists = dentistsQuery.data ?? [];

  const [erroEscrita, setErroEscrita] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<NewWaitlistForm>(EMPTY_WAITLIST_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    riskQuery.refetch();
    heatmapQuery.refetch();
    efficiencyQuery.refetch();
    waitlistQuery.refetch();
    optimizationQuery.refetch();
  }, [riskQuery, heatmapQuery, efficiencyQuery, waitlistQuery, optimizationQuery]);

  // O ecrã espera só pelo separador que está aberto; os outros carregam por baixo.
  const queryDoSeparador = {
    risk: riskQuery,
    heatmap: heatmapQuery,
    efficiency: efficiencyQuery,
    optimizer: optimizationQuery,
    waitlist: waitlistQuery,
  }[tab];

  function patientName(id: string) {
    return patients.find((p) => p.id === id)?.name || id?.slice(0, 8) || '—';
  }

  async function respondOffer(offer: SlotOffer, action: 'book' | 'decline') {
    setBusyId(offer.id);
    setErroEscrita('');
    try {
      await api(`/waitlist/${offer.waitlist_entry_id}/offers/${offer.id}`, { method: 'PUT', body: { action } });
      load();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível responder a esta oferta.');
    }
    setBusyId(null);
  }

  async function cancelEntry(entry: WaitlistEntry) {
    setBusyId(entry.id);
    setErroEscrita('');
    try {
      await api(`/waitlist/${entry.id}`, { method: 'PUT', body: { status: 'cancelled' } });
      load();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível cancelar esta entrada.');
    }
    setBusyId(null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.patientId || !form.treatmentType) return;
    setSaving(true);
    setErroEscrita('');
    try {
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
      });
      setModal(false);
      setForm(EMPTY_WAITLIST_FORM);
      load();
    } catch (err) {
      setErroEscrita(err instanceof Error ? err.message : 'Não foi possível pôr o doente em lista de espera.');
    }
    setSaving(false);
  }

  const highRiskCount = risk?.highRisk?.length || 0;

  return (
    <div>
      <PageHeader title="Agenda Inteligente" sub="Previsão de faltas, eficiência da agenda e lista de espera">
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'risk', label: 'Risco', count: highRiskCount || undefined },
          { key: 'heatmap', label: 'Mapa de calor' },
          { key: 'efficiency', label: 'Eficiência' },
          { key: 'optimizer', label: 'Otimizador', count: optimization?.totals.moves || undefined },
          { key: 'waitlist', label: 'Lista de Espera', count: waitlist?.pendingOffers?.length || undefined },
        ]}
      />

      {queryDoSeparador?.error ? (
        <ErrorState
          error={queryDoSeparador.error}
          onRetry={queryDoSeparador.refetch}
          message="Não foi possível carregar este separador."
        />
      ) : queryDoSeparador?.loading ? (
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
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
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
