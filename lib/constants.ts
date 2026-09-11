// Mínimo de caracteres de uma password, partilhado pelo servidor (app/api/users/route.ts,
// app/api/users/[id]/route.ts) e pelos formulários que lá escrevem. Estava escrito à mão
// em cada um dos sítios: o formulário deixava submeter qualquer password não-vazia e só o
// servidor recusava, pelo que a pessoa preenchia tudo e levava com um 400 no fim.
export const MIN_PASSWORD_LENGTH = 10;
export const BCRYPT_COST = 10;
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

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
// ─── Navegação: um grupo por pergunta que o papel faz ───────────────────────
// As quatro listas passaram a ter `group`. Antes só o super_admin agrupava, porque só a
// dele não cabia num ecrã; as outras três cresceram para 16-18 entradas planas e
// tornaram-se igualmente difíceis de varrer — a do dentista obrigava-o a saltar entre
// dezasseis links para juntar a história de UMA pessoa.
//
// Os grupos não são decoração: cada um é uma pergunta que aquele papel faz durante o
// dia, e a ordem é a ordem em que ele a faz. Se uma entrada não couber em nenhuma
// pergunta, é sinal de que pertence a outro papel.
//
// As entradas marcadas ★ nos comentários abaixo são ecrãs a construir sobre API que já
// existe e não tinha consumidor nenhum. Não estão nesta lista enquanto a página não
// existir: uma entrada de menu sem página é um link morto, e test/nav.test.ts recusa-o.

// ─── admin: o dono da clínica ───────────────────────────────────────────────
// «Estamos a ganhar dinheiro, e o que está a correr mal?»
//
// Absorve o que noutro desenho seria um papel 'manager' à parte. As duas listas
// sobrepunham-se em ~70% e a diferença real era o horizonte de tempo, não o que a pessoa
// pode fazer — e isso resolve-se na página inicial (uma secção «Hoje», uma «Direção»),
// não com uma segunda árvore de permissões a manter. Quando existir uma clínica com um
// gestor que não é o dono, 'manager' nasce em lib/permissions.ts como «admin menos
// Financeiro menos Definições» e PARTILHA esta árvore.
const ADMIN_NAV: NavItem[] = [
  { label: 'Painel', href: '/dashboard/admin', group: 'VISÃO GERAL' },
  { label: 'Agentes', href: '/dashboard/admin/agents', group: 'VISÃO GERAL', requires: 'agents:read' },

  // Sem lista de doentes: a pergunta do dono não é «quem são», é «o que está a acontecer
  // à carteira». A Jornada responde a isso, e a Análise de Doentes (★ /api/patient-scoring)
  // vem para aqui quando existir. Uma lista de fichas pertence a quem atende ao balcão e
  // a quem trata — e esses já a têm.
  { label: 'Jornada', href: '/dashboard/admin/lifecycle', group: 'DOENTES', requires: 'lifecycle:read' },
  {
    label: 'Análise de Doentes',
    href: '/dashboard/admin/patient-scoring',
    group: 'DOENTES',
    requires: 'lifecycle:read',
  },

  { label: 'Agenda Inteligente', href: '/dashboard/admin/schedule-intel', group: 'AGENDA', requires: 'schedule:read' },
  { label: 'Previsão', href: '/dashboard/admin/forecast', group: 'AGENDA', requires: 'reports:read' },

  { label: 'Recuperação', href: '/dashboard/admin/recovery', group: 'RECEITA', requires: 'recovery:read' },
  { label: 'Relatórios', href: '/dashboard/admin/reports', group: 'RECEITA', requires: 'reports:read' },
  { label: 'Recalls', href: '/dashboard/admin/recalls', group: 'RECEITA', requires: 'recalls:read' },
  { label: 'Faturas', href: '/dashboard/admin/invoices', group: 'RECEITA', requires: 'invoices:read' },

  { label: 'Finanças', href: '/dashboard/admin/finance', group: 'FINANCEIRO', requires: 'finance:read' },
  { label: 'Custos e Margem', href: '/dashboard/admin/costing', group: 'FINANCEIRO', requires: 'finance:read' },

  { label: 'Equipa e Horários', href: '/dashboard/admin/team', group: 'EQUIPA', requires: 'staff-schedules:manage' },

  {
    label: 'Stock e Encomendas',
    href: '/dashboard/admin/inventory',
    group: 'INVENTÁRIO',
    requires: 'inventory:manage',
  },

  {
    label: 'Checklists e Incidentes',
    href: '/dashboard/admin/operations',
    group: 'OPERAÇÕES',
    requires: 'checklists:run',
  },
  {
    label: 'Percursos de Consulta',
    href: '/dashboard/admin/care-pathways',
    group: 'OPERAÇÕES',
    requires: 'care-pathways:manage',
  },
  { label: 'Documentos', href: '/dashboard/admin/documents', group: 'OPERAÇÕES', requires: 'documents:read' },

  { label: 'Utilizadores', href: '/dashboard/admin/users', group: 'DEFINIÇÕES', requires: 'users:manage' },
  { label: 'Permissões', href: '/dashboard/admin/permissions', group: 'DEFINIÇÕES', requires: 'permissions:manage' },
  { label: 'Campos Schema', href: '/dashboard/admin/schema', group: 'DEFINIÇÕES', requires: 'schema:manage' },
  {
    label: 'Fontes de Leads',
    href: '/dashboard/admin/lead-sources',
    group: 'DEFINIÇÕES',
    requires: 'lead-sources:manage',
  },
  { label: 'Canais e Autonomia', href: '/dashboard/admin/comms', group: 'DEFINIÇÕES', requires: 'conversations:read' },
  { label: 'Proteção de Dados', href: '/dashboard/admin/data-protection', group: 'DEFINIÇÕES', requires: 'gdpr:read' },
  { label: 'Auditoria', href: '/dashboard/admin/audit', group: 'DEFINIÇÕES', requires: 'audit:read' },
];

