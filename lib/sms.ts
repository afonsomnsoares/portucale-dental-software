// Extraído de lib/jobsRunner.ts para ser reutilizável fora da pipeline de jobs — hoje
// também por app/api/leads/[id]/send-reply/route.ts, que envia o rascunho do agente Lead
// só depois de uma pessoa aprovar (nunca a pipeline de jobs sozinha, ver esse ficheiro).

// Sends a plain-text SMS via the Twilio REST API. Não há templates a aprovar — quem
// chama passa o corpo final da mensagem.
//
// É a ÚNICA via de saída automática do produto: o agente fala por SMS e por mais nada.
// A chamada é um canal de entrada (transcrição) e devolve-se com o telefone na mão —
// ver allowsAutoReply em lib/conversationCalc.ts.
export async function sendSms({ to, body }: { to: string; body: string }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      error: 'SMS provider not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).',
    };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: data?.message || `SMS error (${res.status})` };
  }
  const msgId = data?.sid || null;
  return { ok: true, id: msgId };
}
