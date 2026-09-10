// Lógica pura do agente Lead — sem DB, sem chamada à IA, testável como
// lib/agents/reorderAgentCalc.ts. lib/agents/leadAgent.ts chama a IA e passa a
// resposta por aqui antes de escrever fosse o que fosse na base de dados.
//
// O canal do rascunho nunca é escolhido pela IA — é sempre calculado aqui a partir
// do que o lead realmente deixou (telefone e/ou email). Perguntar ao modelo por um
// canal abre uma classe de erro inteira (ele "escolher" email para um lead que só
// deixou telefone) que fica impossível só por a decisão nunca lhe ser pedida.

const QUALIFICATIONS = ['hot', 'warm', 'cold'] as const;
export type LeadQualification = (typeof QUALIFICATIONS)[number];

export interface LeadContact {
  hasPhone: boolean;
  hasEmail: boolean;
}

export interface AiLeadTriage {
  leadId: unknown;
  qualification: unknown;
  intent?: unknown;
  draftReply: unknown;
}

export interface ClampedLeadTriage {
  leadId: string;
  qualification: LeadQualification;
  intent: string;
  draftChannel: 'sms';
  draftReply: string;
}

export function clampLeadTriage(
  candidates: ReadonlyMap<string, LeadContact>,
  aiItems: readonly AiLeadTriage[] | null | undefined,
): ClampedLeadTriage[] {
  const seen = new Set<string>();
  const out: ClampedLeadTriage[] = [];

  for (const raw of aiItems || []) {
    const leadId = String(raw.leadId || '');
    if (!leadId || seen.has(leadId)) continue;
    const contact = candidates.get(leadId);
    if (!contact) continue; // fora do espaço de candidatos — ignorado, não é erro fatal

    const qualification = QUALIFICATIONS.includes(raw.qualification as LeadQualification)
      ? (raw.qualification as LeadQualification)
      : null;
    const draftReply = typeof raw.draftReply === 'string' ? raw.draftReply.trim().slice(0, 600) : '';
    if (!qualification || !draftReply) continue;

    // SMS ou nada. O ramo do e-mail existiu e nunca chegou a enviar coisa nenhuma —
    // app/api/leads/[id]/send-reply/route.ts devolvia 'email_not_supported' desde
    // sempre — e com o agente reduzido a chamada e SMS (migração 052) deixou de fazer
    // sentido escrever um rascunho que ninguém pode expedir. Um lead sem telefone fica
    // sem rascunho e vai para contacto manual, que é o que já acontecia na prática.
    if (!contact.hasPhone) continue;

    seen.add(leadId);
    out.push({
      leadId,
      qualification,
      intent: typeof raw.intent === 'string' ? raw.intent.trim().slice(0, 300) : '',
      draftChannel: 'sms',
      draftReply,
    });
  }

  return out;
}
