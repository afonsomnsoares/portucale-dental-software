import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { forbidden, getAuth, requireRoles, requireSameOrigin, type SessionUser, unauthorized } from '@/lib/auth';
import { query, warnSchemaGap, withTransaction } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

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

function resolveTenantId(request: NextRequest, user: SessionUser | null | undefined, bodyTenantId: unknown) {
  if (user?.tenantId) return user.tenantId;
  const url = new URL(request.url);
  const qsTenantId = url.searchParams.get('tenantId');
  return bodyTenantId || qsTenantId || null;
}

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  const tenantId = resolveTenantId(request, user, null);
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
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!requireRoles(user, 'admin')) return forbidden();
  if (!(await hasPermission(user, 'schema:manage'))) return forbidden();
  const body = await request.json();
  const { fieldName, fieldType, required, label, description, enumValues, tenantId: bodyTenantId } = body || {};
  const tenantId = resolveTenantId(request, user, bodyTenantId);
  if (!tenantId && user?.tenantId) return Response.json({ error: 'tenantId is required' }, { status: 400 });

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
}
