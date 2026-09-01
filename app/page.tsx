'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode, SVGProps } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ROLE_HOME } from '@/lib/constants';
import type { AuthUser } from './providers';
import { useAuth } from './providers';

/* Ligar quando o SSO empresarial estiver mesmo implementado. */
const SSO_ATIVO = false;
const CHAVE_EMAIL = 'portucale:ultimo-email';

type RespostaAuth = { user: AuthUser };

const serif: CSSProperties = {
  fontFamily: "'Newsreader', ui-serif, Georgia, 'Times New Roman', serif",
};

/* O servidor devolve mensagens técnicas; aqui traduzimos para o que a pessoa pode fazer. */
function mensagemDeErro(erro: unknown): string {
  const original = erro instanceof Error ? erro.message : '';
  const bruto = original.toLowerCase();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Sem ligação à internet. Verifique a rede e tente outra vez.';
  }
  if (bruto.includes('401') || bruto.includes('invalid') || bruto.includes('credential')) {
    return 'E-mail ou palavra-passe incorretos.';
  }
  if (bruto.includes('429') || bruto.includes('too many')) {
    return 'Demasiadas tentativas. Aguarde um minuto antes de tentar de novo.';
  }
  if (bruto.includes('failed to fetch') || bruto.includes('network')) {
    return 'Não foi possível contactar o servidor. Tente outra vez.';
  }
  return original || 'Não foi possível concluir o pedido. Tente outra vez.';
}

