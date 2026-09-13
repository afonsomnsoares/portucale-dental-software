import type { SessionUser } from './auth';
import { currentRequestKey, enterTenantContext, query, queryOne, warnSchemaGap, withSystemContext } from './db';

export const PERMISSION_ACTIONS = [
  'patients:create',
  'patients:update',
  'appointments:create',
  'appointments:update',
  'appointments:cancel',
  'appointments:status',
  // Ler tratamentos é trabalho de receção tanto quanto clínico — a faturação parte
  // deles. Até aqui GET /api/treatments usava as três ações de ESCRITA abaixo como
  // sucedâneo de leitura, o que deixava a rececionista com o menu 'Tratamentos' a
  // levar a um 403 (o beco que lib/constants.ts:74 já nomeava como precedente mau).
  'treatments:read',
  'treatments:create',
  'treatments:update',
  'treatments:delete',
  'uploads:create',
  'schema:manage',
  'users:manage',
  'tenants:manage',
  'audit:read',
  'reports:read',
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
  // ─── Notas clínicas ────────────────────────────────────────────────────────
  // Estiveram até aqui atrás de `authOnly`, com a lacuna declarada por escrito no
  // próprio app/api/notes/route.ts: são notas clínicas e não havia ação nenhuma a
  // cobri-las, pelo que qualquer sessão válida — receção incluída — as lia e escrevia.
  // Ficam ao lado de medical-history:* porque são a mesma matéria e seguem a mesma
  // regra: quem trata do processo clínico, e mais ninguém.
  'notes:read',
  'notes:write',
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
  // ─── Custos e margem (migração 047) ───────────────────────────────────────
  // Ler a margem vai à boleia de 'finance:read' — quem já vê receita e saldos vê
  // margem. ESCREVER a base de imputação é outra coisa: muda o número que toda a
  // gente lê, em todos os relatórios, retroativamente. Fica com a direção.
  'costs:manage',
  // ─── Percursos de consulta (migração 048) ─────────────────────────────────
  // Configurar um percurso é escrever política da clínica: o que tem de estar feito
  // antes de um implante. Quem corre os passos são as tarefas de sempre
  // ('patient-tasks:*'), que a receção e o clínico já têm.
  'care-pathways:manage',
  // ─── Canal de entrada (migração 049) ──────────────────────────────────────
  // A caixa de entrada é trabalho de balcão, por isso a receção lê e responde por
  // omissão. Mudar o nível de autonomia — decidir se a IA fala sozinha com um doente —
  // não é: é a decisão de produto mais consequente que uma clínica toma aqui.
  'conversations:read',
  'conversations:reply',
  'conversations:configure',
];

// Ações que só fazem sentido ao nível da plataforma. Até aqui 'admin' e 'super_admin'
// tinham conjuntos IDÊNTICOS, o que deixava o admin de clínica com 'tenants:manage' —
// uma ação que ele nunca poderia exercer, porque app/api/tenants/route.ts exige o papel
// antes de olhar para a permissão. O comentário dessa rota já dizia, por escrito, que a
// permissão sozinha o deixaria passar: era um remendo numa rota em vez da correção na
// origem, e qualquer rota nova que confiasse só em hasPermission('tenants:manage')
// nasceria aberta ao admin de clínica.
export const PLATFORM_ACTIONS = ['tenants:manage'];

