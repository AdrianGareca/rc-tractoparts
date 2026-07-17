-- =============================================================================
-- sql/upgrade_2026_origenes_cliente.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Adds the `origenes_cliente` catalog (same shape as `marcas`: id, nombre,
-- activo) and links it to `clientes` via a new nullable `id_origen_cliente`
-- FK column. Lets Administración/Jefe classify where a client came from
-- (Cliente / Cliente potencial / Publicidad RRSS / Otros) for reporting —
-- this value is NEVER printed on the cotización PDF (see pdfService.js),
-- only surfaced in /api/reportes.
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that
-- script DROPs and recreates everything. Run THIS script instead: it is
-- additive only.
--
-- ⚠️  Back up the database first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_origenes_cliente.sql
--
-- IDEMPOTENT — safe to run on every environment without checking first.
-- The table uses CREATE TABLE IF NOT EXISTS; the column/index/FK on clientes
-- each probe information_schema first and only run when absent.
--
-- ⚠️  Do NOT "simplify" this to `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
-- that clause is a MariaDB extension and is a SYNTAX ERROR (ER_PARSE_ERROR
-- 1064) on real MySQL, which this project runs (`image: mysql:8.0` in
-- docker-compose.yml). The information_schema + PREPARE dance below is the
-- portable MySQL equivalent.
-- =============================================================================

-- ── 1. Catalog table (idempotent via IF NOT EXISTS) ──────────────────────────
CREATE TABLE IF NOT EXISTS origenes_cliente (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_origenes_cliente_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Seed defaults (INSERT IGNORE — uq_origenes_cliente_nombre absorbs re-runs) ──
INSERT IGNORE INTO origenes_cliente (nombre) VALUES
  ('Cliente'),
  ('Cliente potencial'),
  ('Publicidad RRSS'),
  ('Otros');

-- ── 3. Add clientes.id_origen_cliente (idempotent) ────────────────────────────
SET @add_origen := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''id_origen_cliente ya existe — omitido'' AS resultado',
    'ALTER TABLE clientes
       ADD COLUMN id_origen_cliente INT UNSIGNED DEFAULT NULL
         COMMENT ''FK->origenes_cliente — de dónde vino el cliente (solo reportes, nunca el PDF)''
         AFTER ciudad'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'clientes'
    AND COLUMN_NAME  = 'id_origen_cliente'
);
PREPARE stmt FROM @add_origen;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 4. Add supporting index (idempotent) ──────────────────────────────────────
SET @add_idx := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''idx_clientes_origen ya existe — omitido'' AS resultado',
    'ALTER TABLE clientes ADD INDEX idx_clientes_origen (id_origen_cliente)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'clientes'
    AND INDEX_NAME    = 'idx_clientes_origen'
);
PREPARE stmt FROM @add_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 5. Add the FK constraint (idempotent) ─────────────────────────────────────
-- Runs after steps 1/3 so both origenes_cliente and the column are guaranteed
-- to exist.
SET @add_fk := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''fk_clientes_origen ya existe — omitido'' AS resultado',
    'ALTER TABLE clientes
       ADD CONSTRAINT fk_clientes_origen FOREIGN KEY (id_origen_cliente)
         REFERENCES origenes_cliente (id) ON DELETE SET NULL ON UPDATE CASCADE'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'clientes'
    AND CONSTRAINT_NAME = 'fk_clientes_origen'
);
PREPARE stmt FROM @add_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 6. Verification ────────────────────────────────────────────────────────
SELECT COUNT(*) AS origenes_sembrados FROM origenes_cliente;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'clientes'
   AND COLUMN_NAME  = 'id_origen_cliente';
