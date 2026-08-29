function isHex(ch: string) {
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function firstBadPercent(s: string) {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '%') continue;
    const a = s[i + 1];
    const b = s[i + 2];
    if (!a || !b || !isHex(a) || !isHex(b)) return i;
  }
  return -1;
}

function countChar(s: string, ch: string) {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) if (s[i] === ch) n += 1;
  return n;
}

function hasWhitespaceOrControl(s: string) {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.log('DATABASE_URL not set');
  process.exitCode = 1;
} else {
  const badPctAt = firstBadPercent(raw);
  console.log('DATABASE_URL diagnostics:', {
    length: raw.length,
    hasWhitespaceOrControl: hasWhitespaceOrControl(raw),
    atCount: countChar(raw, '@'),
    hashCount: countChar(raw, '#'),
    badPercentAt: badPctAt,
  });

  try {
    const url = new URL(raw);
    console.log('URL parsed OK:', {
      protocol: url.protocol,
      host: url.host,
      pathname: url.pathname,
      username: url.username,
      passwordLength: url.password.length,
    });
  } catch (e: unknown) {
    const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as Record<string, unknown>).code) : '';
    const message = e instanceof Error ? e.message : String(e);
    console.log('URL parse FAILED:', { code, message });
    process.exitCode = 1;
  }
}
