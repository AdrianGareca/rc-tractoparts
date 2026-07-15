-- =============================================================================
-- sql/upgrade_2026_cliente_direccion_ciudad.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Guarantees clientes.direccion and clientes.ciudad exist before deploying the
-- release that reads/writes them (ClientModel SELECT/INSERT/UPDATE and the
-- "DATOS GENERALES DEL CLIENTE" grid in pdfService.drawThreeColumnGrid).
--
-- WHY THIS IS NEEDED: both columns are declared in sql/init.sql's CREATE TABLE
-- as of commit f66958f (2026-06-17), but init.sql only auto-runs on a FIRST
-- boot (empty db_data volume). A database initialised from an older init.sql is
-- still missing them, and the new ClientModel queries name both columns
-- explicitly — MySQL would reject every client query with
-- "Unknown column 'direccion' in 'field list'" (ER_BAD_FIELD_ERROR).
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that script
-- DROPs and recreates everything. Run THIS script instead: it is additive only.
--
-- ⚠️  Back up the database first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_cliente_direccion_ciudad.sql
--
-- IDEMPOTENT — safe to run on every environment without checking first. Each
-- step probes information_schema and only executes the ALTER when the column is
-- absent, so a second run is a no-op.
--
-- ⚠️  Do NOT "simplify" this to `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
-- that clause is a MariaDB extension and is a SYNTAX ERROR (ER_PARSE_ERROR
-- 1064) on real MySQL, which this project runs (`image: mysql:8.0` in
-- docker-compose.yml). The information_schema + PREPARE dance below is the
-- portable MySQL equivalent.
--
-- NO BACKFILL: unlike fecha_confirmacion (recoverable from
-- cotizacion_historial_estados), there is no existing source for a client's
-- address — the data was never captured anywhere. Both columns stay NULL until
-- a user fills them in from "Gestión de Clientes", and the PDF keeps printing
-- '—' for that client until they do. This is expected, not a failed migration.
-- =============================================================================

-- ── 1. Add the client address column (idempotent) ────────────────────────────
SET @add_direccion := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''direccion ya existe — omitido'' AS resultado',
    'ALTER TABLE clientes
       ADD COLUMN direccion VARCHAR(200) DEFAULT NULL
         COMMENT ''Dirección postal o comercial del cliente'' AFTER telefono'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'clientes'
    AND COLUMN_NAME  = 'direccion'
);
PREPARE stmt FROM @add_direccion;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. Add the client city column (idempotent) ───────────────────────────────
-- Runs after step 1, so `AFTER direccion` is guaranteed to resolve.
SET @add_ciudad := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''ciudad ya existe — omitido'' AS resultado',
    'ALTER TABLE clientes
       ADD COLUMN ciudad VARCHAR(100) DEFAULT NULL
         COMMENT ''Ciudad donde opera el cliente'' AFTER direccion'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'clientes'
    AND COLUMN_NAME  = 'ciudad'
);
PREPARE stmt FROM @add_ciudad;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 3. Verification — both rows must come back ───────────────────────────────
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'clientes'
   AND COLUMN_NAME IN ('direccion', 'ciudad')
 ORDER BY ORDINAL_POSITION;

-- Spot-check how many clients still lack an address (expected: all of them,
-- immediately after this migration — see the NO BACKFILL note above):
--   SELECT COUNT(*) AS sin_direccion FROM clientes WHERE direccion IS NULL;
