export const C = {
  P: '#0052CC',
  PD: '#0747A6',
  PL: '#2684FF',
  PBG: '#DEEBFF',
  PBDR: '#4C9AFF',
  BG: '#F4F7FA',
  W: '#FFFFFF',
  BDR: '#DFE1E6',
  BDRL: '#EBECF0',
  T: '#172B4D',
  TM: '#5E6C84',
  TL: '#97A0AF',
  G: '#00875A',
  GB: '#E3FCEF',
  GBD: '#ABF5D1',
  AM: '#FF8B00',
  AMB: '#FFF7E6',
  AMBD: '#FFE380',
  R: '#DE350B',
  RB: '#FFEBE6',
  RBD: '#FFBDAD',
  PU: '#5243AA',
  PUB: '#EAE6FF',
  TL2: '#00A3BF',
  TLB: '#E6FCFF',
  SH: '0 1px 3px rgba(23,43,77,.10),0 0 0 1px rgba(23,43,77,.08)',
  SHM: '0 4px 12px rgba(23,43,77,.14),0 0 0 1px rgba(23,43,77,.08)',
};

export const FONTS = {
  body: "'DM Sans', system-ui, sans-serif",
  display: "'Bricolage Grotesque', 'DM Sans', sans-serif",
};

// Navegação do 'admin' (o admin da clínica, sempre confinado a um tenant), com hrefs sob
// /dashboard/admin. O super_admin (âmbito de plataforma, sem clínica própria) tem o
// SUPER_ADMIN_NAV espelhado abaixo, sob o prefixo separado /dashboard/super-admin. Os dois
// papéis não partilham nem a árvore de URLs (ver DASHBOARD_ACCESS em middleware.ts) nem os
// componentes de página: /dashboard/admin/* renderiza components/clinic/pages/*,
// /dashboard/super-admin/* renderiza components/super-admin/pages/*. As etiquetas coincidem
// porque os dois papéis fazem o mesmo *tipo* de trabalho, mas as páginas de clínica estão
// presas ao tenant de quem chama e as de plataforma escolhem a clínica primeiro.
const ADMIN_NAV: Array<{ label: string; href: string }> = [
  { label: 'Visão Geral', href: '/dashboard/admin' },
  { label: 'Utilizadores', href: '/dashboard/admin/users' },
  { label: 'Campos Schema', href: '/dashboard/admin/schema' },
  { label: 'Permissões', href: '/dashboard/admin/permissions' },
  { label: 'Recuperação', href: '/dashboard/admin/recovery' },
  { label: 'Agente de Agenda', href: '/dashboard/admin/schedule-intel' },
  { label: 'Jornada do Paciente', href: '/dashboard/admin/lifecycle' },
  { label: 'Auditoria', href: '/dashboard/admin/audit' },
  { label: 'Faturas', href: '/dashboard/admin/invoices' },
  { label: 'Finanças', href: '/dashboard/admin/finance' },
  { label: 'Inventário', href: '/dashboard/admin/inventory' },
  { label: 'Fontes de Leads', href: '/dashboard/admin/lead-sources' },
  { label: 'Equipa', href: '/dashboard/admin/team' },
  { label: 'Operações', href: '/dashboard/admin/operations' },
  { label: 'Agentes', href: '/dashboard/admin/agents' },
  { label: 'Documentos', href: '/dashboard/admin/documents' },
];

// Páginas do admin de clínica que NÃO existem sob /dashboard/super-admin. A regra
// geral é que as duas árvores são espelhadas (ver SUPER_ADMIN_NAV abaixo), mas
// estas duas dependem de haver uma clínica concreta, e o super_admin não tem
// tenantId próprio:
//
//   'Documentos' emite declarações para um doente de uma clínica — trabalho de
//   chão de clínica, não de plataforma.
//
//   'Agentes' mostra as execuções de job_runs desta clínica. GET /api/agents usa
//   o withRoute com a política de tenant por omissão ('required'), que devolve
//   403 a quem não tem tenantId. Um link aqui seria um beco — exatamente o que
//   acontece hoje com 'Tratamentos' na receção. Uma visão de plataforma sobre os
//   agentes é uma página diferente, com seletor de clínica, e ainda não existe.
const SUPER_ADMIN_NAV_EXCLUDE = new Set(['/dashboard/admin/documents', '/dashboard/admin/agents']);

