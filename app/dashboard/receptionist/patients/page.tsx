'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import PatientCreateModal, { type NewPatientForm } from '@/components/receptionist/PatientCreateModal';
import PatientEditExtraFieldsModal from '@/components/receptionist/PatientEditExtraFieldsModal';
import PatientImportCsvModal from '@/components/receptionist/PatientImportCsvModal';
import PatientDetailHeader from '@/components/shared/PatientDetailHeader';
import PatientOverviewTab from '@/components/shared/PatientOverviewTab';
import PatientsSidebarList from '@/components/shared/PatientsSidebarList';
import type { SchemaField } from '@/components/shared/SchemaFieldInput';
import { Empty, GhostBtn, PageHeader, Spinner, Tabs, Timeline } from '@/components/ui';
import type { Patient, TimelineEvent } from '@/lib/types';

const EMPTY_NEW_PATIENT: NewPatientForm = { name: '', dob: '', phone: '', email: '', insurance: '', alerts: '' };

export default function ReceptionPatientsPage() {
  const { api } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tab, setTab] = useState('profile');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [tlLoad, setTlLoad] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<NewPatientForm>(EMPTY_NEW_PATIENT);
  const [saving, setSaving] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [editExtra, setEditExtra] = useState(false);
  const [extraSaving, setExtraSaving] = useState(false);
  const [extraForm, setExtraForm] = useState<Record<string, unknown>>({});
  const [importOpen, setImportOpen] = useState(false);

  const select = useCallback(
    async (p: Patient) => {
      setSelected(p);
      setTab('profile');
      setTlLoad(true);
      const tl = await api(`/patients/${p.id}/timeline`).catch(() => []);
      setTimeline(tl || []);
      setTlLoad(false);
    },
    [api],
  );

  const loadPts = useCallback(async () => {
    setLoading(true);
    const d = await api(`/patients?q=${encodeURIComponent(search)}`).catch(() => []);
    setPatients(d || []);
    if (!selected && d?.length) select(d[0]);
    setLoading(false);
  }, [api, search, selected, select]);

  const loadSchemaFields = useCallback(() => {
    api('/schema')
      .then((d) => setSchemaFields((d || []).filter((f: SchemaField) => Number(f.rollout || 0) === 100)))
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    const t = setTimeout(loadPts, 300);
    return () => clearTimeout(t);
  }, [loadPts]);
  useEffect(() => {
    loadSchemaFields();
  }, [loadSchemaFields]);

  async function create() {
    setCreateErr('');
    const required = (schemaFields || []).filter((f) => !!f.required);
    const payloadCustom: Record<string, unknown> = { ...(customFields || {}) };
    const missing: string[] = [];

    for (const f of required) {
      const key = f.field_name;
      const t = String(f.field_type || 'string');
      const v = payloadCustom[key];
      if (v === undefined || v === null || v === '') {
        if (t === 'boolean') payloadCustom[key] = false;
        else missing.push(f.label || f.field_name);
      }
    }

    if (!form.name?.trim()) {
      setCreateErr('Patient name is required.');
      return;
    }
    if (missing.length) {
      setCreateErr(`Fill the required fields: ${missing.join(', ')}`);
      return;
    }

    setSaving(true);
    try {
      const alerts = form.alerts
        ? form.alerts
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
        : [];
      const p = await api('/patients', { method: 'POST', body: { ...form, alerts, customFields: payloadCustom } });
      setPatients((prev) => [p, ...prev]);
      setModal(false);
      setForm(EMPTY_NEW_PATIENT);
      setCustomFields({});
      select(p);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Failed to register patient.');
    } finally {
      setSaving(false);
    }
  }

  function openEditExtra() {
    const current = selected?.custom_fields && typeof selected.custom_fields === 'object' ? selected.custom_fields : {};
    setExtraForm({ ...current });
    setEditExtra(true);
  }

  async function saveExtra() {
    if (!selected) return;
    setExtraSaving(true);
    const updated = await api(`/patients/${selected.id}`, {
      method: 'PUT',
      body: { ...selected, customFields: extraForm },
    }).catch(() => null);
    if (updated) {
      setSelected(updated);
      setPatients((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
      setEditExtra(false);
    }
    setExtraSaving(false);
  }

  const TABS = [
    { key: 'profile', label: 'Profile' },
    { key: 'timeline', label: 'Timeline' },
  ];

  return (
    <div>
      <PageHeader
        title="Patient Registrar"
        sub="Global Identity Registry — search and manage all patients"
        action="+ Register Patient"
        onAction={() => setModal(true)}
      >
        <GhostBtn onClick={() => setImportOpen(true)} style={{ padding: '8px 12px' }}>
          Import CSV
        </GhostBtn>
      </PageHeader>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <PatientsSidebarList
          patients={patients}
          selectedId={selected?.id}
          onSelect={select}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
        />

        {selected ? (
          <div>
            <PatientDetailHeader patient={selected} />

            <Tabs tabs={TABS} active={tab} onChange={setTab} />

            {tab === 'profile' ? (
              <PatientOverviewTab
                fields={[
                  ['Phone', selected.phone || '—'],
                  ['Email', selected.email || '—'],
                  ['Last Visit', selected.last_visit?.slice(0, 10) || '—'],
                  ['Insurance', selected.insurance || '—'],
                  ['DOB', selected.dob?.slice(0, 10) || '—'],
                  ['Total Visits', selected.visit_count || 0],
                ]}
                customFields={selected.custom_fields}
                schemaFields={schemaFields}
                onEditExtra={openEditExtra}
              />
            ) : (
              <div className="card p-5">
                <div className="section-label mb-4">MASTER PATIENT TIMELINE — IMMUTABLE · SHA-256 HASHED</div>
                {tlLoad ? <Spinner /> : <Timeline events={timeline} />}
              </div>
            )}
          </div>
        ) : (
          <Empty message="Select a patient to view their record" />
        )}
      </div>

      {modal && (
        <PatientCreateModal
          form={form}
          onChange={setForm}
          customFields={customFields}
          onCustomFieldsChange={setCustomFields}
          schemaFields={schemaFields}
          error={createErr}
          saving={saving}
          onSave={create}
          onClose={() => setModal(false)}
        />
      )}

      {editExtra && (
        <PatientEditExtraFieldsModal
          schemaFields={schemaFields}
          extraForm={extraForm}
          onChange={setExtraForm}
          saving={extraSaving}
          onSave={saveExtra}
          onClose={() => setEditExtra(false)}
        />
      )}

      {importOpen && (
        <PatientImportCsvModal
          api={api}
          onImported={() => {
            loadSchemaFields();
            loadPts();
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
