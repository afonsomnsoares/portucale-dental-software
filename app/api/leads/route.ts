import { appendAudit, appendTimeline } from '@/lib/audit';
import { query, queryRead, withTransaction } from '@/lib/db';
import { badRequest, created } from '@/lib/http';
import { withRoute } from '@/lib/route';

export const GET = withRoute(
  { authOnly: 'Leads por tratar da própria clínica: trabalho de balcão, e responder exige leads:respond' },
  async ({ request, tenantId }) => {
    const status = new URL(request.url).searchParams.get('status') || 'open';
    if (!['open', 'converted', 'lost', 'all'].includes(status)) return badRequest('Invalid lead status');

    const rows = await queryRead(
      `SELECT l.*
     FROM leads l
     WHERE l.tenant_id=$1 AND ($2='all' OR l.status=$2)
     ORDER BY l.created_at DESC`,
      [tenantId, status],
    );
    return Response.json(rows);
  },
);

export const POST = withRoute(
  { permission: 'patients:create', tenant: 'required' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim() || null;
    const email = String(body.email || '').trim() || null;
    if (!name) return badRequest('Lead name is required');
    if (!phone && !email) return badRequest('Lead phone or email is required');

    const [lead] = await query(
      `INSERT INTO leads (tenant_id, name, phone, email, source, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        tenantId,
        name.slice(0, 200),
        phone?.slice(0, 50),
        email?.slice(0, 254),
        String(body.source || '')
          .trim()
          .slice(0, 100) || null,
        String(body.notes || '')
          .trim()
          .slice(0, 2000) || null,
      ],
    );
    await appendAudit(user, 'CREATE', `Lead — ${lead.name}`, null, 'open', user.clinic);
    return created(lead);
  },
);

export const PATCH = withRoute(
  { permission: 'patients:update', tenant: 'required' },
  async ({ request, user, tenantId }) => {
    const body = await request.json();
    const id = String(body.id || '');
    const status = String(body.status || '');
    if (!id || !['open', 'converted', 'lost'].includes(status)) return badRequest('Invalid lead update');

    // Converting a lead is the bridge into the patient lifecycle: it must leave behind a
    // real `patient` row (matched by phone if one already exists, created otherwise), not
    // just a status flag — see lib/lifecycle.ts, which reads `leads.patient_id`.
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT * FROM leads WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [
        id,
        tenantId,
      ]);
      const lead = rows[0];
      if (!lead) return { error: 'Lead not found', status: 404 };

      let patientId: string | null = lead.patient_id || null;
      const isNewLink = status === 'converted' && !patientId;
      if (isNewLink) {
        const phoneDigits = String(lead.phone || '').replace(/\D/g, '');
        if (phoneDigits) {
          const { rows: matches } = await client.query(
            `SELECT id FROM patients
           WHERE tenant_id=$1 AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') = $2`,
            [tenantId, phoneDigits],
          );
          if (matches.length === 1) patientId = matches[0].id;
        }
        if (!patientId) {
          const { rows: createdRows } = await client.query(
            `INSERT INTO patients (tenant_id, name, phone, email, balance, status, custom_fields)
           VALUES ($1,$2,$3,$4,0,'registered','{}'::jsonb) RETURNING id`,
            [tenantId, lead.name, lead.phone, lead.email],
          );
          patientId = createdRows[0].id;
        }
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE leads SET status=$1, patient_id=COALESCE($2, patient_id), updated_at=NOW()
       WHERE id=$3 AND tenant_id=$4 RETURNING *`,
        [status, patientId, id, tenantId],
      );
      return { lead, updated: updatedRows[0], patientId, isNewLink };
    });

    if (result.error) return Response.json({ error: result.error }, { status: result.status });

    await appendAudit(user, 'UPDATE', `Lead — ${result.lead.name}`, null, status, user.clinic);
    if (result.isNewLink && result.patientId) {
      await appendTimeline(
        result.patientId,
        user,
        'admin',
        `Convertido de lead${result.lead.source ? ` (origem: ${result.lead.source})` : ''}`,
      );
    }
    return Response.json(result.updated);
  },
);