// A árvore do super_admin, espelhando ADMIN_NAV (menos SUPER_ADMIN_NAV_EXCLUDE acima) sob
// /dashboard/super-admin em vez de /dashboard/admin (ver ROLE_HOME abaixo e o
// DASHBOARD_ACCESS de middleware.ts — os dois papéis não partilham prefixo, por isso isto
// não pode reutilizar os hrefs de ADMIN_NAV tal e qual), mais 'Clínicas' (só existe na
// plataforma — ver requireSuperAdmin em app/api/tenants/route.ts), inserida logo a seguir
// a 'Visão Geral'/'Utilizadores'.
const SUPER_ADMIN_NAV: Array<{ label: string; href: string }> = ADMIN_NAV.filter(
  (item) => !SUPER_ADMIN_NAV_EXCLUDE.has(item.href),
).map((item) => ({
  ...item,
  href: item.href.replace('/dashboard/admin', '/dashboard/super-admin'),
}));
SUPER_ADMIN_NAV.splice(2, 0, { label: 'Clínicas', href: '/dashboard/super-admin/tenants' });

export const NAV = {
  super_admin: SUPER_ADMIN_NAV,
  admin: ADMIN_NAV,
  receptionist: [
    { label: 'Painel', href: '/dashboard/receptionist' },
    { label: 'Marcações', href: '/dashboard/receptionist/appointments' },
    { label: 'Doentes', href: '/dashboard/receptionist/patients' },
    { label: 'Leads', href: '/dashboard/receptionist/leads' },
    { label: 'Tratamentos', href: '/dashboard/receptionist/treatments' },
    { label: 'Sala de Espera', href: '/dashboard/receptionist/floor' },
    { label: 'Faturas', href: '/dashboard/receptionist/invoices' },
    { label: 'Finanças', href: '/dashboard/receptionist/finance' },
    { label: 'Recuperação', href: '/dashboard/receptionist/recovery' },
    { label: 'Agente de Agenda', href: '/dashboard/receptionist/schedule-intel' },
    { label: 'Jornada do Paciente', href: '/dashboard/receptionist/lifecycle' },
    { label: 'Recalls', href: '/dashboard/receptionist/recalls' },
    { label: 'Tarefas', href: '/dashboard/receptionist/tasks' },
    { label: 'Lembretes', href: '/dashboard/receptionist/notifications' },
    { label: 'Equipa', href: '/dashboard/receptionist/team' },
    { label: 'Documentos', href: '/dashboard/receptionist/documents' },
    { label: 'Operações', href: '/dashboard/receptionist/operations' },
  ],
  dentist: [
    { label: 'Painel', href: '/dashboard/dentist' },
    { label: 'Doentes', href: '/dashboard/dentist/patients' },
    { label: 'Tratamentos', href: '/dashboard/dentist/treatments' },
    { label: 'Histórico Clínico', href: '/dashboard/dentist/medical-history' },
    { label: 'Prescrições', href: '/dashboard/dentist/prescriptions' },
    { label: 'Encomendas Lab', href: '/dashboard/dentist/lab-orders' },
    { label: 'Planos Tratamento', href: '/dashboard/dentist/treatment-plans' },
    { label: 'Recalls', href: '/dashboard/dentist/recalls' },
    { label: 'Tarefas', href: '/dashboard/dentist/tasks' },
    { label: 'Consentimentos', href: '/dashboard/dentist/consent-forms' },
    { label: 'Documentos', href: '/dashboard/dentist/documents' },
    { label: 'Equipa', href: '/dashboard/dentist/team' },
    { label: 'Operações', href: '/dashboard/dentist/operations' },
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
  // A consulta de seguimento: a segunda, a terceira e a décima sessão de um
  // plano já aceite. Faltava ao catálogo — marcava-se escrevendo à mão, o que a
  // deixava fora de tudo o que se agarra ao rótulo (previsão de consumo,
  // requisitos de equipamento) e, agora, fora do Dynamic Scheduling: é o tipo
  // com que um plano de tratamento parado volta à cadeira (ver
  // FOLLOW_UP_APPOINTMENT_TYPE abaixo e lib/demandPool.ts).
  { label: 'Consulta de Acompanhamento', defaultDuration: 30 },
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

// O tipo com que se retoma um tratamento cuja descrição não corresponde a
// nenhum rótulo do catálogo — o caso normal, porque `treatments.description` é
// texto clínico escrito por quem propôs o plano, não uma escolha desta lista.
export const FOLLOW_UP_APPOINTMENT_TYPE = 'Consulta de Acompanhamento';
// O tipo com que se marca um recall vencido ou se reativa um doente parado:
// primeiro vê-se a boca, decide-se depois.
export const CHECKUP_APPOINTMENT_TYPE = 'Consulta de Avaliação';
// O tipo de uma higiene — o recall mais comum de todos.
export const HYGIENE_APPOINTMENT_TYPE = 'Destartarização';

/**
 * Mapeia texto livre (um `recalls.recall_type`, uma descrição de tratamento)
 * para um rótulo do catálogo. Sem correspondência devolve null e quem chama
 * decide o que fazer — nunca se inventa um tipo, porque o tipo determina
 * duração, especialidade e equipamento exigidos.
 */
export function matchAppointmentType(text: unknown): string | null {
  const needle = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!needle) return null;

  const normalized = (label: string) =>
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const exact = APPOINTMENT_TYPES.find((t) => normalized(t.label) === needle);
  if (exact) return exact.label;

  // Os valores que o produto já grava em `recalls.recall_type` desde o início
  // (ver scripts/seed.ts) são chaves em inglês, anteriores ao catálogo em
  // português — traduzi-las aqui evita uma migração de dados clínicos por uma
  // questão de vocabulário.
  const ALIASES: Record<string, string> = {
    checkup: CHECKUP_APPOINTMENT_TYPE,
    'check-up': CHECKUP_APPOINTMENT_TYPE,
    revisao: CHECKUP_APPOINTMENT_TYPE,
    avaliacao: CHECKUP_APPOINTMENT_TYPE,
    prophylaxis: HYGIENE_APPOINTMENT_TYPE,
    higiene: HYGIENE_APPOINTMENT_TYPE,
    limpeza: HYGIENE_APPOINTMENT_TYPE,
    destartarizacao: HYGIENE_APPOINTMENT_TYPE,
    'follow-up': FOLLOW_UP_APPOINTMENT_TYPE,
    followup: FOLLOW_UP_APPOINTMENT_TYPE,
    seguimento: FOLLOW_UP_APPOINTMENT_TYPE,
    acompanhamento: FOLLOW_UP_APPOINTMENT_TYPE,
  };
  if (ALIASES[needle]) return ALIASES[needle];

  // Último recurso: a descrição contém o nome de um procedimento do catálogo
  // ("Endodontia do 26", "branqueamento — 2.ª sessão").
  const contained = APPOINTMENT_TYPES.find((t) => needle.includes(normalized(t.label)));
  return contained?.label ?? null;
}

export function getDefaultDuration(type: string): number {
  return APPOINTMENT_TYPES.find((t) => t.label === type)?.defaultDuration ?? DEFAULT_APPOINTMENT_DURATION;
}

// A caller-typed type that isn't in the fixed list (allowed — see the comment on
// APPOINTMENT_TYPES above) simply requires nothing extra.
export function getAppointmentTypeOption(type: string): AppointmentTypeOption | null {
  return APPOINTMENT_TYPES.find((t) => t.label === type) ?? null;
}