// ─── O que é separador e não entrada de menu ────────────────────────────────
// Cinco coisas do desenho original não têm entrada própria porque vivem dentro do ecrã
// a que pertencem, e separá-las seria arrumar por tabela em vez de por trabalho:
//
//   Lista de Espera      → separador de Agenda Inteligente. Só faz sentido ao lado das
//                          vagas que a alimentam e do otimizador que a consome.
//   Fornecedores         → separador de Inventário. Um fornecedor existe para se lhe
//   Equipamento             encomendar; o equipamento tem stock e manutenção como o resto.
//   Passagens de Turno   → separador de Equipa (TeamRosterView).
//   Pedidos do Portal    → dentro da ficha do doente (PatientTasksTab), que é onde se
//                          decide o que pedir e a quem.
//   Alertas da clínica   → dentro de Agentes, que é quem os escreve (agent_insights).
//
// Estão todas alcançáveis. O que não têm é um link de topo — e um menu que liste tudo o
// que existe deixa de ser um menu.

// ─── receptionist: o balcão ─────────────────────────────────────────────────
// «Quem chega agora e o que tenho de fazer?»
//
// A ordem é a do dia: o que se passa hoje primeiro, comunicação a seguir (é o que
// interrompe), e o resto por baixo. 'Painel' passou a ser a primeira entrada do grupo
// HOJE em vez de uma raiz solta.
const RECEPTIONIST_NAV: NavItem[] = [
  { label: 'Painel do Dia', href: '/dashboard/receptionist', group: 'HOJE' },
  { label: 'Agenda', href: '/dashboard/receptionist/appointments', group: 'HOJE', requires: 'appointments:update' },
  { label: 'Sala de Espera', href: '/dashboard/receptionist/floor', group: 'HOJE', requires: 'appointments:status' },
  { label: 'Tarefas', href: '/dashboard/receptionist/tasks', group: 'HOJE', requires: 'patient-tasks:read' },

  {
    label: 'Caixa de Entrada',
    href: '/dashboard/receptionist/inbox',
    group: 'COMUNICAÇÃO',
    requires: 'conversations:read',
  },
  {
    label: 'Lembretes',
    href: '/dashboard/receptionist/notifications',
    group: 'COMUNICAÇÃO',
    requires: 'notifications:read',
  },

  { label: 'Doentes', href: '/dashboard/receptionist/patients', group: 'DOENTES' },
  { label: 'Leads', href: '/dashboard/receptionist/leads', group: 'DOENTES' },

  {
    label: 'Cancelamentos',
    href: '/dashboard/receptionist/cancellations',
    group: 'MARCAÇÕES',
    requires: 'schedule:read',
  },
  {
    label: 'Agenda Inteligente',
    href: '/dashboard/receptionist/schedule-intel',
    group: 'MARCAÇÕES',
    requires: 'schedule:read',
  },

  { label: 'Recalls', href: '/dashboard/receptionist/recalls', group: 'SEGUIMENTO', requires: 'recalls:read' },
  {
    label: 'Tratamentos',
    href: '/dashboard/receptionist/treatments',
    group: 'SEGUIMENTO',
    requires: 'treatments:read',
  },
  {
    label: 'Jornada do Doente',
    href: '/dashboard/receptionist/lifecycle',
    group: 'SEGUIMENTO',
    requires: 'lifecycle:read',
  },

  { label: 'Faturas', href: '/dashboard/receptionist/invoices', group: 'PAGAMENTOS', requires: 'invoices:read' },
  { label: 'Recuperação', href: '/dashboard/receptionist/recovery', group: 'PAGAMENTOS', requires: 'recovery:read' },
  { label: 'Finanças', href: '/dashboard/receptionist/finance', group: 'PAGAMENTOS', requires: 'finance:read' },

  { label: 'Checklists', href: '/dashboard/receptionist/operations', group: 'OPERAÇÕES', requires: 'checklists:run' },
  { label: 'Equipa', href: '/dashboard/receptionist/team', group: 'OPERAÇÕES' },
  { label: 'Documentos', href: '/dashboard/receptionist/documents', group: 'OPERAÇÕES', requires: 'documents:read' },
];

