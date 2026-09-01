// scripts/create-admin.ts
// Run: ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin
//
// Creates the platform's one and only super_admin account. This replaces the
// old self-service "Primeira utilização" screen that used to appear on the
// login page whenever the `users` table was empty (POST /api/auth/bootstrap)
// — that endpoint let anyone who reached the app before an operator did
// create the super_admin straight from the browser, with no one in the loop.
// Account creation for the first admin is now an operator-only action, done
// once, from this script — never through the app itself. Every other user
// (admin/receptionist/dentist, always tenant-scoped) is created afterwards by
// that super_admin through the dashboard (see app/api/users/route.ts).
//
// Credentials come from environment variables rather than CLI flags so the
// password never lands in shell history.
// @ts-nocheck

import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10; // matches app/api/users/route.ts's own floor

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/portucale_dental',
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = (process.env.ADMIN_NAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!email || !name || !password) {
    fail('Uso: ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin');
  }
  if (!EMAIL_RE.test(email)) fail('ADMIN_EMAIL não é um e-mail válido.');
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`ADMIN_PASSWORD precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const client = await pool.connect();
  try {
    // The platform has exactly one super_admin (see
    // scripts/migrations/017_super_admin_role.sql) — refuse rather than
    // silently create a second one.
    const { rows } = await client.query(`SELECT email FROM users WHERE role = 'super_admin' LIMIT 1`);
    if (rows.length) fail(`Já existe um super admin: ${rows[0].email}. Só pode haver um.`);

    const { rows: clash } = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (clash.length) fail(`Já existe uma conta com este e-mail: ${email}.`);

    const hashed = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO users (email, password, name, role, clinic, tenant_id)
       VALUES ($1, $2, $3, 'super_admin', 'System', NULL)`,
      [email, hashed, name],
    );
    console.log(`✓ Super admin criado: ${email}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
