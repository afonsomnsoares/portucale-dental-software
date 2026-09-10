// Mínimo de caracteres de uma password, partilhado pelo servidor (app/api/users/route.ts,
// app/api/users/[id]/route.ts) e pelos formulários que lá escrevem. Estava escrito à mão
// em cada um dos sítios: o formulário deixava submeter qualquer password não-vazia e só o
// servidor recusava, pelo que a pessoa preenchia tudo e levava com um 400 no fim.
export const MIN_PASSWORD_LENGTH = 10;

// Apontam para as variáveis que o next/font define em app/layout.tsx. Antes
// nomeavam 'DM Sans' e 'Bricolage Grotesque', que não são carregadas em lado
// nenhum — as páginas de erro e a 404 renderizavam na sans-serif do browser,
// com um aspeto diferente do resto do produto e sem que nada falhasse.
export const FONTS = {
  body: 'var(--font-plus-jakarta), system-ui, sans-serif',
  display: 'var(--font-plus-jakarta), system-ui, sans-serif',
};

// Uma entrada de menu. `requires` nomeia a ação que a página exige para mostrar o que
// interessa — a Sidebar esconde a entrada a quem não a tem. Sem isto, a UI de permissões
// por clínica (role_permissions) não tinha efeito nenhum na navegação: tirar 'finance:read'
// à receção deixava o link 'Finanças' visível e a levar a um 403.
//
// Fica indefinido de propósito nas páginas cuja lista principal só exige sessão válida
// (Painel, Doentes, Leads, Equipa) — essas não têm ação que as possa esconder.
export type Role = 'super_admin' | 'admin' | 'receptionist' | 'dentist';
// `group` agrupa entradas sob um cabeçalho na sidebar. Os menus da clínica (admin,
// receção, dentista) são listas planas e não o usam — cada entrada é uma área de
// trabalho e cabe num ecrã. O do super_admin não cabe: são 41 entradas, e sem
// cabeçalhos era uma lista impossível de varrer. Ver components/Sidebar.tsx, que
// desenha o cabeçalho quando o grupo muda e desenha ícone só nas entradas sem grupo.
export type NavItem = { label: string; href: string; requires?: string; group?: string };

// Navegação do 'admin' (o admin da clínica, sempre confinado a um tenant), com hrefs sob
// /dashboard/admin. O super_admin (âmbito de plataforma, sem clínica própria) tem o
// SUPER_ADMIN_NAV espelhado abaixo, sob o prefixo separado /dashboard/super-admin. Os dois
// papéis não partilham nem a árvore de URLs (ver DASHBOARD_ACCESS em proxy.ts) nem os
// componentes de página: /dashboard/admin/* renderiza components/clinic/pages/*,
// /dashboard/super-admin/* renderiza components/super-admin/pages/*. As etiquetas coincidem
// porque os dois papéis fazem o mesmo *tipo* de trabalho, mas as páginas de clínica estão
// presas ao tenant de quem chama e as de plataforma escolhem a clínica primeiro.
const ADMIN_NAV: NavItem[] = [
  { label: 'Visão Geral', href: '/dashboard/admin' },
  { label: 'Utilizadores', href: '/dashboard/admin/users', requires: 'users:manage' },
  { label: 'Campos Schema', href: '/dashboard/admin/schema', requires: 'schema:manage' },
  { label: 'Permissões', href: '/dashboard/admin/permissions', requires: 'permissions:manage' },
  { label: 'Relatórios', href: '/dashboard/admin/reports', requires: 'reports:read' },
  { label: 'Recuperação', href: '/dashboard/admin/recovery', requires: 'recovery:read' },
  { label: 'Agenda Inteligente', href: '/dashboard/admin/schedule-intel', requires: 'schedule:read' },
  { label: 'Jornada do Paciente', href: '/dashboard/admin/lifecycle', requires: 'lifecycle:read' },
  { label: 'Auditoria', href: '/dashboard/admin/audit', requires: 'audit:read' },
  { label: 'Faturas', href: '/dashboard/admin/invoices', requires: 'invoices:read' },
  { label: 'Finanças', href: '/dashboard/admin/finance', requires: 'finance:read' },
  { label: 'Inventário', href: '/dashboard/admin/inventory', requires: 'inventory:manage' },
  { label: 'Fontes de Leads', href: '/dashboard/admin/lead-sources', requires: 'lead-sources:manage' },
  { label: 'Equipa', href: '/dashboard/admin/team', requires: 'staff-schedules:manage' },
  { label: 'Operações', href: '/dashboard/admin/operations', requires: 'checklists:run' },
  { label: 'Agentes', href: '/dashboard/admin/agents', requires: 'agents:read' },
  { label: 'Documentos', href: '/dashboard/admin/documents', requires: 'documents:read' },
];

