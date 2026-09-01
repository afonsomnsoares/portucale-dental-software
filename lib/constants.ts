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

// 'admin' (clinic admin, tenant-scoped)'s own nav, hrefs under /dashboard/admin.
// super_admin (platform-wide, no clinic of its own) gets the mirrored PLATFORM_NAV below,
// under the separate /dashboard/platform prefix — the two roles no longer share a URL
// tree (see middleware.ts's DASHBOARD_ACCESS) even though most of these 14 pages render
// the exact same component either way: each one already scopes itself to the caller's
// own tenant for a clinic admin, or shows a tenant picker for super_admin (see that
// pattern across app/api/*, and components/admin/pages/*).
const ADMIN_NAV: Array<{ label: string; href: string }> = [
  { label: 'Visão Geral', href: '/dashboard/admin' },
  { label: 'Utilizadores', href: '/dashboard/admin/users' },
  { label: 'Campos Schema', href: '/dashboard/admin/schema' },
  { label: 'Permissões', href: '/dashboard/admin/permissions' },
  { label: 'Relatórios', href: '/dashboard/admin/reports' },
  { label: 'Recuperação', href: '/dashboard/admin/recovery' },
  { label: 'Agenda Inteligente', href: '/dashboard/admin/schedule-intel' },
  { label: 'Jornada do Paciente', href: '/dashboard/admin/lifecycle' },
  { label: 'Auditoria', href: '/dashboard/admin/audit' },
  { label: 'Faturas', href: '/dashboard/admin/invoices' },
  { label: 'Finanças', href: '/dashboard/admin/finance' },
  { label: 'Inventário', href: '/dashboard/admin/inventory' },
  { label: 'Fontes de Leads', href: '/dashboard/admin/lead-sources' },
  { label: 'Equipa', href: '/dashboard/admin/team' },
  { label: 'Operações', href: '/dashboard/admin/operations' },
];

// super_admin's own tree, mirroring ADMIN_NAV's 14 entries under /dashboard/platform
// instead of /dashboard/admin (see ROLE_HOME below and middleware.ts's DASHBOARD_ACCESS —
// the two roles no longer share a URL prefix, so this can't just reuse ADMIN_NAV's hrefs
// directly), plus 'Clínicas' (platform-only — see app/api/tenants/route.ts's
// requireSuperAdmin), inserted right after 'Visão Geral'/'Utilizadores' same as before.
const PLATFORM_NAV: Array<{ label: string; href: string }> = ADMIN_NAV.map((item) => ({
  ...item,
  href: item.href.replace('/dashboard/admin', '/dashboard/platform'),
}));
PLATFORM_NAV.splice(2, 0, { label: 'Clínicas', href: '/dashboard/platform/tenants' });

export const NAV = {
  super_admin: PLATFORM_NAV,
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
    { label: 'Agenda Inteligente', href: '/dashboard/receptionist/schedule-intel' },
    { label: 'Jornada do Paciente', href: '/dashboard/receptionist/lifecycle' },
    { label: 'Recalls', href: '/dashboard/receptionist/recalls' },
    { label: 'Tarefas', href: '/dashboard/receptionist/tasks' },
    { label: 'Lembretes', href: '/dashboard/receptionist/notifications' },
    { label: 'Equipa', href: '/dashboard/receptionist/team' },
    { label: 'Operações', href: '/dashboard/receptionist/operations' },
  ],
  dentist: [
    { label: 'Painel', href: '/dashboard/dentist' },
    { label: 'Doentes', href: '/dashboard/dentist/patients' },
    { label: 'Tratamentos', href: '/dashboard/dentist/treatments' },
    { label: 'Odontograma', href: '/dashboard/dentist/odontogram' },
    { label: 'Histórico Clínico', href: '/dashboard/dentist/medical-history' },
    { label: 'Prescrições', href: '/dashboard/dentist/prescriptions' },
    { label: 'Encomendas Lab', href: '/dashboard/dentist/lab-orders' },
    { label: 'Planos Tratamento', href: '/dashboard/dentist/treatment-plans' },
    { label: 'Recalls', href: '/dashboard/dentist/recalls' },
    { label: 'Tarefas', href: '/dashboard/dentist/tasks' },
    { label: 'Consentimentos', href: '/dashboard/dentist/consent-forms' },
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
  super_admin: '/dashboard/platform',
  admin: '/dashboard/admin',
  receptionist: '/dashboard/receptionist',
  dentist: '/dashboard/dentist',
};

// A handful of shared page components (Invoices → invoice detail, Reports → Recovery)
// link to another page within the same admin/platform tree. Since the identical
// component now mounts at two different prefixes (app/dashboard/admin/*/page.tsx and
// app/dashboard/platform/*/page.tsx both rendering it — see components/admin/pages/),
// it can't hardcode which one it's in; call this with the current usePathname() instead.
export function basePathFor(pathname: string): '/dashboard/admin' | '/dashboard/platform' {
  return pathname.startsWith('/dashboard/platform') ? '/dashboard/platform' : '/dashboard/admin';
}

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
export const APPOINTMENT_TYPES: AppointmentTypeOption[] = [
  { label: 'Comprehensive Exam', defaultDuration: 45 },
  { label: 'Hygiene Cleaning', defaultDuration: 45 },
  { label: 'X-Ray Review', defaultDuration: 15, requiredEquipmentTags: ['xray'] },
  { label: 'Root Canal', defaultDuration: 60, requiredEquipmentTags: ['endo_motor'] },
  { label: 'Crown Preparation', defaultDuration: 60 },
  { label: 'Extraction', defaultDuration: 30 },
  { label: 'Whitening', defaultDuration: 60, requiredEquipmentTags: ['whitening_lamp'] },
  { label: 'Implant Consultation', defaultDuration: 30, requiredSpecialty: 'Implantologia' },
  {
    label: 'Full Mouth Rehabilitation',
    defaultDuration: 120,
    requiredSpecialty: 'Reabilitação Oral',
  },
  { label: 'Orthodontic Consult', defaultDuration: 30, requiredSpecialty: 'Ortodontia' },
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
