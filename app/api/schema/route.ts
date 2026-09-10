import { appendAudit } from '@/lib/audit';
import { forbidden, requireRoles } from '@/lib/auth';
import { query, warnSchemaGap, withTransaction } from '@/lib/db';
import { withRoute } from '@/lib/route';

async function safeQuery(sql: string, params: unknown[] = []) {
  try {
    return await query(sql, params);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '42703' || code === '42P01') {
      warnSchemaGap('schema_fields', e);
      return null;
    }
    throw e;
  }
}

export const GET = withRoute(
  {
    authOnly:
      'Definição dos campos do formulário de doente da própria clínica — é o que a interface precisa para se desenhar',
    tenant: 'resolved',
  },
  async ({ tenantId }) => {
    if (!tenantId) {
      const legacy = await safeQuery(`SELECT * FROM schema_fields ORDER BY id`);
      return Response.json(legacy || []);
    }
    const tenantRows = await safeQuery(`SELECT * FROM schema_fields WHERE tenant_id=$1 ORDER BY id`, [tenantId]);
    if (tenantRows?.length) return Response.json(tenantRows);
    const globalRows = await safeQuery(`SELECT * FROM schema_fields WHERE tenant_id IS NULL ORDER BY id`);
    if (globalRows) return Response.json(globalRows);
    const legacy = await safeQuery(`SELECT * FROM schema_fields ORDER BY id`);
    return Response.json(legacy || []);
  },
);

export const POST = withRoute(
  { permission: 'schema:manage', tenant: 'resolved' },
  async ({ request, user, tenantId }) => {
    if (!requireRoles(user, 'admin', 'super_admin')) return forbidden();
    const body = await request.json();
    const { fieldName, fieldType, required, label, description, enumValues } = body || {};

    const allowedTypes = new Set(['string', 'boolean', 'integer', 'decimal', 'enum', 'uuid_ref']);
    const clampRollout = (n: unknown) => {
      const x = Number(n);
      if (!Number.isFinite(x)) return 0;
      return Math.max(0, Math.min(100, Math.trunc(x)));
    };

    const fields = Array.isArray(body?.fields) ? body.fields : null;
    const items = fields
      ? fields.map((f: Record<string, unknown>) => ({
          fieldName: String(f?.fieldName || '').trim(),
          fieldType: allowedTypes.has(String(f?.fieldType || 'string')) ? String(f.fieldType) : 'string',
          required: !!f?.required,
          label: f?.label ? String(f.label) : null,
          description: f?.description ? String(f.description) : null,
          enumValues: Array.isArray(f?.enumValues) ? f.enumValues.filter(Boolean).map(String) : null,
          rollout: clampRollout(f?.rollout ?? body?.rollout ?? 0),
        }))
      : [
          {
            fieldName: String(fieldName || '').trim(),
            fieldType: allowedTypes.has(String(fieldType || 'string')) ? String(fieldType) : 'string',
            required: !!required,
            label: label ? String(label) : null,
            description: description ? String(description) : null,
            enumValues: Array.isArray(enumValues) ? enumValues.filter(Boolean).map(String) : null,
            rollout: clampRollout(body?.rollout ?? 0),
          },
        ];

    for (const it of items) {
      if (!it.fieldName) return Response.json({ error: 'fieldName is required' }, { status: 400 });
    }

    const inserted = await withTransaction(async (client) => {
      const out = [];
      for (const it of items) {
        const nextEnum = it.fieldType !== 'enum' ? null : it.enumValues ? JSON.stringify(it.enumValues) : null;
        const pushedAt = it.rollout === 100 ? 'CURRENT_DATE' : 'NULL';
        const insertSqlWithTenant = `
        INSERT INTO schema_fields (tenant_id, field_name, label, description, field_type, enum_values, required, rollout, pushed_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,${pushedAt})
        ON CONFLICT DO NOTHING
        RETURNING *
      `;
        const insertSqlLegacy = `
        INSERT INTO schema_fields (field_name, label, description, field_type, enum_values, required, rollout, pushed_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,${pushedAt})
        ON CONFLICT DO NOTHING
        RETURNING *
      `;

        let rows = null;
        try {
          const res = await client.query(insertSqlWithTenant, [
            tenantId || null,
            it.fieldName,
            it.label,
            it.description,
            it.fieldType,
            nextEnum,
            it.required,
            it.rollout,
          ]);
          rows = res.rows || [];
        } catch (e) {
          if ((e as { code?: string })?.code !== '42703') throw e;
          const res = await client.query(insertSqlLegacy, [
            it.fieldName,
            it.label,
            it.description,
            it.fieldType,
            nextEnum,
            it.required,
            it.rollout,
          ]);
          rows = res.rows || [];
        }
        if (rows[0]) out.push(rows[0]);
      }
      return out;
    });

    await appendAudit(user, 'CREATE', `Schema fields: ${items.length}`, null, `tenant ${tenantId || 'global'}`);
    return Response.json({ created: inserted.length, rows: inserted }, { status: 201 });
  },
);
