'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import SchemaFieldFormModal, { type SchemaFieldForm } from '@/components/schema/SchemaFieldFormModal';
import SchemaFieldsTable, { type SchemaFieldRow } from '@/components/schema/SchemaFieldsTable';
import { AlertBanner, GhostBtn, PageHeader } from '@/components/ui';
import { PT_PATIENT_FIELDS } from '@/lib/presets/patientFields';

const EMPTY_FORM: SchemaFieldForm = {
  fieldName: '',
  label: '',
  description: '',
  fieldType: 'string',
  enumText: '',
  required: false,
};

// Campos de schema da própria clínica. A versão de plataforma
// (components/super-admin/pages/Schema.tsx) escolhe a clínica; aqui o tenant é sempre o de
// quem está autenticado.
export default function ClinicSchemaPage() {
  const { api, user } = useAuth();
  const tenantId = user?.tenantId || '';
  const [fields, setFields] = useState<SchemaFieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SchemaFieldForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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
        title="Campos de Registo"
        sub="Campos adicionais que aparecem no registo de doentes desta clínica"
        action={tenantId ? '+ Novo Campo' : null}
        onAction={openAdd}
      >
        {tenantId && (
          <GhostBtn onClick={addPtPreset} style={{ padding: '8px 12px' }} disabled={saving}>
            {saving ? 'A adicionar…' : 'Adicionar Campos PT'}
          </GhostBtn>
        )}
      </PageHeader>
      <AlertBanner type="warning">
        Um campo novo só passa a aparecer no registo de doentes depois de Publicar.
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
