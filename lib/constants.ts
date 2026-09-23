import { isoDate } from './pgDate';
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
// `group` agrupa entradas sob um cabeçalho na sidebar, e as quatro listas usam-no: o
// teste em test/nav.test.ts recusa uma entrada sem grupo. Ver components/Sidebar.tsx,
// que desenha o cabeçalho quando o grupo muda.
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

// ─── A regra: uma entrada é uma FILA, não uma tabela ────────────────────────
// O menu tinha 81 entradas somadas os quatro papéis, e a razão não era haver 81
// assuntos: era o menu ter crescido como espelho da árvore de rotas. Três padrões
// explicavam quase tudo o que sobrava.
//
//   O mesmo ecrã com um filtro diferente. Quatro entradas de plataforma liam o mesmo
//   `audit_log` mudando um array de ações; duas liam o mesmo /platform/ai-usage; duas
//   o mesmo /platform/usage. Um filtro não é um destino.
//
//   A mesma sala com várias portas. Seis entradas do dentista carregavam /patients,
//   obrigavam a escolher um doente e só então pediam `?patientId=` — eram o Espaço do
//   Doente com um separador aberto, alcançado por seis sítios.
//
//   A gaveta de configuração à mistura com o trabalho. Sete das 24 entradas do admin
//   eram DEFINIÇÕES. Nenhuma se abre durante o dia.
//
// A regra que ficou: uma entrada de topo é uma FILA DE TRABALHO a que alguém vai por
// iniciativa própria. Tudo o resto é separador dentro da coisa a que pertence. Nenhum
// papel passa das doze entradas, e nenhum menu tem scroll a 900 px de altura.
//
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
  // à carteira». Uma lista de fichas pertence a quem atende ao balcão e a quem trata — e
  // esses já a têm. As duas leituras que respondem à pergunta dele — a Jornada e a
  // Análise — são separadores de um ecrã só (ver pages/Doentes.tsx).
  { label: 'Agenda', href: '/dashboard/admin/schedule-intel', group: 'AGENDA E DOENTES', requires: 'schedule:read' },
  { label: 'Doentes', href: '/dashboard/admin/lifecycle', group: 'AGENDA E DOENTES', requires: 'lifecycle:read' },
  { label: 'Recalls', href: '/dashboard/admin/recalls', group: 'AGENDA E DOENTES', requires: 'recalls:read' },

  // Cinco entradas em duas. «Faturas» e «Recuperação» são a mesma fatura antes e depois
  // de não ter sido paga; «Finanças», «Custos e Margem» e «Relatórios» são a mesma
  // receita vista de três ângulos, e estavam em dois grupos diferentes do menu.
  { label: 'Faturação', href: '/dashboard/admin/invoices', group: 'DINHEIRO', requires: 'invoices:read' },
  { label: 'Receita e Custos', href: '/dashboard/admin/finance', group: 'DINHEIRO', requires: 'finance:read' },

  { label: 'Equipa e Horários', href: '/dashboard/admin/team', group: 'OPERAÇÕES', requires: 'staff-schedules:manage' },
  {
    label: 'Stock e Encomendas',
    href: '/dashboard/admin/inventory',
    group: 'OPERAÇÕES',
    requires: 'inventory:manage',
  },
  // «Percursos de Consulta» entrou aqui como separador: é o protocolo que as checklists
  // executam, e tinha entrada própria só porque tinha rota própria.
  { label: 'Operações', href: '/dashboard/admin/operations', group: 'OPERAÇÕES', requires: 'checklists:run' },
  { label: 'Documentos', href: '/dashboard/admin/documents', group: 'OPERAÇÕES', requires: 'documents:read' },

  // Sete entradas em uma. Nenhuma delas se abre durante o dia de trabalho, e juntas
  // ocupavam quase um terço da barra lateral — ver pages/Definicoes.tsx.
  //
  // Sem `requires`: o ecrã existe para quem tiver PELO MENOS uma das sete permissões, e
  // exigir uma delas em nome de todas escondia as outras seis a quem as tem. Cada
  // separador continua atrás da sua rota, que é quem decide.
  { label: 'Definições', href: '/dashboard/admin/settings', group: 'DEFINIÇÕES' },
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
  // Três entradas em uma: as consultas marcadas, os cancelamentos e a análise da agenda
  // estavam em dois grupos diferentes, e ninguém abre os cancelamentos sem ser para
  // voltar à agenda a seguir.
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
  { label: 'Recalls', href: '/dashboard/receptionist/recalls', group: 'DOENTES', requires: 'recalls:read' },
  // A «Jornada do Doente» entrou aqui como separador: ao balcão a pergunta é sempre «e
  // este, o que é que falta?», e a resposta estava metade em cada uma das duas entradas.
  {
    label: 'Tratamentos',
    href: '/dashboard/receptionist/treatments',
    group: 'DOENTES',
    requires: 'treatments:read',
  },

  // «Finanças» saiu do menu do balcão — e a página foi apagada. As contas do negócio não
  // são trabalho de receção: quem as quer ver é o dono, e para esse existem em Receita e
  // Custos. Não é uma página estacionada à espera de dados; é âmbito a encolher, e a
  // regra escrita em lib/constants.ts vale aqui: estacionar diz «ainda não», apagar diz
  // «não».
  { label: 'Faturação', href: '/dashboard/receptionist/invoices', group: 'PAGAMENTOS', requires: 'invoices:read' },

  // Checklists, Equipa e Documentos eram três entradas, e nenhuma é uma fila de
  // trabalho: são onde se vai confirmar uma coisa quando ela é precisa.
  { label: 'Clínica', href: '/dashboard/receptionist/operations', group: 'OPERAÇÕES', requires: 'checklists:run' },
];

