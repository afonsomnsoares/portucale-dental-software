'use client';
import { PageHeader } from '@/components/ui';

// A página que existe, tem lugar no menu, e diz a verdade.
//
// A alternativa era escondê-la do menu até haver dados, ou — pior — desenhá-la com
// números de exemplo. A segunda é a que faz estragos: um painel de plataforma é lido
// para decidir, e um número inventado num ecrã de decisão é indistinguível de um
// número real até alguém agir sobre ele. Por isso nada aqui simula nada.
//
// `needs` é a parte útil: nomeia o que teria de passar a existir para a página deixar
// de ser isto. É a lista de trabalho, escrita onde ela se nota.
export default function NotInstrumented({
  title,
  sub,
  purpose,
  needs,
  note,
}: {
  title: string;
  sub?: string;
  /** O que esta página mostraria — em uma frase, o que a torna útil. */
  purpose: string;
  /** O que falta construir para a encher. Uma entrada por peça. */
  needs: string[];
  /** Contexto adicional: uma decisão de produto, um sítio onde a coisa já meio existe. */
  note?: string;
}) {
  return (
    <div>
      <PageHeader title={title} sub={sub} />
      <div className="card p-6" style={{ maxWidth: 720 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--urgency-soon-bg)',
            color: 'var(--urgency-soon)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            marginBottom: 16,
          }}
        >
          <span
            style={{ width: 6, height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--urgency-soon)' }}
          />
          SEM INSTRUMENTAÇÃO
        </div>

        <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, margin: '0 0 20px' }}>{purpose}</p>

        <div className="section-label mb-2">O QUE FALTA PARA ESTA PÁGINA TER DADOS</div>
        <ul style={{ margin: '0 0 4px', paddingLeft: 18 }}>
          {needs.map((n) => (
            <li key={n} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {n}
            </li>
          ))}
        </ul>

        {note && (
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
              margin: '18px 0 0',
              paddingTop: 14,
              borderTop: '1px solid var(--bg-sunken)',
            }}
          >
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
