import crypto from 'node:crypto';
import { appendAudit } from '@/lib/audit';
import { isConversationChannel } from '@/lib/conversationCalc';
import { query, queryOne } from '@/lib/db';
import { badRequest, conflict, created } from '@/lib/http';
import { hashChannelSecret } from '@/lib/inbound';
import { withRoute } from '@/lib/route';
import { sanitizeString, toE164 } from '@/lib/validate';

// ─── A configuração que faltava ─────────────────────────────────────────────
// `channel_accounts` é a tabela que decide de que clínica é uma mensagem que entra, e
// o `secret_hash` dela é a única coisa que separa um webhook legítimo de alguém a
// inventar mensagens de doentes. Existia desde a migração 049 e NADA na aplicação
// escrevia lá: nem rota, nem seed, nem script. `hashChannelSecret` não tinha um único
// chamador fora do ficheiro onde está definida.
//
// O efeito era silencioso e total: POST /api/webhooks/[channel] resolvia sempre para
// "Unknown channel address" e respondia 403. O canal de entrada — SMS e voz, a caixa
// de entrada inteira — não podia funcionar sem alguém escrever SQL à mão em produção,
// que é precisamente o género de passo que ninguém documenta e toda a gente faz
// diferente. Fechado, portanto seguro; e completamente inoperante.
//
// ─── O segredo mostra-se UMA vez ────────────────────────────────────────────
// Guarda-se o hash, como nos tokens do portal do doente (migração 022) e pela mesma
// razão: um segredo legível na base de dados é um segredo que qualquer pessoa com
// leitura pode usar para injetar mensagens falsas. Quem perder o valor roda-o; não há
// como o recuperar, e é isso que se quer.

// Quem pode configurar isto é quem pode decidir o nível de autonomia — a mesma
// permissão, porque são a mesma matéria: quem fala com os doentes e por que caminho.
const PERMISSION = 'conversations:configure';

const AUTH_SCHEMES = ['shared_secret', 'twilio'] as const;
type AuthScheme = (typeof AUTH_SCHEMES)[number];

function isAuthScheme(v: unknown): v is AuthScheme {
  return AUTH_SCHEMES.includes(String(v) as AuthScheme);
}

// O segredo partilhado. 32 bytes em base64url — o mesmo tamanho e a mesma fonte do
// token de CSRF e dos tokens do portal do doente.
function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

export const GET = withRoute({ permission: 'conversations:read' }, async ({ tenantId }) => {
  // `secret_hash` NUNCA sai daqui, nem sequer o hash: não serve para nada a quem
  // configura e é material de autenticação. O que a interface precisa de saber é se
  // existe um, e isso é um booleano.
  const rows = await query(
    `SELECT id, channel, address, display_name, active, auth_scheme,
            secret_hash IS NOT NULL AS has_secret, created_at, updated_at
       FROM channel_accounts
      WHERE tenant_id=$1
      ORDER BY channel, address`,
    [tenantId],
  );
  return Response.json({ channels: rows });
});

export const POST = withRoute({ permission: PERMISSION }, async ({ request, user, tenantId }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('Corpo inválido');

  const channel = sanitizeString(body.channel, 20).toLowerCase();
  if (!isConversationChannel(channel)) {
    return badRequest('Canal desconhecido. Os canais são "sms" e "voice".');
  }

  // Normalizado com o MESMO toE164 que lib/inbound.ts usa para encontrar o doente pelo
  // número. Se as duas pontas normalizassem de maneiras diferentes, a conta ficava
  // gravada com uma escrita do número e o webhook chegava com outra — e a resolução
  // falhava com um 403 que ninguém saberia explicar.
  const address = toE164(body.address);
  if (!address || address.length < 8) return badRequest('Número inválido. Use o formato internacional (+351...).');

  const scheme: AuthScheme = isAuthScheme(body.authScheme) ? body.authScheme : 'shared_secret';
  const displayName = sanitizeString(body.displayName, 120);

  // O índice único é (channel, lower(address)) WHERE active — ou seja, a colisão é
  // GLOBAL e não por clínica, porque um número de telefone é global. Apanhada aqui para
  // dar uma mensagem que se entende, em vez do 23505 cru.
  const clash = await queryOne(
    `SELECT tenant_id FROM channel_accounts WHERE channel=$1 AND lower(address)=lower($2) AND active=TRUE`,
    [channel, address],
  );
  if (clash) {
    // Não diz de QUE clínica é: seria um oráculo para descobrir que números pertencem a
    // que clínicas, exatamente o que o webhook evita ao não distinguir os seus 403.
    return conflict('Esse número já está associado a um canal ativo.');
  }

  // Só o esquema 'shared_secret' tem segredo próprio. O 'twilio' valida contra o
  // TWILIO_AUTH_TOKEN do ambiente (ver lib/twilioSignature.ts), por isso uma coluna
  // com segredo aqui seria um segredo a mais para guardar e rodar.
  const secret = scheme === 'shared_secret' ? generateSecret() : null;

  const [row] = await query(
    `INSERT INTO channel_accounts (tenant_id, channel, address, display_name, secret_hash, auth_scheme, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, channel, address, display_name, active, auth_scheme, created_at`,
    [tenantId, channel, address, displayName, secret ? hashChannelSecret(secret) : null, scheme, user.id],
  );

  await appendAudit(user, 'CREATE', `Canal de entrada ${channel} ${address}`, null, 'created', user.clinic);

  return created({
    channel: row,
    // A única vez que este valor existe fora de um hash. Quem o perder roda-o.
    secret,
    aviso:
      scheme === 'shared_secret'
        ? 'Guarde este segredo agora — não volta a ser mostrado. Envie-o no cabeçalho X-Portucale-Signature.'
        : 'Este canal valida a assinatura da Twilio com o TWILIO_AUTH_TOKEN do servidor. Não há segredo a guardar.',
  });
});
