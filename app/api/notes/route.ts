import crypto from 'node:crypto';
import { appendAudit } from '@/lib/audit';
import { query, queryRead } from '@/lib/db';
import { withRoute } from '@/lib/route';
import { getOwnedPatient } from '@/lib/tenantGuard';
import { sanitizeString } from '@/lib/validate';

// GET /api/notes?patientId=
//
// A lacuna que estava aqui escrita — «são notas clínicas e não há ação declarada que
// as cubra» — deixou de existir: `notes:read` e `notes:write` vivem agora em
// lib/permissions.ts, ao lado de medical-history:*, e com o mesmo dono (o clínico;
// admin e super-admin herdam tudo). Quem consome isto é só a página de doentes do
// dentista, por isso fechar a porta não fecha nenhum ecrã — só deixa de a deixar
// aberta à receção, que nunca teve razão para escrever numa nota clínica.
export const GET = withRoute(
  {
    permission: 'notes:read',
    tenant: 'optional',
  },
  async ({ request, tenantId }) => {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    // Query clinical notes from patient_timeline (event_type = 'note'), scoped
    // through patients.tenant_id — patient_timeline itself has no tenant_id column.
    const rows = patientId
      ? await queryRead(
          `SELECT pt.* FROM patient_timeline pt
         JOIN patients p ON p.id = pt.patient_id
         WHERE pt.patient_id=$1 AND pt.event_type='note'
           AND ($2::uuid IS NULL OR p.tenant_id=$2::uuid)
         ORDER BY pt.created_at DESC`,
          [patientId, tenantId || null],
        )
      : [];

    return Response.json(rows);
  },
);

// POST /api/notes — save a signed progress note
export const POST = withRoute(
  {
    permission: 'notes:write',
    tenant: 'optional',
  },
  // Sem `requireRoles` por baixo, de propósito. Enquanto lá esteve, `notes:write`
  // aparecia na matriz de permissões como interruptor para a receção — é uma ação
  // normal, não de plataforma, logo `getPermissionMatrix` mostra-a — e ligá-lo não
  // ligava nada: o GET passava a responder e o POST continuava a devolver 403 na
  // linha de baixo. Um interruptor que não liga nada é pior do que não existir.
  //
  // Nada se abre com isto: o conjunto por omissão de `notes:write` é exatamente
  // {dentist, admin, super_admin} (lib/permissions.ts), os mesmos três papéis que a
  // linha verificava. O que muda é que agora a clínica pode decidir de outra forma e
  // a decisão tem efeito.
  async ({ request, user, tenantId }) => {
    const { patientId, noteText } = await request.json();
    if (!patientId || !noteText) {
      return Response.json({ error: 'patientId and noteText required' }, { status: 400 });
    }
    const text = sanitizeString(noteText, 5000);
    if (!text) return Response.json({ error: 'noteText required' }, { status: 400 });

    const patient = await getOwnedPatient(patientId, { tenantId });
    if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });

    const hash = crypto
      .createHash('sha256')
      .update(text + user.name + Date.now())
      .digest('hex')
      .slice(0, 12);

    // Store note as a timeline event with type 'note'
    const [row] = await query(
      `INSERT INTO patient_timeline
       (patient_id, user_name, user_role, event_type, event, hash)
     VALUES ($1,$2,$3,'note',$4,$5)
     RETURNING *`,
      [patientId, user.name, user.role, text, hash],
    );

    await appendAudit(user, 'CREATE', `Progress Note for patient`, null, 'signed', user.clinic);

    return Response.json(row, { status: 201 });
  },
);
