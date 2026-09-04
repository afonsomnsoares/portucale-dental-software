import type { SessionUser } from './auth';
import { currentRequestKey, enterTenantContext, query, queryOne, warnSchemaGap, withSystemContext } from './db';

export const PERMISSION_ACTIONS = [
  'patients:create',
  'patients:update',
  'appointments:create',
  'appointments:update',
  'appointments:cancel',
  'appointments:status',
  'treatments:create',
  'treatments:update',
  'treatments:delete',
  'uploads:create',
  'schema:manage',
  'users:manage',
  'tenants:manage',
  'audit:read',
  'permissions:manage',
  'jobs:run',
  'invoices:create',
  'invoices:read',
  'invoices:update',
  'invoices:pay',
  'finance:read',
  'recovery:read',
  'schedule:read',
  'waitlist:manage',
  'lifecycle:read',
  'notifications:read',
  'patient-tasks:read',
  'patient-tasks:create',
  'patient-tasks:update',
  'patient-interactions:read',
  'patient-interactions:create',
  'uploads:read',
  'lead-sources:manage',
  'staff-schedules:manage',
  'staff-time-off:manage',
  'checklists:manage',
  'incidents:manage',
  'inventory:manage',
  'equipment:manage',
  'patient-portal:manage',
  'documents:read',
  'documents:generate',
  'document-templates:manage',
  'shift-handoffs:manage',
  // Enviar o rascunho do agente Lead (lib/agents/leadAgent.ts) a alguém de fora da
  // clínica é contacto real, não só gestão interna de dados — por isso é uma permissão
  // à parte de 'patients:create' (que já cobre registar/editar o lead em si).
  'leads:respond',
  // ─── Registos clínicos ────────────────────────────────────────────────────
  // Estas rotas existiam antes do sistema de permissões e só verificavam
  // "autenticado + mesmo tenant", pelo que qualquer role podia criar uma
  // prescrição ou uma encomenda de laboratório. São atos clínicos: por
  // omissão ficam com o dentista e a direção, e o RGPD desaconselha dar
  // acesso a registos clínicos a quem não precisa deles para trabalhar.
  // Cada clínica pode alargar via role_permissions (UI de permissões).
  'prescriptions:read',
  'prescriptions:manage',
  'lab-orders:read',
  'lab-orders:manage',
  'treatment-plans:read',
  'treatment-plans:manage',
  'consent-forms:read',
  'consent-forms:manage',
  'medical-history:read',
  'medical-history:manage',
  // Recalls são trabalho administrativo tanto quanto clínico — a receção
  // agenda-os e fecha-os, e já tinha páginas a fazê-lo.
  'recalls:read',
  'recalls:manage',
  // 'incidents:manage' e 'checklists:manage' (acima) são da direção: fechar
  // incidentes e editar templates. Registar um incidente e correr a checklist
  // do dia é trabalho de quem está ao balcão ou no gabinete.
  'incidents:read',
  'incidents:report',
  'checklists:run',
  // ─── Proteção de dados (RGPD) ─────────────────────────────────────────────
  // Responder a um pedido do titular expõe TUDO o que a clínica guarda sobre
  // uma pessoa, e o apagamento é irreversível. Fica com a direção por omissão,
  // não com quem atende ao balcão — mesmo raciocínio de 'audit:read'.
  'gdpr:read',
  'gdpr:manage',
  // ─── Agentes ──────────────────────────────────────────────────────────────
  // Os agentes (lib/agents/registry.ts) governam as tarefas automáticas de
  // lib/jobsRunner.ts — que enviam SMS a doentes, escalam incidentes e aplicam
  // políticas de retenção. Ver o que correu é trabalho de direção, por isso não é
  // dado à receção nem ao dentista.
  //
  // Não há 'agents:run': disparar execuções à mão já tem dono em 'jobs:run'.
  // Declarar uma ação que nenhuma rota verifica é a deriva que o cruzamento
  // declaradas-vs-aplicadas existe para apanhar — quando a ação de correr um agente
  // existir, nasce com a rota, não antes.
  'agents:read',
  // Marcar uma conclusão de agente como tratada (agent_insights, migração 041). É
  // escrita, por isso não vai à boleia do 'agents:read' — quem lê o diagnóstico não é
  // necessariamente quem decide que está resolvido.
  'agents:resolve',
  // A autonomia do agente de agenda (tenant_scheduling_policy, migração 046):
  // decidir se o software contacta doentes sozinho, e se um "SIM" marca a
  // consulta. Não é 'agents:read' (ver o que correu) nem 'schedule:read' (ver a
  // agenda) — é assumir responsabilidade pelo que a clínica faz sem ninguém
  // presente, e por isso fica com a direção. Cobre também disparar uma corrida à
  // mão, que envia SMS reais.
  'scheduling-agent:manage',
];

