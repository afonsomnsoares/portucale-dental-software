export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
}

export function ok(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { status: 200, ...init });
}

export function created(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { status: 201, ...init });
}

export function apiError({
  status = 400,
  code = 'BAD_REQUEST',
  message = 'Request failed',
  details,
}: {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
} = {}) {
  const body: Record<string, unknown> = { code, message };
  if (details !== undefined) body.details = details;
  return Response.json(body, { status });
}

export function notFound(message = 'Not found', details?: unknown) {
  return apiError({ status: 404, code: 'NOT_FOUND', message, details });
}

export function badRequest(message = 'Bad request', details?: unknown) {
  return apiError({ status: 400, code: 'BAD_REQUEST', message, details });
}

export function conflict(message = 'Conflict', details?: unknown) {
  return apiError({ status: 409, code: 'CONFLICT', message, details });
}