// ─── dentist: o gabinete ────────────────────────────────────────────────────
// «Quem é este doente e o que falta fazer-lhe?»
//
// Era a lista mais longa por unidade de trabalho: quinze entradas, e SEIS delas eram o
// mesmo ecrã. «Planos de Tratamento», «Histórico Clínico», «Prescrições»,
// «Consentimentos», «Encomendas de Lab» e «Recalls» carregavam todas /patients, punham a
// mesma lista à esquerda, obrigavam a escolher uma pessoa e só então pediam
// `?patientId=`. Eram o Espaço do Doente com um separador aberto — e mudar de assunto
// sobre o MESMO doente obrigava a atravessar o menu e a escolhê-lo outra vez.
//
// Hoje são separadores lá dentro (ver app/dashboard/dentist/patients/page.tsx). Sobra
// «Tratamentos», que é a única lista transversal a doentes que o gabinete tem — pede
// /treatments sem filtro — e por isso a única que é mesmo uma fila.
//
// Fora desta lista por decisão de produto, não por esquecimento: odontograma e
// imagiologia (fora de âmbito, ver PRODUCT.md — o odontograma chegou a existir e foi
// removido duas vezes) e qualquer assistente clínico de IA. As notas por voz existem,
// mas como botão dentro de PatientNotesTab: é onde se escreve, não uma entrada de menu.
const DENTIST_NAV: NavItem[] = [
  { label: 'Hoje', href: '/dashboard/dentist', group: 'O MEU DIA' },
  { label: 'Marcações', href: '/dashboard/dentist/appointments', group: 'O MEU DIA', requires: 'appointments:status' },
  {
    label: 'Agenda Inteligente',
    href: '/dashboard/dentist/schedule-intel',
    group: 'O MEU DIA',
    requires: 'schedule:read',
  },
  { label: 'Tarefas', href: '/dashboard/dentist/tasks', group: 'O MEU DIA', requires: 'patient-tasks:read' },

  // Uma entrada só, e não «lista» + «espaço»: a página É o espaço, e entra-se nele pela
  // lista que tem à esquerda. Duas entradas para o mesmo ecrã seriam duas maneiras de
  // dizer a mesma coisa — que é exatamente o que as seis absorvidas eram.
  { label: 'Espaço do Doente', href: '/dashboard/dentist/patients', group: 'DOENTES' },
  { label: 'Tratamentos', href: '/dashboard/dentist/treatments', group: 'DOENTES', requires: 'treatments:read' },

  { label: 'Clínica', href: '/dashboard/dentist/operations', group: 'OPERAÇÕES', requires: 'checklists:run' },
];

