'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import SchemaFieldFormModal, { type SchemaFieldForm } from '@/components/admin/SchemaFieldFormModal';
import SchemaFieldsTable, { type SchemaFieldRow } from '@/components/admin/SchemaFieldsTable';
import { AlertBanner, GhostBtn, PageHeader, Sel } from '@/components/ui';
import { PT_PATIENT_FIELDS } from '@/lib/presets/patientFields';
import type { Tenant } from '@/lib/types';

const EMPTY_FORM: SchemaFieldForm = {
  fieldName: '',
  label: '',
  description: '',
  fieldType: 'string',
  enumText: '',
  required: false,
};

export default function SchemaPage() {
  const { api, user } = useAuth();
  const [fields, setFields] = useState<SchemaFieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SchemaFieldForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState(user?.tenantId || '');

  useEffect(() => {
    if (user?.tenantId) setTenantId(user.tenantId);
  }, [user?.tenantId]);

  useEffect(() => {
    // Only the super_admin has no tenant of their own and needs the tenant picker below
    // (see the `!user?.tenantId` guard around it) — a clinic admin already knows theirs.
    if (user?.role !== 'super_admin') return;
    api('/tenants')
      .then(setTenants)
      .catch(() => {});
  }, [api, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!tenantId) {
          setFields([]);
          return;
        }
        const res = await api(`/schema?tenantId=${encodeURIComponent(tenantId)}`);
        if (!cancelled) setFields(res?.rows || res || []);
      } catch {
        if (!cancelled) setFields([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, tenantId]);

  async function deploy(id: number) {
    const f = await api(`/schema/${id}/deploy`, { method: 'PUT' }).catch(() => null);
    if (f) setFields((prev) => prev.map((x) => (x.id === id ? f : x)));
  }

  async function addField() {
    setSaving(true);
    const enumValues =
      form.fieldType === 'enum'
        ? form.enumText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    const payload = {
      fieldName: form.fieldName,
      label: form.label,
      description: form.description,
      fieldType: form.fieldType,
      enumValues,
      required: form.required,
      tenantId,
    };
    const res = await api('/schema', { method: 'POST', body: payload }).catch(() => null);
    const created = res?.rows?.[0] || null;
    if (created) {
      setFields((p) => [...p, created]);
      setModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
    setSaving(false);
  }

  async function saveField() {
    setSaving(true);
    const enumValues =
      form.fieldType === 'enum'
        ? form.enumText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    const payload = {
      label: form.label,
      description: form.description,
      fieldType: form.fieldType,
      enumValues,
      required: form.required,
    };
    const f = await api(`/schema/${editingId}`, { method: 'PUT', body: payload }).catch(() => null);
    if (f) {
      setFields((prev) => prev.map((x) => (x.id === f.id ? f : x)));
      setModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
    setSaving(false);
  }

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModal(true);
  }

  function openEdit(f: SchemaFieldRow) {
    setEditingId(f.id);
    const ev = Array.isArray(f.enum_values) ? f.enum_values : f.enum_values ? Object.values(f.enum_values) : [];
    setForm({
      fieldName: f.field_name,
      label: f.label || '',
      description: f.description || '',
      fieldType: f.field_type,
      enumText: (ev || []).join(', '),
      required: !!f.required,
    });
    setModal(true);
  }

  async function addPtPreset() {
    if (!tenantId) {
      return;
    }
    setSaving(true);
    try {
      await api('/schema', { method: 'POST', body: { tenantId, fields: PT_PATIENT_FIELDS } });
      const res = await api(`/schema?tenantId=${encodeURIComponent(tenantId)}`).catch(() => null);
      setFields(res?.rows || res || []);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Schema Fields"
        sub="Define extra fields that appear on patient registration"
        action={tenantId ? '+ Add Field' : null}
        onAction={openAdd}
      >
        {!user?.tenantId && (
          <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ width: 260 }}>
            <option value="">Select clinic…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.city}
              </option>
            ))}
          </Sel>
        )}
        {tenantId && (
          <GhostBtn onClick={addPtPreset} style={{ padding: '8px 12px' }} disabled={saving}>
            {saving ? 'Adding…' : 'Adicionar Campos PT'}
          </GhostBtn>
        )}
      </PageHeader>
      <AlertBanner type="warning">
        Fields are configured per clinic. Use Publish to activate a field for the selected clinic.
      </AlertBanner>
      <SchemaFieldsTable fields={fields} loading={loading} tenantId={tenantId} onEdit={openEdit} onDeploy={deploy} />
      {modal && (
        <SchemaFieldFormModal
          editingId={editingId}
          form={form}
          onChange={setForm}
          onSave={editingId ? saveField : addField}
          saving={saving}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}
