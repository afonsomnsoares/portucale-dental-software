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

export const NAV = {
  admin: [
    { label: 'Visão Geral', href: '/dashboard/admin' },
    { label: 'Utilizadores', href: '/dashboard/admin/users' },
    { label: 'Clínicas', href: '/dashboard/admin/tenants' },
    { label: 'Campos Schema', href: '/dashboard/admin/schema' },
    { label: 'Permissões', href: '/dashboard/admin/permissions' },
    { label: 'Relatórios', href: '/dashboard/admin/reports' },
    { label: 'Recuperação', href: '/dashboard/admin/recovery' },
    { label: 'Agenda Inteligente', href: '/dashboard/admin/schedule-intel' },
    { label: 'Ciclo de Vida', href: '/dashboard/admin/lifecycle' },
    { label: 'Auditoria', href: '/dashboard/admin/audit' },
    { label: 'Faturas', href: '/dashboard/admin/invoices' },
    { label: 'Finanças', href: '/dashboard/admin/finance' },
    { label: 'Inventário', href: '/dashboard/admin/inventory' },
  ],
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
    { label: 'Ciclo de Vida', href: '/dashboard/receptionist/lifecycle' },
    { label: 'Recalls', href: '/dashboard/receptionist/recalls' },
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
    { label: 'Consentimentos', href: '/dashboard/dentist/consent-forms' },
  ],
};

export const ROLE_META = {
  admin: { label: 'Administrador', sub: 'Acesso sistema' },
  receptionist: { label: 'Rececionista', sub: 'Receção' },
  dentist: { label: 'Médico Dentista', sub: 'Clínico' },
};

export const ROLE_HOME = {
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