// Navegação do super_admin: só o que é PLATAFORMA.
//
// Até aqui esta lista não era uma lista — era ADMIN_NAV com um .replace() no href, menos
// duas entradas. Nunca se decidiu o que o super admin devia ver: decidiu-se o que o admin
// vê e o super admin herdou o resto. Daí as duas sidebars serem praticamente iguais, e daí
// 12 das 16 entradas serem, na prática, a página de uma clínica com um seletor por cima.
//
// As páginas de clínica (Faturas, Finanças, Inventário, Equipa, Operações, Recuperação,
// Agenda Inteligente, Jornada do Paciente, Fontes de Leads) saíram e NÃO voltaram: chega-se
// a elas entrando na clínica (POST /api/tenants/enter), que leva às páginas do próprio
// admin. Uma árvore em vez de duas a divergir — já divergiram ao ponto de uma estar em
// inglês, e é por isso que as entradas abaixo estão todas em português como o resto da UI.
//
// A lista cresceu para a estrutura de plataforma completa em 10 grupos. O que aqui está e
// ainda não tem dados por baixo NÃO inventa números: a página existe, diz o que vai
// mostrar e nomeia o que falta instrumentar (components/super-admin/NotInstrumented.tsx).
// Uma entrada de menu que leva a um número falso é pior do que entrada nenhuma.
const SUPER_ADMIN_NAV: NavItem[] = [
  // ── Visão geral ──
  { label: 'Painel da Plataforma', href: '/dashboard/super-admin', group: 'VISÃO GERAL' },
  { label: 'Estado do Sistema', href: '/dashboard/super-admin/health', group: 'VISÃO GERAL' },
  { label: 'Alertas', href: '/dashboard/super-admin/alerts', group: 'VISÃO GERAL', requires: 'agents:read' },

  // ── Organizações ──
  {
    label: 'Todas as Organizações',
    href: '/dashboard/super-admin/organizations',
    group: 'ORGANIZAÇÕES',
    requires: 'tenants:manage',
  },
  { label: 'Clínicas', href: '/dashboard/super-admin/tenants', group: 'ORGANIZAÇÕES', requires: 'tenants:manage' },
  {
    label: 'Localizações',
    href: '/dashboard/super-admin/locations',
    group: 'ORGANIZAÇÕES',
    requires: 'tenants:manage',
  },
  { label: 'Onboarding', href: '/dashboard/super-admin/onboarding', group: 'ORGANIZAÇÕES', requires: 'tenants:manage' },

  // ── Utilizadores ──
  {
    label: 'Todos os Utilizadores',
    href: '/dashboard/super-admin/users',
    group: 'UTILIZADORES',
    requires: 'users:manage',
  },
  { label: 'Papéis', href: '/dashboard/super-admin/roles', group: 'UTILIZADORES', requires: 'users:manage' },
  {
    label: 'Permissões',
    href: '/dashboard/super-admin/permissions',
    group: 'UTILIZADORES',
    requires: 'permissions:manage',
  },
  {
    label: 'Registos de Acesso',
    href: '/dashboard/super-admin/access-logs',
    group: 'UTILIZADORES',
    requires: 'audit:read',
  },

  // ── Plataforma de agentes ──
  { label: 'Agentes', href: '/dashboard/super-admin/ai/agents', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Modelos', href: '/dashboard/super-admin/ai/models', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Execuções', href: '/dashboard/super-admin/ai/runs', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Custos de IA', href: '/dashboard/super-admin/ai/costs', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Falhas', href: '/dashboard/super-admin/ai/failures', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Avaliações', href: '/dashboard/super-admin/ai/evaluations', group: 'AGENTES', requires: 'agents:read' },

  // ── Integrações ──
  { label: 'Integrações', href: '/dashboard/super-admin/integrations', group: 'INTEGRAÇÕES' },
  { label: 'Ligações', href: '/dashboard/super-admin/integrations/connections', group: 'INTEGRAÇÕES' },
  { label: 'Estado de Sincronização', href: '/dashboard/super-admin/integrations/sync', group: 'INTEGRAÇÕES' },
  { label: 'API', href: '/dashboard/super-admin/integrations/api', group: 'INTEGRAÇÕES' },

  // ── Operações ──
  { label: 'Tarefas da Plataforma', href: '/dashboard/super-admin/ops/tasks', group: 'OPERAÇÕES' },
  { label: 'Incidentes', href: '/dashboard/super-admin/ops/incidents', group: 'OPERAÇÕES' },
  { label: 'Suporte', href: '/dashboard/super-admin/ops/support', group: 'OPERAÇÕES' },
  {
    label: 'Eventos de Sistema',
    href: '/dashboard/super-admin/ops/events',
    group: 'OPERAÇÕES',
    requires: 'audit:read',
  },

  // ── Análise ──
  // 'Análise da Plataforma' é a página que já existia como 'Comparação de Clínicas'
  // (/reports): comparar clínicas do grupo É a análise de plataforma. Ficou o href para
  // não órfãos a única página desta secção com dados reais desde sempre.
  {
    label: 'Análise da Plataforma',
    href: '/dashboard/super-admin/reports',
    group: 'ANÁLISE',
    requires: 'reports:read',
  },
  { label: 'Utilização', href: '/dashboard/super-admin/analytics/usage', group: 'ANÁLISE', requires: 'reports:read' },
  {
    label: 'Retenção',
    href: '/dashboard/super-admin/analytics/retention',
    group: 'ANÁLISE',
    requires: 'reports:read',
  },
  { label: 'Receita', href: '/dashboard/super-admin/analytics/revenue', group: 'ANÁLISE', requires: 'reports:read' },

  // ── Faturação (da Portucale às clínicas, não da clínica aos doentes) ──
  { label: 'Subscrições', href: '/dashboard/super-admin/billing/subscriptions', group: 'FATURAÇÃO' },
  { label: 'Pagamentos', href: '/dashboard/super-admin/billing/payments', group: 'FATURAÇÃO' },
  { label: 'Consumo', href: '/dashboard/super-admin/billing/usage', group: 'FATURAÇÃO' },
  { label: 'Faturas', href: '/dashboard/super-admin/billing/invoices', group: 'FATURAÇÃO' },

  // ── Segurança ──
  { label: 'Registo de Auditoria', href: '/dashboard/super-admin/audit', group: 'SEGURANÇA', requires: 'audit:read' },
  {
    label: 'Eventos de Segurança',
    href: '/dashboard/super-admin/security/events',
    group: 'SEGURANÇA',
    requires: 'audit:read',
  },
  { label: 'Sessões', href: '/dashboard/super-admin/security/sessions', group: 'SEGURANÇA', requires: 'users:manage' },
  // Segunda entrada para a MESMA página que 'Permissões' em UTILIZADORES — pedida nos
  // dois grupos. A chave de render em components/Sidebar.tsx é `group + href`, não o
  // href, precisamente por isto.
  {
    label: 'Permissões',
    href: '/dashboard/super-admin/permissions',
    group: 'SEGURANÇA',
    requires: 'permissions:manage',
  },

  // ── Definições ──
  { label: 'Plataforma', href: '/dashboard/super-admin/settings', group: 'DEFINIÇÕES' },
  { label: 'Políticas de IA', href: '/dashboard/super-admin/settings/ai-policies', group: 'DEFINIÇÕES' },
  { label: 'Feature Flags', href: '/dashboard/super-admin/settings/feature-flags', group: 'DEFINIÇÕES' },
  { label: 'Configuração do Sistema', href: '/dashboard/super-admin/settings/system', group: 'DEFINIÇÕES' },
  // Não estava na lista pedida, mas a página existe e funciona (campos personalizados por
  // clínica). Sem esta entrada ficava órfã, como o /dashboard/dentist/notes.
  { label: 'Campos Schema', href: '/dashboard/super-admin/schema', group: 'DEFINIÇÕES', requires: 'schema:manage' },
];

export const NAV: Record<Role, NavItem[]> = {
  super_admin: SUPER_ADMIN_NAV,
  admin: ADMIN_NAV,
  receptionist: [
    { label: 'Painel', href: '/dashboard/receptionist' },
    { label: 'Marcações', href: '/dashboard/receptionist/appointments', requires: 'appointments:update' },
    { label: 'Doentes', href: '/dashboard/receptionist/patients' },
    { label: 'Leads', href: '/dashboard/receptionist/leads' },
    { label: 'Tratamentos', href: '/dashboard/receptionist/treatments', requires: 'treatments:read' },
    { label: 'Sala de Espera', href: '/dashboard/receptionist/floor', requires: 'appointments:status' },
    { label: 'Faturas', href: '/dashboard/receptionist/invoices', requires: 'invoices:read' },
    { label: 'Finanças', href: '/dashboard/receptionist/finance', requires: 'finance:read' },
    { label: 'Recuperação', href: '/dashboard/receptionist/recovery', requires: 'recovery:read' },
    { label: 'Agenda Inteligente', href: '/dashboard/receptionist/schedule-intel', requires: 'schedule:read' },
    { label: 'Jornada do Paciente', href: '/dashboard/receptionist/lifecycle', requires: 'lifecycle:read' },
    { label: 'Recalls', href: '/dashboard/receptionist/recalls', requires: 'recalls:read' },
    { label: 'Tarefas', href: '/dashboard/receptionist/tasks', requires: 'patient-tasks:read' },
    { label: 'Lembretes', href: '/dashboard/receptionist/notifications', requires: 'notifications:read' },
    { label: 'Equipa', href: '/dashboard/receptionist/team' },
    { label: 'Documentos', href: '/dashboard/receptionist/documents', requires: 'documents:read' },
    { label: 'Operações', href: '/dashboard/receptionist/operations', requires: 'checklists:run' },
  ],
  dentist: [
    { label: 'Painel', href: '/dashboard/dentist' },
    { label: 'Doentes', href: '/dashboard/dentist/patients' },
    { label: 'Tratamentos', href: '/dashboard/dentist/treatments', requires: 'treatments:read' },
    { label: 'Marcações', href: '/dashboard/dentist/appointments', requires: 'appointments:status' },
    { label: 'Histórico Clínico', href: '/dashboard/dentist/medical-history', requires: 'medical-history:read' },
    { label: 'Prescrições', href: '/dashboard/dentist/prescriptions', requires: 'prescriptions:read' },
    { label: 'Encomendas Lab', href: '/dashboard/dentist/lab-orders', requires: 'lab-orders:read' },
    { label: 'Planos Tratamento', href: '/dashboard/dentist/treatment-plans', requires: 'treatment-plans:read' },
    { label: 'Recalls', href: '/dashboard/dentist/recalls', requires: 'recalls:read' },
    { label: 'Tarefas', href: '/dashboard/dentist/tasks', requires: 'patient-tasks:read' },
    { label: 'Consentimentos', href: '/dashboard/dentist/consent-forms', requires: 'consent-forms:read' },
    { label: 'Documentos', href: '/dashboard/dentist/documents', requires: 'documents:read' },
    { label: 'Agenda Inteligente', href: '/dashboard/dentist/schedule-intel', requires: 'schedule:read' },
    // Estas duas páginas já existiam (app/dashboard/dentist/{operations,team}) e o
    // dentista já tinha as ações que elas exigem, mas não havia entrada no menu que lá
    // chegasse. A receção tem a mesma página e o link desde sempre.
    { label: 'Operações', href: '/dashboard/dentist/operations', requires: 'checklists:run' },
    { label: 'Equipa', href: '/dashboard/dentist/team' },
  ],
};

export const ROLE_META = {
  super_admin: { label: 'Super Admin', sub: 'Plataforma' },
  admin: { label: 'Administrador', sub: 'Acesso clínica' },
  receptionist: { label: 'Rececionista', sub: 'Receção' },
  dentist: { label: 'Médico Dentista', sub: 'Clínico' },
};

export const ROLE_HOME = {
  super_admin: '/dashboard/super-admin',
  admin: '/dashboard/admin',
  receptionist: '/dashboard/receptionist',
  dentist: '/dashboard/dentist',
};

export const INSURERS = ['ADSE', 'Médis', 'Multicare', 'AdvanceCare', 'SAMS', 'Fidelidade', 'Allianz', 'Particular'];

export function formatEUR(value: number): string {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
}

export function formatDatePT(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatPhonePT(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

export interface AppointmentTypeOption {
  label: string;
  defaultDuration: number; // minutes
  // Both optional — most types need neither. When set, lib/scheduling.ts's
  // suggestAppointmentSlots uses them to prefer/require a matching dentist
  // (requiredSpecialty, matched against users.specialties) and a chair that
  // has the tagged equipment (requiredEquipmentTags, matched against
  // clinic_equipment.tags) — "encontrar dentista adequado" / "encontrar
  // equipamento necessário". Best-effort: if nothing matches, the engine
  // falls back to an unfiltered suggestion with a warning rather than
  // returning nothing (see suggestAppointmentSlots).
  requiredSpecialty?: string;
  requiredEquipmentTags?: string[];
}

// The fixed list of appointment types offered in the booking modal
// (app/dashboard/receptionist/page.tsx). Lives here (not lib/scheduling.ts,
// which pulls in the server-only `pg`-backed query() helper) so client
// components can import it directly without dragging Node-only code into the
// browser bundle. There is no link to `treatment_codes`/TANOMD here on
// purpose: those are clinical procedure codes used on `treatments` records,
// not on `appointments.type`, which has always been a free-text label picked
// from this fixed list (or typed manually) — see app/api/appointments/route.ts,
// which stores `type` as-is with no FK.
// Os rótulos são gravados tal e qual em `appointments.type` e em
// `procedure_item_usage.appointment_type` — não são chaves com tradução por
// cima. Traduzi-los é por isso uma migração de dados, não uma mudança de UI:
// ver scripts/migrations/045_appointment_types_pt.sql, que reescreve as linhas
// já existentes. Mudar um rótulo aqui sem acrescentar lá o mapeamento deixa as
// consultas antigas órfãs do catálogo (perdem requiredSpecialty /
// requiredEquipmentTags) e desliga a previsão de consumo desse procedimento.
export const APPOINTMENT_TYPES: AppointmentTypeOption[] = [
  { label: 'Consulta de Avaliação', defaultDuration: 45 },
  { label: 'Destartarização', defaultDuration: 45 },
  { label: 'Avaliação Radiográfica', defaultDuration: 15, requiredEquipmentTags: ['xray'] },
  { label: 'Endodontia', defaultDuration: 60, requiredEquipmentTags: ['endo_motor'] },
  { label: 'Preparação de Coroa', defaultDuration: 60 },
  { label: 'Extração', defaultDuration: 30 },
  { label: 'Branqueamento', defaultDuration: 60, requiredEquipmentTags: ['whitening_lamp'] },
  { label: 'Consulta de Implantologia', defaultDuration: 30, requiredSpecialty: 'Implantologia' },
  {
    label: 'Reabilitação Oral Completa',
    defaultDuration: 120,
    requiredSpecialty: 'Reabilitação Oral',
  },
  { label: 'Consulta de Ortodontia', defaultDuration: 30, requiredSpecialty: 'Ortodontia' },
];

export const DEFAULT_APPOINTMENT_DURATION = 30;

export function getDefaultDuration(type: string): number {
  return APPOINTMENT_TYPES.find((t) => t.label === type)?.defaultDuration ?? DEFAULT_APPOINTMENT_DURATION;
}

// A caller-typed type that isn't in the fixed list (allowed — see the comment on
// APPOINTMENT_TYPES above) simply requires nothing extra.
export function getAppointmentTypeOption(type: string): AppointmentTypeOption | null {
  return APPOINTMENT_TYPES.find((t) => t.label === type) ?? null;
}