// ─── dentist: o gabinete ────────────────────────────────────────────────────
// «Quem é este doente e o que falta fazer-lhe?»
//
// A lista era plana e obrigava a saltar entre dezasseis entradas para juntar a história
// de uma pessoa. O grupo CLÍNICO junta o que se faz A um doente; o Espaço do Doente
// (★, por construir) inverte a navegação — abre-se a pessoa e o resto são separadores.
//
// Fora desta lista por decisão de produto, não por esquecimento: odontograma e
// imagiologia (fora de âmbito, ver PRODUCT.md — o odontograma chegou a existir e foi
// removido duas vezes) e qualquer assistente clínico de IA. As notas por voz existem,
// mas como botão dentro de PatientNotesTab: é onde se escreve, não uma entrada de menu.
const DENTIST_NAV: NavItem[] = [
  { label: 'Hoje', href: '/dashboard/dentist', group: 'O MEU DIA' },
  { label: 'Marcações', href: '/dashboard/dentist/appointments', group: 'O MEU DIA', requires: 'appointments:status' },
  { label: 'Tarefas', href: '/dashboard/dentist/tasks', group: 'O MEU DIA', requires: 'patient-tasks:read' },

  // Uma entrada só, e não «lista» + «espaço»: a página É o espaço, e entra-se nele pela
  // lista que tem à esquerda. Duas entradas para o mesmo ecrã seriam duas maneiras de
  // dizer a mesma coisa.
  { label: 'Espaço do Doente', href: '/dashboard/dentist/patients', group: 'DOENTES' },

  {
    label: 'Planos de Tratamento',
    href: '/dashboard/dentist/treatment-plans',
    group: 'CLÍNICO',
    requires: 'treatment-plans:read',
  },
  { label: 'Tratamentos', href: '/dashboard/dentist/treatments', group: 'CLÍNICO', requires: 'treatments:read' },
  {
    label: 'Histórico Clínico',
    href: '/dashboard/dentist/medical-history',
    group: 'CLÍNICO',
    requires: 'medical-history:read',
  },
  { label: 'Prescrições', href: '/dashboard/dentist/prescriptions', group: 'CLÍNICO', requires: 'prescriptions:read' },
  {
    label: 'Consentimentos',
    href: '/dashboard/dentist/consent-forms',
    group: 'CLÍNICO',
    requires: 'consent-forms:read',
  },
  { label: 'Encomendas de Lab', href: '/dashboard/dentist/lab-orders', group: 'CLÍNICO', requires: 'lab-orders:read' },
  { label: 'Documentos', href: '/dashboard/dentist/documents', group: 'CLÍNICO', requires: 'documents:read' },

  { label: 'Recalls', href: '/dashboard/dentist/recalls', group: 'SEGUIMENTO', requires: 'recalls:read' },
  {
    label: 'Agenda Inteligente',
    href: '/dashboard/dentist/schedule-intel',
    group: 'SEGUIMENTO',
    requires: 'schedule:read',
  },

  { label: 'Equipa', href: '/dashboard/dentist/team', group: 'EQUIPA' },
  { label: 'Operações', href: '/dashboard/dentist/operations', group: 'EQUIPA', requires: 'checklists:run' },
];

