import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { normalizeCustomFields } from '@/lib/customFields';
import { withTransaction } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

function stripBom(s: string) {
  if (!s) return '';
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function detectDelimiter(line: string) {
  const commas = (line.match(/,/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

function parseCsv(text: unknown, delimiter: string) {
  const out: string[][] = [];
  const s = stripBom(String(text || ''))
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cur);
      cur = '';
      const isAllEmpty = row.every((v) => String(v || '').trim() === '');
      if (!isAllEmpty) out.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  if (!row.every((v) => String(v || '').trim() === '')) out.push(row);
  return out;
}

function normalizeKey(s: unknown) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function toFieldName(label: unknown) {
  let s = normalizeKey(label)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!s) s = 'field';
  if (/^\d/.test(s)) s = `f_${s}`;
  return s;
}

function parseDate(val: unknown) {
  const s = String(val || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'patients:create'))) return forbidden();
  if (!user.tenantId) return forbidden();

  const body = await request.json();
  const csvText = String(body.csv || '');
  if (!csvText.trim()) return Response.json({ error: 'CSV is required' }, { status: 400 });

  const firstLine = stripBom(csvText).split(/\r?\n/)[0] || '';
  const delimiter = body.delimiter ? String(body.delimiter) : detectDelimiter(firstLine);
  const rows = parseCsv(csvText, delimiter);
  if (rows.length < 2)
    return Response.json({ error: 'CSV must include a header row and at least 1 data row' }, { status: 400 });

  const rawHeaders = rows[0].map((h) => String(h || '').trim());
  const headers = [];
  const headerCounts = new Map();
  for (const h of rawHeaders) {
    const base = h || 'column';
    const n = (headerCounts.get(base) || 0) + 1;
    headerCounts.set(base, n);
    headers.push(n === 1 ? base : `${base}_${n}`);
  }

  const headerIndex = new Map(headers.map((h, i) => [normalizeKey(h), i]));
  const findCol = (headerLabel: unknown) => {
    const key = normalizeKey(headerLabel);
    return headerIndex.has(key) ? headerIndex.get(key) : null;
  };

  const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
  const mapName = mapping.name ? findCol(mapping.name) : null;
  const mapDob = mapping.dob ? findCol(mapping.dob) : null;
  const mapPhone = mapping.phone ? findCol(mapping.phone) : null;
  const mapEmail = mapping.email ? findCol(mapping.email) : null;
  const mapInsurance = mapping.insurance ? findCol(mapping.insurance) : null;
  const mapAlerts = mapping.alerts ? findCol(mapping.alerts) : null;

  const usedIdx = new Set([mapName, mapDob, mapPhone, mapEmail, mapInsurance, mapAlerts].filter((v) => v !== null));

  const customMap = body.customMap && typeof body.customMap === 'object' ? body.customMap : {};
  const customFromMapping = [];
  for (const [fieldName, headerLabel] of Object.entries(customMap)) {
    if (!fieldName || !headerLabel) continue;
    const idx = findCol(headerLabel);
    if (idx === null || idx === undefined) continue;
    customFromMapping.push({ fieldName: String(fieldName), headerLabel: String(headerLabel), idx });
    usedIdx.add(idx);
  }

  const importUnmappedAsCustom = body.importUnmappedAsCustom !== false;
  const createMissingSchemaFields = body.createMissingSchemaFields !== false;

  const autoCustom = [];
  if (importUnmappedAsCustom) {
    const takenFieldNames = new Set(customFromMapping.map((x) => x.fieldName));
    const labelByFieldName = new Map();
    for (let i = 0; i < headers.length; i++) {
      if (usedIdx.has(i)) continue;
      const label = headers[i];
      let fieldName = toFieldName(label);
      if (takenFieldNames.has(fieldName)) {
        let n = 2;
        while (takenFieldNames.has(`${fieldName}_${n}`)) n++;
        fieldName = `${fieldName}_${n}`;
      }
      takenFieldNames.add(fieldName);
      labelByFieldName.set(fieldName, label);
      autoCustom.push({ fieldName, headerLabel: label, idx: i });
    }
  }

  const allCustom = [...customFromMapping, ...autoCustom];
  const customLabel = new Map(allCustom.map((x) => [x.fieldName, x.headerLabel]));

  const maxRowsRaw = Number(body.maxRows || 2000);
  const maxRows = Number.isFinite(maxRowsRaw) ? Math.max(1, Math.min(10000, Math.floor(maxRowsRaw))) : 2000;

  const result = await withTransaction(async (client) => {
    if (createMissingSchemaFields && allCustom.length) {
      for (const { fieldName } of allCustom) {
        const label = customLabel.get(fieldName) || fieldName;
        try {
          await client.query(
            `INSERT INTO schema_fields (tenant_id, field_name, label, field_type, rollout, required)
             VALUES ($1,$2,$3,'string',100,FALSE)
             ON CONFLICT DO NOTHING`,
            [user.tenantId, fieldName, label],
          );
        } catch (e) {
          if ((e as { code?: string })?.code !== '42703') throw e;
          await client.query(
            `INSERT INTO schema_fields (field_name, label, field_type, rollout, required)
             VALUES ($1,$2,'string',100,FALSE)
             ON CONFLICT DO NOTHING`,
            [fieldName, label],
          );
        }
      }
    }

    let schema = [];
    try {
      const schemaRows = await client.query(
        `SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields WHERE tenant_id=$1`,
        [user.tenantId],
      );
      schema = schemaRows.rows || [];
    } catch (e) {
      if ((e as { code?: string })?.code !== '42703') throw e;
      const schemaRows = await client.query(
        `SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields`,
      );
      schema = schemaRows.rows || [];
    }
    let effectiveSchema = schema;
    if (!effectiveSchema.length) {
      try {
        effectiveSchema =
          (
            await client.query(
              `SELECT field_name, field_type, required, rollout, enum_values FROM schema_fields WHERE tenant_id IS NULL`,
            )
          ).rows || [];
      } catch (e) {
        if ((e as { code?: string })?.code !== '42703') throw e;
      }
    }

    let created = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string; name: string }> = [];

    for (let r = 1; r < rows.length && created + skipped < maxRows; r++) {
      const raw = rows[r] || [];
      const get = (idx: number | null | undefined) =>
        idx === null || idx === undefined ? '' : String(raw[idx] ?? '').trim();

      const name = get(mapName);
      if (!name) {
        skipped++;
        continue;
      }

      const dob = parseDate(get(mapDob));
      const phone = get(mapPhone) || null;
      const email = get(mapEmail) || null;
      const insurance = get(mapInsurance) || null;

      const customFields: Record<string, string> = {};
      for (const c of allCustom) {
        const v = String(raw[c.idx] ?? '').trim();
        if (v === '') continue;
        customFields[c.fieldName] = v;
      }

      const normalized = normalizeCustomFields(effectiveSchema, customFields);
      if (normalized.error) {
        errors.push({ row: r + 1, error: normalized.error, name });
        skipped++;
        continue;
      }

      const inserted = await client.query(
        `INSERT INTO patients (tenant_id, name, dob, phone, email, insurance, balance, status, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6,0,'registered',$7::jsonb)
         RETURNING id`,
        [user.tenantId, name, dob, phone, email, insurance, JSON.stringify(normalized.value || {})],
      );
      const patientId = inserted.rows[0]?.id;

      if (patientId && mapAlerts !== null) {
        const alertsRaw = get(mapAlerts);
        const alerts = alertsRaw
          ? alertsRaw
              .split(',')
              .map((a) => a.trim())
              .filter(Boolean)
          : [];
        for (const alert of alerts) {
          await client.query(`INSERT INTO patient_alerts (patient_id, alert) VALUES ($1,$2)`, [patientId, alert]);
        }
      }

      created++;
    }

    const auditEntry = {
      user_name: user.name,
      user_role: user.role,
      clinic: user.clinic || 'Tower',
      action: 'IMPORT',
      resource: `Patients CSV import · created ${created} · skipped ${skipped}`,
      before_val: null,
      after_val: String(user.tenantId),
    };
    // hash is computed server-side by chain_audit_log_hash — see lib/audit.ts's appendAudit.
    await client.query(
      `INSERT INTO audit_log (user_name, user_role, clinic, action, resource, before_val, after_val)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        auditEntry.user_name,
        auditEntry.user_role,
        auditEntry.clinic,
        auditEntry.action,
        auditEntry.resource,
        auditEntry.before_val,
        auditEntry.after_val,
      ],
    );

    return { created, skipped, errors: errors.slice(0, 50) };
  });

  return Response.json(result);
}