const DEFAULT: Record<string, Set<string>> = {
  super_admin: new Set(PERMISSION_ACTIONS),
  admin: new Set(PERMISSION_ACTIONS),
  receptionist: new Set([
    'patients:create',
    'patients:update',
    'appointments:create',
    'appointments:update',
    'appointments:cancel',
    'appointments:status',
    'invoices:create',
    'invoices:read',
    'invoices:update',
    'invoices:pay',
    'finance:read',
    'recovery:read',
    'schedule:read',
    'waitlist:manage',
    'lifecycle:read',
    'notifications:read',
    'patient-tasks:read',
    'patient-tasks:create',
    'patient-tasks:update',
    'patient-interactions:read',
    'patient-interactions:create',
    'uploads:create',
    'uploads:read',
    'patient-portal:manage',
    'documents:read',
    'documents:generate',
    'shift-handoffs:manage',
    'recalls:read',
    'recalls:manage',
    'incidents:read',
    'incidents:report',
    'checklists:run',
    'leads:respond',
  ]),
  dentist: new Set([
    'appointments:status',
    'treatments:create',
    'treatments:update',
    'treatments:delete',
    'uploads:create',
    'uploads:read',
    'patient-tasks:read',
    'patient-tasks:create',
    'patient-tasks:update',
    'patient-interactions:read',
    'patient-interactions:create',
    'patient-portal:manage',
    'documents:read',
    'documents:generate',
    'shift-handoffs:manage',
    'prescriptions:read',
    'prescriptions:manage',
    'lab-orders:read',
    'lab-orders:manage',
    'treatment-plans:read',
    'treatment-plans:manage',
    'consent-forms:read',
    'consent-forms:manage',
    'medical-history:read',
    'medical-history:manage',
    'recalls:read',
    'recalls:manage',
    'incidents:read',
    'incidents:report',
    'checklists:run',
  ]),
};

export function defaultAllows(role: string, action: string) {
  const set = DEFAULT[String(role || '')];
  return !!set?.has(action);
}

async function safeQueryOne(sql: string, params: unknown[] = []) {
  try {
    return await queryOne(sql, params);
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') {
      warnSchemaGap('permissions.role_permissions', e);
      return null;
    }
    throw e;
  }
}

async function safeQuery(sql: string, params: unknown[] = []) {
  try {
    return await query(sql, params);
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') {
      warnSchemaGap('permissions.role_permissions', e);
      return [];
    }
    throw e;
  }
}

export async function permissionOverride(
  tenantId: string | null | undefined,
  role: string,
  action: string,
): Promise<boolean | null> {
  if (!tenantId) return null;
  const row = await safeQueryOne(`SELECT allowed FROM role_permissions WHERE tenant_id=$1 AND role=$2 AND action=$3`, [
    tenantId,
    role,
    action,
  ]);
  if (!row) return null;
  return !!row.allowed;
}

// ─── Revalidação de sessão ───────────────────────────────────────────────────
// O JWT transporta `role`, `tenantId` e `active` implícito no momento em que foi
// assinado, e nada os volta a ler durante os 7 dias (JWT_TTL_SECONDS) em que o token
// vale. Sem isto, desativar uma conta, despromover alguém ou movê-lo de clínica não
// tinha efeito nenhum nas rotas de API: /api/auth/me confirmava `active` e expulsava a
// pessoa do interface, mas quem guardasse o cookie continuava a criar doentes, faturas
// e prescrições com o papel antigo. O cenário concreto é o despedimento — conta
// desativada às 18h, operacional até à semana seguinte.
//
// A verificação vive aqui, e não em getAuth(), porque getAuth() é síncrono e é chamado
// por 108 rotas; hasPermission() já é assíncrono, já é esperado por todas as mutações,
// e já faz uma query. Passa a fazer duas — ambas por chave indexada.
export interface LiveUser {
  id: string;
  role: string;
  tenantId: string | null;
}

// Memo pelo tempo de vida do pedido. Uma rota pode verificar várias ações
// (app/api/treatments/[id]/route.ts chega às cinco) e não faz sentido reler a mesma
// linha de `users` a cada uma. WeakMap sobre a identidade do pedido: sem chaves
// residuais entre pedidos, e sem TTL a inventar — a janela de staleness é exatamente
// um pedido HTTP.
const liveUserByRequest = new WeakMap<object, Promise<LiveUser | null>>();

async function fetchLiveUser(userId: string): Promise<LiveUser | null> {
  const row = await withSystemContext(() =>
    safeQueryOne(`SELECT id, role, tenant_id, active FROM users WHERE id=$1`, [userId]),
  );
  // Apagado, desativado, ou a tabela nem existe (safeQueryOne devolve null num schema
  // por migrar): em qualquer dos casos não há autorização a conceder. Fail-closed.
  if (row?.active !== true) return null;
  return { id: String(row.id), role: String(row.role || ''), tenantId: (row.tenant_id as string) ?? null };
}