// ─── super_admin: a plataforma ──────────────────────────────────────────────
// «A plataforma está de pé, e quanto é que ela nos custa?»
//
// As páginas de clínica (Faturas, Finanças, Inventário, Equipa, Operações, Recuperação,
// Agenda Inteligente, Jornada, Fontes de Leads) não estão aqui e não voltam: chega-se a
// elas entrando na clínica (POST /api/tenants/enter), que leva às páginas do próprio
// admin. Uma árvore em vez de duas a divergir.
//
// ─── Porque é que INTEGRAÇÕES e FATURAÇÃO saíram ────────────────────────────
// Oito entradas, oito páginas NotInstrumented, zero tabelas por baixo. MRR, ARR, churn e
// expansão precisam de um modelo de subscrições que não existe — e que não deve ser
// inventado antes do primeiro cliente a pagar, porque a forma que ele tomar depende do
// que se acabar por vender. 'Localizações' e 'Todas as Organizações' saíram pela mesma
// razão de fundo: não há nada acima de `tenants`, a tabela é plana, e um dono com várias
// clínicas é uma migração de modelo de dados e não uma entrada de menu.
//
// As páginas ficam no repositório — dizem o que fariam e o que falta instrumentar. O que
// sai é o link: um menu que promete nove secções e entrega uma é pior do que um menu
// honesto de seis.
const SUPER_ADMIN_NAV: NavItem[] = [
  { label: 'Painel da Plataforma', href: '/dashboard/super-admin', group: 'VISÃO GERAL' },
  { label: 'Estado do Sistema', href: '/dashboard/super-admin/health', group: 'VISÃO GERAL' },
  { label: 'Alertas', href: '/dashboard/super-admin/alerts', group: 'VISÃO GERAL', requires: 'agents:read' },

  { label: 'Clínicas', href: '/dashboard/super-admin/tenants', group: 'ORGANIZAÇÕES', requires: 'tenants:manage' },
  { label: 'Onboarding', href: '/dashboard/super-admin/onboarding', group: 'ORGANIZAÇÕES', requires: 'tenants:manage' },

  {
    label: 'Todos os Utilizadores',
    href: '/dashboard/super-admin/users',
    group: 'UTILIZADORES',
    requires: 'users:manage',
  },
  { label: 'Papéis', href: '/dashboard/super-admin/roles', group: 'UTILIZADORES', requires: 'users:manage' },
  {
    label: 'Registos de Acesso',
    href: '/dashboard/super-admin/access-logs',
    group: 'UTILIZADORES',
    requires: 'audit:read',
  },

  { label: 'Agentes', href: '/dashboard/super-admin/ai/agents', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Modelos', href: '/dashboard/super-admin/ai/models', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Execuções', href: '/dashboard/super-admin/ai/runs', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Custos de IA', href: '/dashboard/super-admin/ai/costs', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Falhas', href: '/dashboard/super-admin/ai/failures', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Avaliações', href: '/dashboard/super-admin/ai/evaluations', group: 'AGENTES', requires: 'agents:read' },

  { label: 'Tarefas da Plataforma', href: '/dashboard/super-admin/ops/tasks', group: 'OPERAÇÕES' },
  { label: 'Incidentes', href: '/dashboard/super-admin/ops/incidents', group: 'OPERAÇÕES' },
  { label: 'Suporte', href: '/dashboard/super-admin/ops/support', group: 'OPERAÇÕES' },
  {
    label: 'Eventos de Sistema',
    href: '/dashboard/super-admin/ops/events',
    group: 'OPERAÇÕES',
    requires: 'audit:read',
  },

  // 'Análise da Plataforma' é a comparação entre clínicas do grupo — a única página desta
  // secção com dados reais desde sempre, e a superfície onde o agente Grupo escreve.
  {
    label: 'Análise da Plataforma',
    href: '/dashboard/super-admin/reports',
    group: 'ANÁLISE',
    requires: 'reports:read',
  },
  { label: 'Utilização', href: '/dashboard/super-admin/analytics/usage', group: 'ANÁLISE', requires: 'reports:read' },
  { label: 'Retenção', href: '/dashboard/super-admin/analytics/retention', group: 'ANÁLISE', requires: 'reports:read' },
  { label: 'Receita', href: '/dashboard/super-admin/analytics/revenue', group: 'ANÁLISE', requires: 'reports:read' },

  { label: 'Registo de Auditoria', href: '/dashboard/super-admin/audit', group: 'SEGURANÇA', requires: 'audit:read' },
  {
    label: 'Eventos de Segurança',
    href: '/dashboard/super-admin/security/events',
    group: 'SEGURANÇA',
    requires: 'audit:read',
  },
  { label: 'Sessões', href: '/dashboard/super-admin/security/sessions', group: 'SEGURANÇA', requires: 'users:manage' },

  { label: 'Plataforma', href: '/dashboard/super-admin/settings', group: 'DEFINIÇÕES' },
  { label: 'Políticas de IA', href: '/dashboard/super-admin/settings/ai-policies', group: 'DEFINIÇÕES' },
  { label: 'Feature Flags', href: '/dashboard/super-admin/settings/feature-flags', group: 'DEFINIÇÕES' },
  { label: 'Configuração', href: '/dashboard/super-admin/settings/system', group: 'DEFINIÇÕES' },
  { label: 'Campos Schema', href: '/dashboard/super-admin/schema', group: 'DEFINIÇÕES', requires: 'schema:manage' },
];

export const NAV: Record<Role, NavItem[]> = {
  super_admin: SUPER_ADMIN_NAV,
  admin: ADMIN_NAV,
  receptionist: RECEPTIONIST_NAV,
  dentist: DENTIST_NAV,
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
