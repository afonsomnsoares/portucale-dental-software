'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import SchemaFieldFormModal, { type SchemaFieldForm } from '@/components/schema/SchemaFieldFormModal';
import SchemaFieldsTable, { type SchemaFieldRow } from '@/components/schema/SchemaFieldsTable';
import { AlertBanner, GhostBtn, PageHeader, Sel } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
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

// ─── Um só ecrã de campos de registo, dois âmbitos ──────────────────────────
// Eram duas cópias com 166 de 177 linhas iguais. Esta serve as duas porque já
// distinguia os casos sozinha: `tenantId` arranca do tenant de quem está
// autenticado, o seletor de clínica está guardado por `!user?.tenantId` (logo só
// aparece a quem não tem clínica própria, isto é, ao super-admin) e o GET
// /api/tenants só é feito para role === 'super_admin' — que é também o único que
// o servidor aceita. A versão de clínica não fazia nada de diferente: fazia menos.
export default function SchemaFields() {
  const { api, user } = useAuth();

  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SchemaFieldForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [tenantId, setTenantId] = useState(user?.tenantId || '');

  useEffect(() => {
    if (user?.tenantId) setTenantId(user.tenantId);
  }, [user?.tenantId]);

  // Só o super-admin não tem clínica própria e precisa do seletor abaixo (ver o
  // guard `!user?.tenantId`) — um admin de clínica já sabe qual é a dele, e o
  // servidor recusar-lhe-ia este GET de qualquer forma.
  const tenantsQuery = useQuery<Tenant[]>(user?.role === 'super_admin' ? '/tenants' : null);
  const tenants = tenantsQuery.data ?? [];

  // O hook descarta a resposta que já não interessa quando a clínica muda a
  // meio — não é preciso um `cancelled` à mão no efeito.
  const fieldsQuery = useQuery<{ rows?: SchemaFieldRow[] } | SchemaFieldRow[]>(
    tenantId ? `/schema?tenantId=${encodeURIComponent(tenantId)}` : null,
  );
  const fieldsRaw = fieldsQuery.data;
  const fields: SchemaFieldRow[] = Array.isArray(fieldsRaw) ? fieldsRaw : (fieldsRaw?.rows ?? []);

  async function deploy(id: number) {
    setErro('');
    try {
      await api(`/schema/${id}/deploy`, { method: 'PUT' });
      fieldsQuery.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível publicar este campo.');
    }
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
    setErro('');
    try {
      await api('/schema', { method: 'POST', body: payload });
      fieldsQuery.refetch();
      setModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o campo.');
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
    setErro('');
    try {
      await api(`/schema/${editingId}`, { method: 'PUT', body: payload });
      fieldsQuery.refetch();
      setModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível guardar o campo.');
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
      setErro('');
      await api('/schema', { method: 'POST', body: { tenantId, fields: PT_PATIENT_FIELDS } });
      fieldsQuery.refetch();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível aplicar o conjunto português.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Campos de Registo"
        sub="Campos adicionais que aparecem no registo de doentes"
        action={tenantId ? '+ Novo Campo' : null}
        onAction={openAdd}
      >
        {!user?.tenantId && (
          <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ width: 260 }}>
            <option value="">Escolher clínica…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.city}
              </option>
            ))}
          </Sel>
        )}
        {tenantId && (
          <GhostBtn onClick={addPtPreset} style={{ padding: '8px 12px' }} disabled={saving}>
            {saving ? 'A adicionar…' : 'Adicionar Campos PT'}
          </GhostBtn>
        )}
      </PageHeader>
      {erro ? <AlertBanner type="danger">{erro}</AlertBanner> : null}
      {fieldsQuery.error ? (
        <AlertBanner type="danger">Não foi possível ler os campos. {fieldsQuery.error.message}</AlertBanner>
      ) : null}
      <AlertBanner type="warning">
        Os campos são por clínica. Um campo novo só passa a aparecer no registo de doentes depois de Publicar.
      </AlertBanner>
      <SchemaFieldsTable
        fields={fields}
        loading={fieldsQuery.loading}
        tenantId={tenantId}
        onEdit={openEdit}
        onDeploy={deploy}
      />
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
