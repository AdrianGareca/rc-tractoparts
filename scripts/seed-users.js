// =============================================================================
// scripts/seed-users.js
// Development / Test User Seeding Script
//
// Generates cryptographically correct bcrypt hashes at runtime — never
// copy-paste hashes from external sources. A hash generated on a different
// machine from the same password is valid; a hash copied incorrectly
// (truncated, modified, or generated from a different password) silently
// breaks authentication with no error message — exactly the bug we just fixed.
//
// Usage:
//   node scripts/seed-users.js            → preview: prints SQL, touches nothing
//   node scripts/seed-users.js --execute  → connects to DB and runs the upserts
//
// The --execute flag requires a valid .env in the project root.
// =============================================================================

'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const ROUNDS = 10;

// ---------------------------------------------------------------------------
// Seed definitions — ONE source of truth for all development user accounts.
// ---------------------------------------------------------------------------
const SEED_USERS = [
  {
    nombre_completo: 'Administrador del Sistema',
    nombre_usuario:  'sysadmin',
    password:        'sysadmin123',
    id_rol:          4,
    activo:          1,
  },
  {
    nombre_completo: 'Jefe del Sistema',
    nombre_usuario:  'jefe',
    password:        'jefe123',
    id_rol:          3,
    activo:          1,
  },
  {
    nombre_completo: 'Adrian Administrador',
    nombre_usuario:  'adrian_admin',
    password:        'admin123',
    id_rol:          3,
    activo:          1,
  },
  {
    nombre_completo: 'Carlos Administracion',
    nombre_usuario:  'carlos_admin',
    password:        'admin123',
    id_rol:          2,
    activo:          1,
  },
  {
    nombre_completo: 'Elena Ejecutivo',
    nombre_usuario:  'elena_ejec',
    password:        'ejecutivo123',
    id_rol:          1,
    activo:          1,
  },
];

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const shouldExecute = process.argv.includes('--execute');

  console.log('='.repeat(60));
  console.log('RC Tractoparts — User Seeding Script');
  console.log('Mode:', shouldExecute ? '🔴 EXECUTE (writes to DB)' : '👁  PREVIEW (SQL only, no writes)');
  console.log('='.repeat(60) + '\n');

  // Hash all passwords in parallel, self-verify each one immediately
  const seeded = await Promise.all(
    SEED_USERS.map(async (u) => {
      const hash     = await bcrypt.hash(u.password, ROUNDS);
      const verified = await bcrypt.compare(u.password, hash);

      if (!verified) {
        throw new Error(`FATAL: self-verification failed for '${u.nombre_usuario}'. Aborting.`);
      }

      return { ...u, password_hash: hash };
    })
  );

  // Verification table
  console.log('Generated hashes (all self-verified ✓):');
  console.log('-'.repeat(60));
  seeded.forEach(u => {
    console.log(`User     : ${u.nombre_usuario}  |  Password: ${u.password}  |  Rol: ${u.id_rol}`);
    console.log(`Hash     : ${u.password_hash}`);
    console.log('-'.repeat(60));
  });

  // SQL block
  const sql = buildSql(seeded);
  console.log('\n=== READY-TO-RUN SQL (idempotent ON DUPLICATE KEY UPDATE) ===\n');
  console.log(sql);

  if (!shouldExecute) {
    console.log('💡 Run with --execute to apply to the database.\n');
    return;
  }

  // Execute
  const { pool } = require('../src/config/db');
  try {
    console.log('🔴 Applying to database...');
    for (const u of seeded) {
      const [result] = await pool.execute(
        `INSERT INTO usuarios
           (nombre_completo, nombre_usuario, password_hash, id_rol, activo, intentos_fallidos, bloqueado_hasta)
         VALUES (?, ?, ?, ?, 1, 0, NULL)
         ON DUPLICATE KEY UPDATE
           nombre_completo   = VALUES(nombre_completo),
           password_hash     = VALUES(password_hash),
           id_rol            = VALUES(id_rol),
           activo            = 1,
           intentos_fallidos = 0,
           bloqueado_hasta   = NULL`,
        [u.nombre_completo, u.nombre_usuario, u.password_hash, u.id_rol]
      );
      console.log(`  ✓ ${result.insertId > 0 ? 'INSERTED' : 'UPDATED'}: ${u.nombre_usuario}`);
    }

    // ── Defensive SysAdmin hydration guard ────────────────────────────────
    // Ensure that at least one user with nombre_usuario='sysadmin' OR id_rol=4
    // exists in the system after seeding. If neither condition is met, this
    // indicates the SysAdmin seed was skipped or was missing — create it now
    // with absolute system-wide permissions.
    const [[existsRow]] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM usuarios
       WHERE nombre_usuario = 'sysadmin' OR id_rol = 4
       LIMIT 1`
    );

    if (!existsRow || existsRow.cnt === 0) {
      console.log('\n⚠️  SysAdmin guard triggered — no sysadmin user found. Creating emergency SysAdmin…');
      const saPass   = 'sysadmin123';
      const saHash   = await bcrypt.hash(saPass, ROUNDS);
      const saVerify = await bcrypt.compare(saPass, saHash);
      if (!saVerify) throw new Error('FATAL: SysAdmin emergency hash self-verification failed.');

      await pool.execute(
        `INSERT INTO usuarios
           (nombre_completo, nombre_usuario, password_hash, id_rol, activo, intentos_fallidos, bloqueado_hasta)
         VALUES ('Administrador del Sistema', 'sysadmin', ?, 4, 1, 0, NULL)
         ON DUPLICATE KEY UPDATE
           password_hash     = VALUES(password_hash),
           id_rol            = 4,
           activo            = 1,
           intentos_fallidos = 0,
           bloqueado_hasta   = NULL`,
        [saHash]
      );
      console.log('  ✓ EMERGENCY CREATED: sysadmin (id_rol=4, password=sysadmin123)');
    } else {
      console.log('  ✓ SysAdmin guard: sysadmin user confirmed present in database.');
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log('\n✅ All seed users applied.\n');
  } catch (err) {
    console.error('❌ Database error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function buildSql(users) {
  const lines = ['USE rc_tractoparts;', ''];
  users.forEach(u => {
    lines.push(`-- ${u.nombre_usuario}  (password: ${u.password})`);
    lines.push(
      `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo, intentos_fallidos, bloqueado_hasta) ` +
      `VALUES ('${u.nombre_completo}', '${u.nombre_usuario}', '${u.password_hash}', ${u.id_rol}, 1, 0, NULL) ` +
      `ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), id_rol = VALUES(id_rol), activo = 1, intentos_fallidos = 0, bloqueado_hasta = NULL;`
    );
    lines.push('');
  });
  return lines.join('\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
