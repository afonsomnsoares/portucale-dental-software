const isDev = process.env.NODE_ENV !== 'production';

// Direct-to-R2 uploads (app/api/uploads/presign/route.ts) PUT from the browser straight
// to the bucket, and stored files are rendered back from R2_PUBLIC_BASE_URL — both are
// cross-origin, so the CSP has to name them. Derived from the same env vars lib/r2.ts
// reads (see getR2Config) rather than hardcoded, so a deployment that doesn't use R2
// simply gets a tighter policy instead of a stale allowance.
//
// IMPORTANT: headers() below runs at BUILD time and its result is baked into .next —
// setting these vars only in the run environment is too late and they will be missing
// from the shipped policy (verified empirically, not assumed). That is why the
// Dockerfile takes them as ARGs before `npm run build`; if you build some other way,
// they have to be present in that build's environment too.
function r2Origins() {
  const origins = new Set();
  for (const value of [process.env.R2_ENDPOINT, process.env.R2_PUBLIC_BASE_URL]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // A malformed URL here would otherwise inject a bare string into the CSP and
      // silently corrupt the whole directive — dropping it is the safe reading.
    }
  }
  return Array.from(origins);
}

// ─── Content-Security-Policy ────────────────────────────────────────────────
// Defence in depth: the project has no XSS vector today (no dangerouslySetInnerHTML,
// no innerHTML, no eval — verified by grep), so this is not fixing a live hole. It is
// what limits the blast radius of the one somebody writes next year, and what stops an
// injected tag from reaching an attacker's origin at all.
//
// `script-src` still carries 'unsafe-inline' and that is a deliberate, documented
// compromise rather than an oversight. Next.js's App Router streams the RSC payload
// through inline <script> tags; removing 'unsafe-inline' requires a per-request nonce
// threaded from proxy.ts through every rendered document, and getting that subtly
// wrong takes the whole app down rather than degrading. The directives that need no
// such machinery are locked down properly instead, and each earns its place:
//
//   default-src 'self'   — nothing loads from anywhere unnamed below.
//   object-src 'none'    — no <object>/<embed>; a classic script-execution bypass.
//   base-uri 'self'      — blocks <base href="//evil"> re-pointing every relative URL,
//                          which 'unsafe-inline' scripts would otherwise happily follow.
//   form-action 'self'   — an injected <form> cannot POST patient data off-site.
//   frame-ancestors      — the CSP-level equivalent of the X-Frame-Options header below
//                          (kept for older browsers); this is the one modern ones honour.
//   connect-src          — fetch/XHR/WebSocket only to our own API and the R2 bucket, so
//                          exfiltration has nowhere to go even if script does run.
//
// `style-src` needs 'unsafe-inline' for real: the dashboards use React `style={{...}}`
// attributes throughout, and inline style attributes cannot execute script.
function contentSecurityPolicy() {
  const r2 = r2Origins();
  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only — it is what Next.js's HMR runtime needs, and shipping
    // it to production would hand an injected string an execution primitive.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // next/font/google self-hosts at build time (served from /_next/static), so no
    // external font origin is needed.
    "font-src 'self' data:",
    // data:/blob: cover next/image optimisation output and client-side previews of a
    // file the user just picked, before it has been uploaded anywhere.
    `img-src 'self' data: blob:${r2.length ? ` ${r2.join(' ')}` : ''}`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}${r2.length ? ` ${r2.join(' ')}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  // Pointless over plain http (dev) and would spam the console; in production every
  // subresource should already be https given the HSTS header below.
  if (!isDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};
export default nextConfig;
