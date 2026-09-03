import { query, queryOne } from './db';
import { createTask } from './patientTasks';
import { ADMIN_TASK_ROLES } from './taskRoutingCalc';

// ─── Aplicação das políticas de conservação (RGPD art. 5.º, n.º 1, al. e) ────
// `data_retention_policies` existia no schema desde o início — com categoria,
// prazo e ação ('delete' | 'anonymize' | 'archive') — e nenhum código a lia. O
// job chamado 'retention' limpava uploads por uma variável de ambiente global e
// nunca tocou nesta tabela. Ou seja: a clínica podia declarar políticas e elas
// não faziam nada, que é pior do que não as ter — dá a aparência documentada de
// um controlo que não existe.
//
// ⚠️ POSTURA DELIBERADA: apagar automaticamente é o modo perigoso.
// Para categorias operacionais (mensagens enviadas, leads não convertidos,
// tokens expirados) a ação é executada — o dado não tem valor clínico e mantê-lo
// é que é a infração. Para tudo o que toca no processo clínico, o job NÃO apaga:
// cria uma tarefa para a direção rever. Apagar registo clínico tarde é uma
// não-conformidade; apagá-lo por engano é irreversível e pode ser ilegal, porque
// há obrigações de conservação que se sobrepõem ao direito ao apagamento.
// Ver o cabeçalho de lib/dataSubject.ts.

interface CategoryHandler {
  // O que a categoria abrange, em linguagem que quem define a política entenda.
  describes: string;
  // 'auto' — o job executa. 'review' — o job só sinaliza e cria tarefa.
  mode: 'auto' | 'review';
  count: (tenantId: string, days: number) => Promise<number>;
  apply?: (tenantId: string, days: number) => Promise<number>;
}

async function countRows(sql: string, params: unknown[]) {
  const rows = await query(sql, params);
  return Number(rows[0]?.n || 0);
}

export const RETENTION_CATEGORIES: Record<string, CategoryHandler> = {
  notifications: {
    describes: 'Mensagens SMS enviadas — contêm nome e telefone do paciente',
    mode: 'auto',
    count: (t, d) =>
      countRows(
        `SELECT COUNT(*)::int AS n FROM notifications
         WHERE tenant_id=$1 AND created_at < NOW() - ($2::int * INTERVAL '1 day')`,
        [t, d],
      ),
    apply: async (t, d) => {
      const rows = await query(
        `DELETE FROM notifications
         WHERE tenant_id=$1 AND created_at < NOW() - ($2::int * INTERVAL '1 day') RETURNING 1`,
        [t, d],
      );
      return rows.length;
    },
  },

  leads: {
    describes: 'Contactos comerciais que nunca se converteram em paciente',
    mode: 'auto',
    count: (t, d) =>
      countRows(
        `SELECT COUNT(*)::int AS n FROM leads
         WHERE tenant_id=$1 AND patient_id IS NULL AND created_at < NOW() - ($2::int * INTERVAL '1 day')`,
        [t, d],
      ),
    apply: async (t, d) => {
      const rows = await query(
        `DELETE FROM leads
         WHERE tenant_id=$1 AND patient_id IS NULL AND created_at < NOW() - ($2::int * INTERVAL '1 day') RETURNING 1`,
        [t, d],
      );
      return rows.length;
    },
  },

  patient_portal_tokens: {
    describes: 'Ligações de uso único do portal do paciente, já usadas ou expiradas',
    mode: 'auto',
    count: (t, d) =>
      countRows(
        `SELECT COUNT(*)::int AS n FROM patient_portal_tokens
         WHERE tenant_id=$1 AND created_at < NOW() - ($2::int * INTERVAL '1 day')`,
        [t, d],
      ),
    apply: async (t, d) => {
      const rows = await query(
        `DELETE FROM patient_portal_tokens
         WHERE tenant_id=$1 AND created_at < NOW() - ($2::int * INTERVAL '1 day') RETURNING 1`,
        [t, d],
      );
      return rows.length;
    },
  },

  inactive_patients: {
    describes: 'Pacientes sem qualquer atividade clínica há mais tempo do que o prazo definido',
    // Nunca automático. Anonimizar um paciente destrói a ligação entre a pessoa
    // e o seu processo clínico — uma decisão que exige olhos humanos sobre cada
    // caso, não um cron às três da manhã.
    mode: 'review',
    count: (t, d) =>
      countRows(
        `SELECT COUNT(*)::int AS n FROM patients p
         WHERE p.tenant_id=$1 AND p.status <> 'anonymized'
           AND COALESCE(p.last_visit, p.created_at::date) < (CURRENT_DATE - ($2::int))
           AND NOT EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.patient_id = p.id AND a.appt_date >= (CURRENT_DATE - ($2::int))
           )`,
        [t, d],
      ),
  },
};

export interface RetentionOutcome {
  category: string;
  retentionDays: number;
  action: string;
  mode: 'auto' | 'review' | 'unknown';
  affected: number;
  applied: number;
}

/**
 * Percorre as políticas ativas da clínica e aplica-as. Devolve o que fez e o que
 * deixou para revisão humana, para o resultado ficar registado em `job_runs`.
 */
export async function enforceRetentionPolicies(tenantId: string) {
  const policies = await query(
    `SELECT data_category, retention_days, action FROM data_retention_policies
     WHERE tenant_id=$1 AND active=TRUE`,
    [tenantId],
  );

  const outcomes: RetentionOutcome[] = [];

  for (const p of policies) {
    const category = String(p.data_category || '');
    const days = Number(p.retention_days || 0);
    const action = String(p.action || 'anonymize');
    const handler = RETENTION_CATEGORIES[category];

    // Uma categoria que ninguém sabe aplicar é uma política que a clínica pensa
    // ter e não tem. Fica visível no resultado do job em vez de desaparecer.
    if (!handler || days <= 0) {
      outcomes.push({ category, retentionDays: days, action, mode: 'unknown', affected: 0, applied: 0 });
      continue;
    }

    const affected = await handler.count(tenantId, days);

    if (handler.mode === 'auto' && handler.apply && action === 'delete' && affected > 0) {
      const applied = await handler.apply(tenantId, days);
      outcomes.push({ category, retentionDays: days, action, mode: 'auto', affected, applied });
      continue;
    }

    // Modo de revisão, ou ação que não é 'delete': sinalizar, nunca executar.
    // Só uma tarefa aberta por categoria — sem isto, o job criava uma nova a
    // cada execução e afogava a fila. Mesmo idioma de marcador em `notes` que
    // escalateIncidents e checklistReminders usam em lib/jobsRunner.ts.
    const marker = `retention:${category}`;
    const already =
      affected > 0
        ? await queryOne(`SELECT 1 FROM patient_tasks WHERE tenant_id=$1 AND notes=$2 AND status='pending' LIMIT 1`, [
            tenantId,
            marker,
          ])
        : null;
    if (affected > 0 && !already) {
      await createTask(tenantId, null, {
        patientId: null,
        type: 'follow_up',
        title: `Conservação de dados: ${affected} registos em "${category}" excedem ${days} dias`,
        notes: marker,
        autoAssign: true,
        preferredRoles: ADMIN_TASK_ROLES,
      });
    }
    outcomes.push({ category, retentionDays: days, action, mode: handler.mode, affected, applied: 0 });
  }

  return { policies: policies.length, outcomes };
}
