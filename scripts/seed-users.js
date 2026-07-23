// =============================================================================
// scripts/seed-users.js
// Production Account Provisioning Script — env-driven, zero credentials in git.
//
// SECURITY MODEL
//   sql/init.sql seeds the three initial accounts (SysAdmin / ronald /
//   angelica) in a LOCKED state: password_hash holds a placeholder that is not
//   a valid bcrypt hash, so login is impossible. This script activates them by
//   generating real bcrypt hashes AT RUNTIME from passwords supplied via .env
//   (which is gitignored). Nothing secret ever touches the repository.
//
// Required .env variables (no defaults — the script fails fast if missing):
//   SEED_SYSADMIN_PASSWORD   → account 'SysAdmin'  (id_rol 4)
//   SEED_JEFE_PASSWORD       → account 'ronald'    (id_rol 3)
//   SEED_ADMIN_PASSWORD      → account 'angelica'  (id_rol 2)
//
// Usage:
//   npm run seed              → preview: prints the plan, touches nothing
//   npm run seed:execute      → connects to DB and applies the upserts
//
// The --execute flag additionally requires valid DB_* credentials in .env.
// =============================================================================

'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;
const MIN_PASSWORD_LENGTH = 10;

// ---------------------------------------------------------------------------
// Account map — usernames/roles are code; passwords come exclusively from env.
// ---------------------------------------------------------------------------
const SEED_ACCOUNTS = [
  { nombre_completo: 'Master Admin', nombre_usuario: 'SysAdmin', id_rol: 4, envVar: 'SEED_SYSADMIN_PASSWORD' },
  { nombre_completo: 'Ronald',       nombre_usuario: 'ronald',   id_rol: 3, envVar: 'SEED_JEFE_PASSWORD' },
  { nombre_completo: 'Angélica',     nombre_usuario: 'angelica', id_rol: 2, envVar: 'SEED_ADMIN_PASSWORD' },
];

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const shouldExecute = process.argv.includes('--execute');

  console.log('='.repeat(60));
  console.log('RC Tractoparts — Account Provisioning (env-driven)');
  console.log('Mode:', shouldExecute ? '🔴 EXECUTE (writes to DB)' : '👁  PREVIEW (no writes)');
  console.log('='.repeat(60) + '\n');

  // ── Fail fast on missing/weak env passwords ────────────────────────────────
  const problems = [];
  for (const acc of SEED_ACCOUNTS) {
    const pw = process.env[acc.envVar];
    if (!pw) {
      problems.push(`${acc.envVar} is not set (account '${acc.nombre_usuario}').`);
    } else if (pw.length < MIN_PASSWORD_LENGTH) {
      problems.push(`${acc.envVar} is shorter than ${MIN_PASSWORD_LENGTH} characters (account '${acc.nombre_usuario}').`);
    }
  }
  if (problems.length > 0) {
    console.error('❌ Cannot provision accounts — fix your .env first:\n');
    problems.forEach((p) => console.error('   • ' + p));
    console.error('\nAdd the SEED_* variables to .env (see .env.example). They are never committed.');
    process.exit(1);
  }

  // ── Hash all passwords at runtime, self-verify each one immediately ────────
  // A hash copied incorrectly (truncated, modified, or generated from a
  // different password) silently breaks authentication — self-verification
  // catches that class of bug before anything reaches the database.
  const seeded = await Promise.all(
    SEED_ACCOUNTS.map(async (acc) => {
      const password = process.env[acc.envVar];
      const hash     = await bcrypt.hash(password, ROUNDS);
      const verified = await bcrypt.compare(password, hash);
      if (!verified) {
        throw new Error(`FATAL: self-verification failed for '${acc.nombre_usuario}'. Aborting.`);
      }
      return { ...acc, password_hash: hash };
    })
  );

  console.log('Accounts to provision (hashes generated & self-verified ✓):');
  console.log('-'.repeat(60));
  seeded.forEach((u) => {
    // Deliberately NEVER print the password — only the username/role/hash.
    console.log(`User: ${u.nombre_usuario}  |  Rol: ${u.id_rol}  |  from ${u.envVar}`);
    console.log(`Hash: ${u.password_hash}`);
    console.log('-'.repeat(60));
  });

  if (!shouldExecute) {
    console.log('\n💡 Preview only. Run `npm run seed:execute` to apply to the database.\n');
    return;
  }

  // ── Execute: upsert by nombre_usuario (unique key) ─────────────────────────
  // Replaces the '*LOCKED*…*' placeholder seeded by sql/init.sql with a real
  // hash, and also serves as the password-ROTATION tool: re-run any time with
  // new SEED_* values to change these accounts' passwords.
  const { pool } = require('../src/config/db');
  try {
    console.log('🔴 Applying to database...');
    for (const u of seeded) {
      const [result] = await pool.execute(
        `INSERT INTO usuarios
           (nombre_completo, nombre_usuario, password_hash, id_rol, activo, intentos_fallidos, bloqueado_hasta)
         VALUES (?, ?, ?, ?, 1, 0, NULL)
         ON DUPLICATE KEY UPDATE
           password_hash     = VALUES(password_hash),
           id_rol            = VALUES(id_rol),
           activo            = 1,
           intentos_fallidos = 0,
           bloqueado_hasta   = NULL`,
        [u.nombre_completo, u.nombre_usuario, u.password_hash, u.id_rol]
      );
      console.log(`  ✓ ${result.insertId > 0 ? 'INSERTED' : 'ACTIVATED/ROTATED'}: ${u.nombre_usuario}`);
    }
    console.log('\n✅ All accounts provisioned. Locked placeholders replaced with real hashes.\n');
  } catch (err) {
    console.error('❌ Database error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