function liveUser(userId: string): Promise<LiveUser | null> {
  const key = currentRequestKey();
  if (!key) return fetchLiveUser(userId);
  const memo = liveUserByRequest.get(key);
  if (memo) return memo;
  const pending = fetchLiveUser(userId);
  liveUserByRequest.set(key, pending);
  return pending;
}

/**
 * Reconcilia a sessão que o token afirma com o que a base de dados diz agora.
 * Devolve null se a conta já não existe ou está desativada — e aí não há autorização
 * nenhuma a conceder.
 *
 * **Escreve por cima do `user` que recebe**, de propósito, e isso é o mais importante a
 * saber sobre esta função. As 108 rotas leem `user.tenantId` e `user.role` diretamente
 * depois de verificarem a permissão (lib/route.ts's resolveTenantId faz exatamente isso),
 * e é desses campos que saem os filtros `WHERE tenant_id=$1` de toda a aplicação. Devolver
 * um objeto novo obrigaria as 108 a passarem a usá-lo para ficarem corretas — ou seja,
 * deixaria a correção por fazer em qualquer rota que se esquecesse. Escrever no sítio faz
 * com que fique feita em todas de uma vez.
 *
 * É seguro porque o objeto é privado do pedido: getAuth() constrói-o de novo a cada
 * chamada, a partir do JSON.parse do payload do token. Ninguém o partilha entre pedidos.
 */
export async function revalidateSession(user: SessionUser | null | undefined): Promise<LiveUser | null> {
  // Sem id não há nada que confirmar contra a base de dados, e conceder às cegas é
  // precisamente o que este bloco existe para impedir.
  if (!user?.id) return null;
  const live = await liveUser(user.id);
  if (!live) return null;

  if (live.role !== user.role || (live.tenantId ?? null) !== (user.tenantId ?? null)) {
    user.role = live.role;
    user.tenantId = live.tenantId;
    // O contexto de RLS foi estabelecido por getAuth() a partir do token, e acabámos de
    // saber que o token está desatualizado. Sem isto, uma pessoa movida de clínica ficava
    // com as políticas a apontar para a antiga durante o resto do pedido.
    enterTenantContext({ tenantId: live.tenantId, role: live.role });
  }
  return live;
}

export async function hasPermission(user: SessionUser | null | undefined, action: string) {
  if (!user) return false;

  const live = await revalidateSession(user);
  if (!live) return false;

  // A partir daqui manda a base de dados, não o token.
  const role = live.role;
  if (role === 'super_admin') return true;
  const tenantId = live.tenantId;
  const override = await permissionOverride(tenantId, role, action);
  if (override !== null) return override;
  return defaultAllows(role, action);
}

export async function getPermissionMatrix(tenantId: string) {
  const roles = ['receptionist', 'dentist', 'admin'];
  const rows = await safeQuery(`SELECT role, action, allowed FROM role_permissions WHERE tenant_id=$1`, [tenantId]);
  const map = new Map(rows.map((r) => [`${r.role}:${r.action}`, !!r.allowed]));
  type PermEntry = { default: boolean; override: boolean | null; effective: boolean };
  const matrix: Record<string, Record<string, PermEntry>> = {};
  for (const role of roles) {
    matrix[role] = {};
    for (const action of PERMISSION_ACTIONS) {
      const key = `${role}:${action}`;
      const def = defaultAllows(role, action);
      const rawOvr = map.get(key);
      const ovr: boolean | null = rawOvr === undefined ? null : !!rawOvr;
      matrix[role][action] = {
        default: def,
        override: ovr,
        effective: ovr === null ? def : ovr,
      };
    }
  }
  return { roles, actions: PERMISSION_ACTIONS, matrix };
}

export async function setPermissionOverrides(
  tenantId: string,
  updates: Array<{ role?: unknown; action?: unknown; allowed?: unknown }> | null | undefined,
) {
  for (const u of updates || []) {
    const role = String(u.role || '');
    const action = String(u.action || '');
    if (!role || !action) continue;
    if (!PERMISSION_ACTIONS.includes(action)) continue;
    if (u.allowed === null) {
      await safeQuery(`DELETE FROM role_permissions WHERE tenant_id=$1 AND role=$2 AND action=$3`, [
        tenantId,
        role,
        action,
      ]);
    } else {
      await safeQuery(
        `INSERT INTO role_permissions (tenant_id, role, action, allowed)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, role, action)
         DO UPDATE SET allowed=EXCLUDED.allowed`,
        [tenantId, role, action, !!u.allowed],
      );
    }
  }
}
