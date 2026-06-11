// Run this script to add the comentarios_admin column to the cotizaciones table
'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'rc_tractoparts',
  });

  try {
    // Check if column already exists before attempting to add it
    const [existing] = await conn.query(
      "SHOW COLUMNS FROM cotizaciones LIKE 'comentarios_admin'"
    );

    if (existing.length > 0) {
      console.log('[Migration] SKIP — comentarios_admin column already exists.');
      return;
    }

    const sql = [
      'ALTER TABLE cotizaciones',
      'ADD COLUMN comentarios_admin TEXT DEFAULT NULL',
      "COMMENT 'Supervisor review comment written by Administracion role'",
      'AFTER obs_aprobacion',
    ].join(' ');

    await conn.execute(sql);

    const [rows] = await conn.query(
      "SHOW COLUMNS FROM cotizaciones LIKE 'comentarios_admin'"
    );

    if (rows.length > 0) {
      console.log('[Migration] SUCCESS — comentarios_admin column is present.');
      console.log('            Type:', rows[0].Type, '| Null:', rows[0].Null);
    } else {
      console.error('[Migration] FAILED — column was not created.');
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

migrate().catch((err) => {
  console.error('[Migration] ERROR:', err.message);
  process.exit(1);
});