// ─── super_admin: a plataforma ──────────────────────────────────────────────
// «A plataforma está de pé, e quanto é que ela nos custa?»
//
// As páginas de clínica (Faturas, Finanças, Inventário, Equipa, Operações, Recuperação,
// Agenda Inteligente, Jornada, Fontes de Leads) não estão aqui e não voltam: chega-se a
// elas entrando na clínica (POST /api/tenants/enter), que leva às páginas do próprio
// admin. Uma árvore em vez de duas a divergir.
//
// ─── A regra: o menu só liga o que está instrumentado ───────────────────────
// Uma entrada de menu é uma promessa. Uma página NotInstrumented é honesta com quem lá
// chega — diz o que faria e o que falta por baixo — mas só depois de a pessoa ter ido lá
// ver. O link é que promete, e um menu que promete e não entrega é pior do que um menu
// curto.
//
// Foi por isso que saíram as quatro entradas de INTEGRAÇÕES, e é por isso que saem agora
// as sete que sobravam do mesmo tipo: Avaliações, Tarefas da Plataforma, Suporte,
// Sessões, Plataforma, Políticas de IA e Feature Flags. Todas eram placeholders de ~20
// linhas atrás de um link no menu. As páginas ficam no repositório, como as das
// Integrações: o que sai é o link.
//
// A saída é reversível e o caminho de volta é conhecido — 'Configuração' esteve nesta
// lista e saiu dela ao ganhar `systemConfig()` por baixo. Instrumentar é o que repõe a
// entrada; até lá, o menu diz a verdade sobre o que a plataforma faz hoje.
//
// FATURAÇÃO: saiu inteira, páginas incluídas. Não é a mesma decisão — é o âmbito a
// encolher. Não há modelo de subscrições nem vai haver, por isso as quatro páginas de
// faturação e a de Receita foram apagadas em vez de estacionadas. Estacionar uma página
// diz «ainda não»; apagá-la diz «não».
//
// 'Localizações' e 'Todas as Organizações' saíram por uma terceira razão: não há nada
// acima de `tenants`, a tabela é plana, e um dono com várias clínicas é uma migração de
// modelo de dados e não uma entrada de menu.
const SUPER_ADMIN_NAV: NavItem[] = [
  { label: 'Painel da Plataforma', href: '/dashboard/super-admin', group: 'PLATAFORMA' },
  { label: 'Estado do Sistema', href: '/dashboard/super-admin/health', group: 'PLATAFORMA' },
  { label: 'Incidentes', href: '/dashboard/super-admin/ops/incidents', group: 'PLATAFORMA' },

  // Clínicas absorveu Onboarding: uma clínica por arrancar é um ESTADO de uma clínica,
  // e um estado não merece um destino próprio.
  { label: 'Clínicas', href: '/dashboard/super-admin/tenants', group: 'CLÍNICAS', requires: 'tenants:manage' },
  // O nível de grupo: capacidade, equipa, equipamento, audiência de campanha e previsão
  // somados das unidades todas. Fica com 'tenants:manage' (ação de plataforma) porque
  // nenhuma clínica pode ler o que aqui está sobre as outras.
  { label: 'Grupo', href: '/dashboard/super-admin/group', group: 'CLÍNICAS', requires: 'tenants:manage' },
  // Três entradas em uma: a comparação entre clínicas, o trabalho real e a retenção. As
  // duas últimas liam a MESMA linha de /platform/usage — ver pages/Analise.tsx.
  { label: 'Análise', href: '/dashboard/super-admin/reports', group: 'CLÍNICAS', requires: 'reports:read' },

  // Cinco entradas em uma. Agentes, Modelos, Execuções, Custos e Falhas eram dois
  // endpoints — ver pages/Agentes.tsx, que diz quais e porquê.
  { label: 'Agentes', href: '/dashboard/super-admin/ai/agents', group: 'AGENTES', requires: 'agents:read' },
  { label: 'Alertas', href: '/dashboard/super-admin/alerts', group: 'AGENTES', requires: 'agents:read' },

  { label: 'Utilizadores', href: '/dashboard/super-admin/users', group: 'SEGURANÇA', requires: 'users:manage' },
  // Quatro entradas em uma. 'Registo de Auditoria', 'Registos de Acesso', 'Eventos de
  // Sistema' e 'Eventos de Segurança' liam as quatro o mesmo audit_log com conjuntos de
  // ações diferentes — ver pages/Auditoria.tsx.
  { label: 'Auditoria', href: '/dashboard/super-admin/audit', group: 'SEGURANÇA', requires: 'audit:read' },

  { label: 'Configuração', href: '/dashboard/super-admin/settings/system', group: 'DEFINIÇÕES' },
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

/**
 * Data em português (dd/mm/aaaa). Aceita o que o `pg` devolve numa coluna DATE — um
 * `Date` à meia-noite local — e também a string ISO, e nunca devolve "Invalid Date"
 * nem "01/01/1970" para um valor ausente: sem data, devolve string vazia, que é o que
 * a interface deve mostrar. Ver lib/pgDate.ts para o porquê de não se usar aqui
 * `String(...).slice(0, 10)`.
 */
export function formatDatePT(date: string | Date | null | undefined): string {
  const iso = isoDate(date);
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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