const DEFAULT: Record<string, Set<string>> = {
  // O super_admin mantém todas as ações: na Fase 3 passa a operar as clínicas por dentro,
  // com as páginas do admin, e precisa das mesmas ações de clínica.
  super_admin: new Set(PERMISSION_ACTIONS),
  admin: new Set(PERMISSION_ACTIONS.filter((a) => !PLATFORM_ACTIONS.includes(a))),
  receptionist: new Set([
    'patients:create',
    'patients:update',
    'treatments:read',
    'appointments:create',
    'appointments:update',
    'appointments:cancel',
    'appointments:status',
    'reports:read',
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
    'conversations:read',
    'conversations:reply',
  ]),
  dentist: new Set([
    'appointments:status',
    // 'schedule:read': a Agenda Inteligente do dentista (app/dashboard/dentist/
    // schedule-intel) chama /api/schedule-intel/risk, que a exige. A página foi
    // criada para ele e a permissão ficou por dar — a lista de risco vinha sempre
    // vazia por 403.
    'schedule:read',
    'treatments:read',
    'treatments:create',
    'treatments:update',
    'treatments:delete',
    'uploads:create',
    'uploads:read',
    'reports:read',
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
    'notes:read',
    'notes:write',
    'recalls:read',
    'recalls:manage',
    'incidents:read',
    'incidents:report',
    'checklists:run',
    // Só leitura: as mensagens clínicas escalam para uma pessoa e é frequentemente o
    // clínico quem tem de as ver. Responder ao doente continua a ser da receção, que é
    // quem tem o contexto administrativo todo.
    'conversations:read',
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

async function permissionOverride(
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
  /** `users.password_changed_at`, em milissegundos, ou null se nunca foi mudada. */
  passwordChangedAt: number | null;
}

// Memo pelo tempo de vida do pedido. Uma rota pode verificar várias ações
// (app/api/treatments/[id]/route.ts chega às cinco) e não faz sentido reler a mesma
// linha de `users` a cada uma. WeakMap sobre a identidade do pedido: sem chaves
// residuais entre pedidos, e sem TTL a inventar — a janela de staleness é exatamente
// um pedido HTTP.
const liveUserByRequest = new WeakMap<object, Promise<LiveUser | null>>();

async function fetchLiveUser(userId: string): Promise<LiveUser | null> {
  const row = await withSystemContext(() =>
    safeQueryOne(`SELECT id, role, tenant_id, active, password_changed_at FROM users WHERE id=$1`, [userId]),
  );
  // Apagado, desativado, ou a tabela nem existe (safeQueryOne devolve null num schema
  // por migrar): em qualquer dos casos não há autorização a conceder. Fail-closed.
  if (row?.active !== true) return null;
  // A coluna só existe a partir da migração 046; numa base por migrar vem undefined e
  // o resultado é null — ou seja, "nunca mudada", que é o mesmo comportamento de antes.
  const changedAt = row.password_changed_at ? new Date(row.password_changed_at as string).getTime() : null;
  return {
    id: String(row.id),
    role: String(row.role || ''),
    tenantId: (row.tenant_id as string) ?? null,
    passwordChangedAt: Number.isFinite(changedAt) ? changedAt : null,
  };
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

// Tolerância de relógio entre o processo que assinou o token e o Postgres que carimbou
// a mudança de password. Sem ela, um par de segundos de desvio entre as duas máquinas
// invalidaria tokens acabados de emitir — e o sintoma seria alguém não conseguir entrar
// logo a seguir a mudar a password, que é o pior momento possível para duvidar do
// sistema. Cinco segundos chegam para desvio normal de NTP e são curtos demais para
// servirem de janela a quem tenha um token roubado.
const PASSWORD_CHANGE_SKEW_MS = 5000;

/**
 * O token foi emitido ANTES da última mudança de password? Se sim, não vale mais nada,
 * mesmo que a assinatura esteja boa e ainda não tenha expirado.
 *
 * É esta a diferença entre "mudei a password" e "expulsei quem estava lá dentro". Sem
 * isto, trocar uma password comprometida não fazia nada a quem já tinha o token — ele
 * continuava válido até JWT_TTL_SECONDS (7 dias por omissão).
 *
 * Um token sem `iat` (formato antigo, ou construído à mão) conta como anterior a
 * qualquer mudança: se não se consegue provar que foi emitido depois, a leitura segura
 * é recusar. Tokens assinados por signToken trazem sempre `iat`.
 */
function isTokenOlderThanPasswordChange(user: SessionUser, live: LiveUser): boolean {
  if (live.passwordChangedAt === null) return false;
  const issuedAtMs = Number(user.iat) * 1000;
  if (!Number.isFinite(issuedAtMs)) return true;
  return issuedAtMs + PASSWORD_CHANGE_SKEW_MS < live.passwordChangedAt;
}

/**
 * Reconcilia a sessão que o token afirma com o que a base de dados diz agora.
 * Devolve null se a conta já não existe, está desativada, ou se a password foi mudada
 * depois de o token ter sido emitido — e aí não há autorização nenhuma a conceder.
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
  if (isTokenOlderThanPasswordChange(user, live)) return null;

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
  // O super_admin é confrontado com as ações como toda a gente — é isso que dá
  // sentido ao DEFAULT.super_admin declarado acima. Só salta o permissionOverride,
  // que é por clínica (role_permissions.tenant_id) e ele não tem nenhuma.
  if (role === 'super_admin') return defaultAllows(role, action);
  const tenantId = live.tenantId;
  const override = await permissionOverride(tenantId, role, action);
  if (override !== null) return override;
  return defaultAllows(role, action);
}

// Conjunto de ações efetivas de UM utilizador — defaults do papel, com os overrides da
// sua clínica aplicados por cima. É o que /api/auth/me devolve para a Sidebar poder
// esconder o que a pessoa não pode fazer.
//
// Até agora não havia forma de alguém saber as suas próprias permissões: /api/permissions
// exige 'permissions:manage' e o papel admin/super_admin, pelo que uma rececionista nunca
// as podia consultar. Uma query só, pela mesma chave indexada que permissionOverride usa.
export async function effectiveActions(role: string, tenantId: string | null | undefined): Promise<string[]> {
  if (role === 'super_admin') return PERMISSION_ACTIONS.filter((a) => defaultAllows(role, a));
  if (!tenantId) return [];
  const rows = await safeQuery(`SELECT action, allowed FROM role_permissions WHERE tenant_id=$1 AND role=$2`, [
    tenantId,
    role,
  ]);
  const override = new Map<string, boolean>(rows.map((r) => [String(r.action), !!r.allowed]));
  return PERMISSION_ACTIONS.filter((a) => (override.has(a) ? !!override.get(a) : defaultAllows(role, a)));
}

// Os papéis que uma clínica pode reconfigurar. Não inclui 'super_admin': ele não tem
// clínica, hasPermission salta-lhe o permissionOverride por isso mesmo, e uma linha de
// role_permissions com o nome dele seria uma linha que nada lê — o género de estado que
// mais tarde alguém interpreta como se tivesse efeito.
//
// Partilhado entre getPermissionMatrix (o que a UI mostra) e setPermissionOverrides (o
// que ela pode gravar) de propósito: eram duas listas, e a de escrita não existia de
// todo — aceitava qualquer string.
export const OVERRIDABLE_ROLES = ['receptionist', 'dentist', 'admin'];

/**
 * Este par (papel, ação) pode ser reconfigurado por uma clínica?
 *
 * Existe como função pura, e exportada, para poder ser testada sem base de dados — o
 * resto de setPermissionOverrides é escrita, e a regra que importa é esta.
 *
 * ─── Porque é que as PLATFORM_ACTIONS são recusadas aqui ────────────────────
 * Tirá-las dos defaults do 'admin' não chegava. `setPermissionOverrides` só validava
 * `PERMISSION_ACTIONS.includes(action)` — e 'tenants:manage' está nessa lista. Um admin
 * de clínica tem 'permissions:manage' por omissão, logo podia gravar um override que
 * devolvia ao seu próprio papel exatamente a ação que os defaults lhe retiraram, e
 * `hasPermission` consulta o override ANTES dos defaults.
 *
 * Não era explorável: as rotas de plataforma usam `platform:` em withRoute, e
 * requirePlatform verifica o papel antes da permissão. Mas a defesa em profundidade que
 * PLATFORM_ACTIONS existe para dar estava, na prática, desligada — e a primeira rota
 * escrita só com `permission: 'tenants:manage'` tornava-a real.
 */
export function canOverride(role: string, action: string): boolean {
  if (!OVERRIDABLE_ROLES.includes(role)) return false;
  if (!PERMISSION_ACTIONS.includes(action)) return false;
  if (PLATFORM_ACTIONS.includes(action)) return false;
  return true;
}

export async function getPermissionMatrix(tenantId: string) {
  const roles = OVERRIDABLE_ROLES;
  const rows = await safeQuery(`SELECT role, action, allowed FROM role_permissions WHERE tenant_id=$1`, [tenantId]);
  const map = new Map(rows.map((r) => [`${r.role}:${r.action}`, !!r.allowed]));
  // As ações que a UI mostra são exatamente as que setPermissionOverrides aceita
  // gravar. Mostrar as de plataforma — que o guardião abaixo recusa — seria pôr no
  // ecrã um interruptor que não liga nada.
  const actions = PERMISSION_ACTIONS.filter((a) => !PLATFORM_ACTIONS.includes(a));
  type PermEntry = { default: boolean; override: boolean | null; effective: boolean };
  const matrix: Record<string, Record<string, PermEntry>> = {};
  for (const role of roles) {
    matrix[role] = {};
    for (const action of actions) {
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
  return { roles, actions, matrix };
}

export async function setPermissionOverrides(
  tenantId: string,
  updates: Array<{ role?: unknown; action?: unknown; allowed?: unknown }> | null | undefined,
) {
  for (const u of updates || []) {
    const role = String(u.role || '');
    const action = String(u.action || '');
    if (!canOverride(role, action)) continue;
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
