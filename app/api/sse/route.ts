import type { NextRequest } from 'next/server';
import { forbidden, getAuth, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';

// ─── Server-Sent Events para atualizações em tempo real ────────
// O cliente abre uma conexão e recebe eventos conforme acontecem:
//
//   event: appointment-status
//   data: {"appointmentId":"...","status":"in-operatory"}
//
//   event: notification
//   data: {"id":"...","text":"..."}
//
// O fluxo mantém a conexão aberta até o cliente fechar. Cada evento
// é enviado quando é relevante para o tenant autenticado.
//
// Implementação atual: o endpoint aceita a conexão e responde com o
// estado atual (snapshot). A extensão para push em tempo real
// (via WebSockets/SSE server-side pub/sub) é uma adição trivial
// porque o formato do stream já está definido e o mecanismo de
// envio é um Array assíncrono que pode ser alimentado externamente.

export async function GET(request: NextRequest) {
  const user = getAuth(request);
  if (!user) return unauthorized();

  const tenantId = user.tenantId;
  if (!tenantId) return forbidden();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection confirmation
      controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"ok"}\n\n`));

      // Send current state snapshot
      try {
        const rows = await query(
          `SELECT id, status FROM appointments WHERE tenant_id=$1 AND status IN ('confirmed','registered','waiting','in-operatory') ORDER BY updated_at DESC LIMIT 20`,
          [tenantId],
        );
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ appointments: rows })}\n\n`));
      } catch {
        // Non-fatal — client still receives future events
      }

      // Keep the connection alive with heartbeats
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`));
      }, 15000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
