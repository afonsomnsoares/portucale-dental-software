'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/app/providers';
import { NAV, ROLE_HOME, ROLE_META } from '@/lib/constants';
import { AppLogo, Avatar } from './ui';

function ToothIcon({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.4 3.2c-1.8.7-3 2.8-3 5.2 0 1.8.4 3.5.8 5 .6 2.2 1.2 4.2 1.4 6.2.1 1.6 1.1 2.4 2 2.4 1.1 0 1.7-1.1 2-2.4l.6-2.8c.2-.9.6-1.3 1.2-1.3s1 .4 1.2 1.3l.6 2.8c.3 1.3.9 2.4 2 2.4.9 0 1.9-.8 2-2.4.2-2 .8-4 1.4-6.2.4-1.5.8-3.2.8-5 0-2.4-1.2-4.5-3-5.2-1.7-.7-3.2-.3-4.1.2-.6.3-1.2.3-1.8 0-.9-.5-2.4-.9-4.1-.2Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Icon({ name, active }: { name: string; active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--text-muted)';
  const s = 18;
  const common = { size: s, color: c };
  if (name === 'Visão Geral' || name === 'Painel') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 4h7v7H4V4Zm9 0h7v4h-7V4ZM4 13h7v7H4v-7Zm9 7v-10h7v10h-7Z" fill={c} />
      </svg>
    );
  }
  if (name === 'Clínicas') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 21V9l8-5 8 5v12" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 21v-6h6v6" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Utilizadores') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M16 11a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z" stroke={c} strokeWidth="1.8" />
        <path d="M4 20c1.6-3 4.3-4.5 8-4.5S18.4 17 20 20" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Faturas') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M14 4h4l2 2v14H4V4h10Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 2v4h4" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 12h8M8 16h6" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Finanças') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z" stroke={c} strokeWidth="1.8" />
        <path d="M12 8v8M8 12h8" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Inventário') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7l8-3 8 3v13H4V7Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M4 7l8 3 8-3" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Doentes') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke={c} strokeWidth="1.8" />
        <path d="M5 20c1.6-3 4.1-4.5 7-4.5S17.4 17 19 20" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Tratamentos') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4h10v16H7V4Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 8h6M9 12h6M9 16h4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Sala de Espera') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 11h10v4a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4v-4Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 11V8a3 3 0 0 1 6 0v3" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Histórico Clínico') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 12h6M9 16h4M9 8h2" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 4h10v16H7V4Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Prescrições') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 8h16M6 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 8V4h6v4" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 12v6M9 15h6" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Encomendas Lab') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 3h10v4H7V3Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M7 7l-2 14h14L17 7" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 12h4M12 10v4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Planos Tratamento') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6h16v14H4V6Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 6V4h8v2" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 12l2 2 5-5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Recalls') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="13" r="4" stroke={c} strokeWidth="1.8" />
        <path d="M12 11v2l1 1" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 3l4 4M19 3l-4 4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 13a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z" stroke={c} strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === 'Consentimentos') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M14 4h4l2 2v14H4V6l2-2h4" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 2h4v4h-4V2Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 13l2 2 5-5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Imagiologia') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 7h4l1-2h4l1 2h3v12H7V7Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 13a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" stroke={c} strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === 'Progress Notes') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4h7l3 3v13H7V4Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 4v4h4" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 12h6M9 16h4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Marcações') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4v3M17 4v3M5 9h14M6 7h12v14H6V7Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Campos Schema') return <ToothIcon {...common} />;
  if (name === 'Permissões') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3l8 4v6c0 5-3.4 8.5-8 9-4.6-.5-8-4-8-9V7l8-4Z"
          stroke={c}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9.5 12l1.7 1.7L14.8 10" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'Relatórios') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 20V4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 17v-5M12 17V7M17 17v-8" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Agenda Inteligente') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4v3M17 4v3M5 9h14M6 7h12v14H6V7Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 12v3l2 1.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="14.5" r="4" stroke={c} strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === 'Jornada do Paciente') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 4a8 8 0 1 1-6.93 4" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 4v4h4" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2" fill={c} />
      </svg>
    );
  }
  if (name === 'Auditoria') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4h10v16H7V4Z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 8h6M9 12h6M9 16h4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Tarefas') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 11l2 2 4-4" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 6h16M4 12h3M4 18h3M14 18h6" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Fontes de Leads') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="8" cy="15" r="3.5" stroke={c} strokeWidth="1.8" />
        <path
          d="M10.5 12.5 18 5M18 5h-4M18 5v4"
          stroke={c}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'Equipa') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="9" cy="8" r="3" stroke={c} strokeWidth="1.8" />
        <path d="M3 20c1.3-3 3.6-4.5 6-4.5s4.7 1.5 6 4.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="17" cy="7" r="2.4" stroke={c} strokeWidth="1.8" />
        <path d="M15.5 12.2c2 .2 3.6 1.6 4.5 3.8" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Agentes') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="8" width="16" height="11" rx="3" stroke={c} strokeWidth="1.8" />
        <path d="M12 4v4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="3.5" r="1.4" stroke={c} strokeWidth="1.6" />
        <path d="M9 12.5v1.5M15 12.5v1.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'Operações') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.8" />
        <path d="M5.5 7.5 6.8 8.8 9 6.2" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.8" />
        <path d="M5.5 16.5 6.8 17.8 9 15.2" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 6h5M15 10h5M15 15h5M15 19h5" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6v12M6 12h12" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const ROLE_ICONS = {
  super_admin: { icon: <ToothIcon size={18} color="var(--cat-purple)" />, color: 'var(--cat-purple)' },
  admin: { icon: <ToothIcon size={18} color="var(--cat-purple)" />, color: 'var(--cat-purple)' },
  receptionist: {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 21V7l8-4 8 4v14" stroke="var(--urgency-ok)" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9 21v-7h6v7" stroke="var(--urgency-ok)" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
    color: 'var(--urgency-ok)',
  },
  dentist: { icon: <ToothIcon size={18} color="var(--accent)" />, color: 'var(--accent)' },
};

