require('dotenv').config();
const { pool } = require('../src/config/db');

const sql = "ALTER TABLE cotizaciones MODIFY COLUMN estado ENUM('Pendiente','En revision','En espera','Aprobada internamente','Enviada al cliente','Aceptada','Rechazada','Archivada') NOT NULL DEFAULT 'Pendiente'";

pool.execute(sql)
  .then(() => { console.log('Migration OK: En espera state added.'); pool.end(); })
  .catch(e => { console.error('Migration error:', e.message); pool.end(); });