export default function LoginPage() {
  const { login, api } = useAuth();
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);

  const [montado, setMontado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [capsLock, setCapsLock] = useState(false);

  const [email, setEmail] = useState('');
  const [palavraPasse, setPalavraPasse] = useState('');
  const [visivel, setVisivel] = useState(false);
  const [guardarEmail, setGuardarEmail] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  /* Pré-preenche o e-mail de quem já entrou neste dispositivo. */
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(CHAVE_EMAIL);
      if (guardado) {
        setEmail(guardado);
        setGuardarEmail(true);
      }
    } catch {
      /* localStorage indisponível (modo privado, cookies bloqueados) */
    }
  }, []);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  function detetarCapsLock(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState('CapsLock'));
  }

  async function aoSubmeter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (ocupado) return;
    setErro('');

    setOcupado(true);
    try {
      const d = (await api('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password: palavraPasse },
      })) as RespostaAuth;

      try {
        if (guardarEmail) localStorage.setItem(CHAVE_EMAIL, email.trim());
        else localStorage.removeItem(CHAVE_EMAIL);
      } catch {
        /* ignorado de propósito: não impede a entrada */
      }

      login(d.user);

      const destinos = ROLE_HOME as Record<string, string>;
      const destino = (d.user.role && destinos[d.user.role]) || '/dashboard/admin';
      /* replace: evita voltar ao login com o botão "anterior" já autenticado. */
      router.replace(destino);
    } catch (e) {
      setErro(mensagemDeErro(e));
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F2F3F0] lg:flex-row">
      <ParedeAzulejo montado={montado} />

      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div
          className={[
            'w-full max-w-[26rem] transition-all duration-700 ease-out motion-reduce:transition-none',
            montado ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          ].join(' ')}
        >
          <header>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1D4E8F]">Área da equipa</p>
            <h1 style={serif} className="mt-3 text-[2rem] leading-[1.15] text-[#132133]">
              Bem-vindo de volta
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[#5B6B7C]">
              Entre para aceder à agenda e às fichas dos pacientes.
            </p>
          </header>

          <form onSubmit={aoSubmeter} aria-busy={ocupado} className="mt-8 space-y-5">
            <div aria-live="polite">
              {erro && (
                <p
                  role="alert"
                  className="flex items-start gap-2.5 rounded-md border border-[#E4C4C0] bg-[#FBF0EE] px-3.5 py-3 text-[14px] leading-snug text-[#8E2A22]"
                >
                  <IconeAviso />
                  <span>{erro}</span>
                </p>
              )}
            </div>

            <Campo id="email" etiqueta="E-mail" icone={<IconeEnvelope />}>
              <input
                ref={emailRef}
                id="email"
                className={INPUT}
                type="email"
                inputMode="email"
                placeholder="nome@clinica.pt"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Campo>

            <Campo id="palavra-passe" etiqueta="Palavra-passe" icone={<IconeCadeado />}>
              <input
                id="palavra-passe"
                className={`${INPUT} pr-12`}
                type={visivel ? 'text' : 'password'}
                placeholder="••••••••••"
                autoComplete="current-password"
                value={palavraPasse}
                onChange={(e) => setPalavraPasse(e.target.value)}
                onKeyUp={detetarCapsLock}
                onKeyDown={detetarCapsLock}
                onBlur={() => setCapsLock(false)}
                required
              />
              <button
                type="button"
                onClick={() => setVisivel((v) => !v)}
                aria-pressed={visivel}
                aria-label={visivel ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-2 text-[#8A96A2] transition-colors hover:text-[#1D4E8F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4E8F]"
              >
                {visivel ? <IconeOlhoFechado /> : <IconeOlho />}
              </button>
            </Campo>

            {capsLock && <p className="-mt-2 text-[13px] text-[#8E2A22]">Caps Lock está ligado.</p>}

            <div className="flex items-center justify-between gap-4 pt-1">
              <label className="group inline-flex cursor-pointer select-none items-center gap-2.5 text-[14px] text-[#3E4C5A]">
                <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center">
                  <input
                    type="checkbox"
                    checked={guardarEmail}
                    onChange={(e) => setGuardarEmail(e.target.checked)}
                    className="peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border border-[#C6CCC5] bg-white transition-colors checked:border-[#0B2545] checked:bg-[#0B2545] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4E8F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F2F3F0]"
                  />
                  <IconeVisto />
                </span>
                Guardar o meu e-mail
              </label>
              <a
                href="/recuperar-palavra-passe"
                className="rounded text-[14px] text-[#1D4E8F] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4E8F]"
              >
                Recuperar acesso
              </a>
            </div>

            <button type="submit" disabled={ocupado} className={`${BOTAO_PRIMARIO} !mt-7`}>
              {ocupado ? (
                <>
                  <Roda />A entrar…
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          {SSO_ATIVO && (
            <>
              <div className="my-7 flex items-center gap-4 text-[12px] uppercase tracking-[0.16em] text-[#9AA5AF]">
                <span className="h-px flex-1 bg-[#DDE1DB]" />
                ou
                <span className="h-px flex-1 bg-[#DDE1DB]" />
              </div>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#D8DCD6] bg-white px-4 py-3 text-[15px] font-medium text-[#132133] transition-colors hover:border-[#0B2545] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4E8F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F2F3F0]"
              >
                <IconeCadeado />
                Entrar com SSO empresarial
              </button>
            </>
          )}

          <p className="mt-10 text-[13px] leading-relaxed text-[#7A8794]">
            © 2026 Portucale Dental ·{' '}
            <a href="/privacidade" className="underline-offset-4 hover:underline">
              Privacidade
            </a>{' '}
            ·{' '}
            <a href="/termos" className="underline-offset-4 hover:underline">
              Termos
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

/* ── Painel de azulejo ────────────────────────────────────────────────── */

function ParedeAzulejo({ montado }: { montado: boolean }) {
  return (
    <aside className="relative flex shrink-0 flex-col justify-between overflow-hidden bg-[#0B2545] px-8 py-8 text-white lg:w-[46%] lg:max-w-[38rem] lg:px-14 lg:py-14">
      <svg
        aria-hidden="true"
        className={[
          'pointer-events-none absolute inset-0 h-full w-full text-[#7FA9D9] transition-opacity duration-1000 ease-out motion-reduce:transition-none',
          montado ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      >
        <defs>
          <pattern id="azulejo-portucale" width="96" height="96" patternUnits="userSpaceOnUse">
            {/* junta entre azulejos */}
            <path d="M0 .5H96M.5 0V96" stroke="currentColor" strokeWidth="1" opacity=".22" />
            {/* moldura em losango */}
            <path d="M48 10 88 48 48 86 8 48Z" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".38" />
            {/* pétalas de canto */}
            <g fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".3">
              <path d="M0 18A18 18 0 0 0 18 0" />
              <path d="M96 18A18 18 0 0 1 78 0" />
              <path d="M0 78A18 18 0 0 1 18 96" />
              <path d="M96 78A18 18 0 0 0 78 96" />
            </g>
            {/* molar pintado ao centro */}
            <path
              d="M48 27c-10.5 0-17 5.6-17 13.2 0 5.4 2.8 8.4 2.8 13.2 0 6.6-1 12.6 1.9 12.6 2.8 0 3.8-8.6 5.6-12.4 1.6-3.4 3.6-3.4 6.7-3.4s5.1 0 6.7 3.4c1.8 3.8 2.8 12.4 5.6 12.4 2.9 0 1.9-6 1.9-12.6 0-4.8 2.8-7.8 2.8-13.2C65 32.6 58.5 27 48 27Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              opacity=".55"
            />
            <circle cx="48" cy="48" r="2" fill="currentColor" opacity=".28" />
          </pattern>
          <radialGradient id="brilho-esmalte" cx="28%" cy="18%" r="85%">
            <stop offset="0%" stopColor="#1D4E8F" stopOpacity=".55" />
            <stop offset="100%" stopColor="#0B2545" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#azulejo-portucale)" />
        <rect width="100%" height="100%" fill="url(#brilho-esmalte)" />
      </svg>

      <div className="relative flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/95">
          <Image
            src="/logo.svg"
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
            className="h-[22px] w-[22px]"
            draggable={false}
            unoptimized
          />
        </span>
        <span style={serif} className="text-[1.35rem] tracking-tight">
          Portucale <span className="text-[#9CC1E8]">Dental</span>
        </span>
      </div>

      <div className="relative mt-10 hidden lg:block">
        <p style={serif} className="max-w-[19ch] text-[2.5rem] leading-[1.1] text-white">
          A clínica inteira, num único ecrã.
        </p>
      </div>
    </aside>
  );
}

/* ── Peças reutilizáveis ──────────────────────────────────────────────── */

const INPUT =
  'w-full rounded-lg border border-[#D8DCD6] bg-white py-3 pl-11 pr-4 text-[15px] text-[#132133] placeholder:text-[#A6B0BA] transition-colors focus:border-[#1D4E8F] focus:outline-none focus:ring-4 focus:ring-[#1D4E8F]/10 disabled:opacity-60';

const BOTAO_PRIMARIO =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B2545] px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-[#16386B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4E8F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F2F3F0] disabled:cursor-not-allowed disabled:opacity-70';

function Campo({
  id,
  etiqueta,
  icone,
  children,
}: {
  id: string;
  etiqueta: string;
  icone: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-[#3E4C5A]">
        {etiqueta}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A96A2]">{icone}</span>
        {children}
      </div>
    </div>
  );
}

function Roda() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity=".3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const traco: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-[18px] w-[18px]',
  'aria-hidden': 'true',
};

const IconeEnvelope = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden="true" comes from the spread `traco` prop bag
  <svg {...traco}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 7 10-7" />
  </svg>
);

const IconeCadeado = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden="true" comes from the spread `traco` prop bag
  <svg {...traco}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const IconeOlho = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden="true" comes from the spread `traco` prop bag
  <svg {...traco}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconeOlhoFechado = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden="true" comes from the spread `traco` prop bag
  <svg {...traco}>
    <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M1 1l22 22" />
  </svg>
);

const IconeAviso = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden="true" comes from the spread `traco` prop bag
  <svg {...traco} className="mt-px h-[18px] w-[18px] shrink-0">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

const IconeVisto = () => (
  <svg
    viewBox="0 0 12 12"
    aria-hidden="true"
    className="pointer-events-none absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="2,6 5,9 10,3" />
  </svg>
);