// `open` e `onNavigate` só contam abaixo de 900 px, onde a barra é uma gaveta
// (ver .app-sidebar em app/globals.css). Acima disso a barra está sempre no
// fluxo e os dois são inertes — daí serem opcionais: quem a usa em largura
// total não precisa de saber que existem.
export default function Sidebar({ open = false, onNavigate }: { open?: boolean; onNavigate?: () => void } = {}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const role = user?.role as keyof typeof NAV | undefined;
  // O menu segue as PERMISSÕES, não só o papel. Antes era `NAV[role]` e mais nada: a UI de
  // permissões por clínica (role_permissions) não tinha qualquer efeito aqui, pelo que
  // retirar 'finance:read' à receção deixava 'Finanças' à vista, a levar a um 403.
  //
  // `permissions` chega de /api/auth/me. Enquanto não chegar (primeiro render, ou uma
  // sessão antiga anterior a este campo) mostra-se o menu do papel, como antes — esconder
  // tudo faria a sidebar piscar a cada carregamento.
  const permissions = user?.permissions;
  // Dentro de uma clínica, o super_admin está nas páginas do admin — o menu tem de ser o
  // do admin, senão via a navegação de plataforma por cima de páginas de clínica.
  const navRole = role === 'super_admin' && user?.actingTenantId ? 'admin' : role;
  const nav = ((navRole && NAV[navRole]) || []).filter(
    (item) => !item.requires || !permissions || permissions.includes(item.requires),
  );
  const grouped = nav.some((item) => item.group);
  const meta: { label?: string; sub?: string } = (role && ROLE_META[role]) || {};
  // Segue navRole: dentro de uma clínica a raiz é a Visão Geral do admin, para o logótipo
  // e para o realce da entrada de raiz não apontarem para fora da clínica.
  const roleHome = (navRole && (ROLE_HOME as Record<string, string>)[navRole]) || '';
  const roleIcon: { icon?: ReactNode; color?: string } = (role && ROLE_ICONS[role]) || {};
  const tenantLabel = user?.tenantName ? `${user.tenantName}${user.tenantCity ? ` · ${user.tenantCity}` : ''}` : '';
  const sidebarClinic = tenantLabel || user?.clinic || '';

  return (
    <aside
      className="app-sidebar"
      data-open={open ? 'true' : 'false'}
      style={{
        width: 240,
        background: 'white',
        borderRight: '1px solid var(--bg-sunken)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100vh',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      {/* ── Brand ── */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--bg-sunken)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{ width: 32, height: 32, borderRadius: 'var(--radius-control)', overflow: 'hidden', flexShrink: 0 }}
          >
            <AppLogo size={32} />
          </div>
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: 'var(--accent)',
                letterSpacing: '-0.5px',
                fontFamily: '"Plus Jakarta Sans",sans-serif',
              }}
            >
              Portucale Software
            </div>
          </div>
        </div>
      </div>

      {/* ── Role badge ── */}
      <div className="px-4 pt-4 pb-2">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            background: 'var(--bg-page)',
            borderRadius: 'var(--radius-control)',
          }}
        >
          <span
            style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {roleIcon.icon}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {meta.label}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {tenantLabel || meta.sub}
            </div>
          </div>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2 pt-1">
        {/* Sem grupos (clínica) mantém-se o cabeçalho único de sempre; com grupos
            (plataforma) cada grupo traz o seu, e este seria só ruído por cima deles. */}
        {!grouped && <div className="section-label px-2 mb-2 mt-2">NAVEGAÇÃO</div>}
        {nav.map((item, i) => {
          // A entrada de raiz de cada role (a "Visão Geral"/"Painel", cujo href é o
          // ROLE_HOME) é prefixo de todas as outras dessa árvore, por isso só acende em
          // correspondência exata; as restantes acendem também nas suas subpáginas
          // (ex.: /dashboard/admin/invoices/<id> mantém "Faturas" ativa). O barra final
          // no startsWith evita que /dashboard/admin/team apanhe /dashboard/admin/teams.
          const isRoleHome = item.href === roleHome;
          const active = pathname === item.href || (!isRoleHome && pathname.startsWith(`${item.href}/`));
          // Cabeçalho sempre que o grupo muda — a lista já vem ordenada por grupo.
          const header = item.group && item.group !== nav[i - 1]?.group ? item.group : null;
          return (
            // 'Permissões' aparece em dois grupos com o MESMO href (pedido assim), por
            // isso a chave é grupo+href: só o href colidia e o React descartava uma delas.
            <div key={`${item.group || ''}:${item.href}`}>
              {header && <div className="section-label px-2 mb-1.5 mt-4">{header}</div>}
              <Link
                onClick={onNavigate}
                href={item.href}
                className={`nav-item mb-0.5 ${active ? 'nav-item-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {/* Com cabeçalho de grupo, o ícone por entrada deixa de informar: são 41
                    entradas e nenhuma tem ícone próprio no Icon() acima, pelo que todas
                    cairiam no mesmo "+" genérico. O grupo carrega o significado. */}
                {!item.group && (
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={item.label} active={active} />
                  </span>
                )}
                <span>{item.label}</span>
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* ── Divider ── */}
      <div style={{ borderTop: '1px solid var(--bg-sunken)' }} />

      {/* ── User ── */}
      <div className="p-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Avatar name={user?.name || ''} size={34} color="var(--accent)" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {user?.name}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {sidebarClinic}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            logout();
            router.push('/');
          }}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1.5px solid var(--border-subtle)',
            borderRadius: 'var(--radius-control)',
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--urgency-critical)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            const t = e.target as HTMLElement;
            t.style.background = 'var(--urgency-critical-bg)';
            t.style.borderColor = 'var(--urgency-critical-border)';
          }}
          onMouseLeave={(e) => {
            const t = e.target as HTMLElement;
            t.style.background = 'transparent';
            t.style.borderColor = 'var(--border-subtle)';
          }}
        >
          Terminar sessão
        </button>
      </div>
    </aside>
  );
}
