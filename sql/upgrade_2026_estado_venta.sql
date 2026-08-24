-- =============================================================================
-- sql/upgrade_2026_estado_venta.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Adds commercial follow-up tracking to cotizaciones, independent of the
-- existing `estado` approval workflow (Pendiente/Confirmada/etc.):
--   estado_venta               — ENUM: Interesado, En negociacion, Confirmado,
--                                 No le interesa, Venta concretada, Otro
--   estado_venta_detalle       — free text, required when estado_venta = Otro
--   fecha_proximo_seguimiento  — date of the next scheduled follow-up
--
-- WHY THIS IS NEEDED: sql/init.sql only auto-runs on a FIRST boot (empty
-- db_data volume). A database initialised before this change is missing these
-- columns, and the new readRepository/writeRepository queries name them
-- explicitly — MySQL would reject every quotation query with
-- "Unknown column 'estado_venta' in 'field list'" (ER_BAD_FIELD_ERROR).
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that
-- script DROPs and recreates everything. Run THIS script instead: additive only.
--
-- ⚠️  Back up the database first, then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_estado_venta.sql
--
-- IDEMPOTENT — safe to run on every environment without checking first. Each
-- step probes information_schema and only executes the ALTER when the column
-- is absent, so a second run is a no-op.
--
-- ⚠️  Do NOT "simplify" this to `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
-- that clause is a MariaDB extension and is a SYNTAX ERROR (ER_PARSE_ERROR
-- 1064) on real MySQL, which this project runs (`image: mysql:8.0` in
-- docker-compose.yml). The information_schema + PREPARE dance below is the
-- portable MySQL equivalent.
--
-- NO BACKFILL: there is no existing source for a client's sales-follow-up
-- status — it was never captured anywhere before this feature. All three
-- columns stay NULL until a user fills them in from a quotation's detail
-- view. This is expected, not a failed migration.
-- =============================================================================

-- ── 1. estado_venta (idempotent) ──────────────────────────────────────────────
SET @add_estado_venta := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''estado_venta ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones
       ADD COLUMN estado_venta ENUM(
             ''Interesado'', ''En negociacion'', ''Confirmado'',
             ''No le interesa'', ''Venta concretada'', ''Otro''
           ) DEFAULT NULL
         COMMENT ''Seguimiento comercial del vendedor. NULL = sin seguimiento registrado aun.''
         AFTER id_licitacion'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND COLUMN_NAME  = 'estado_venta'
);
PREPARE stmt FROM @add_estado_venta;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. estado_venta_detalle (idempotent) — runs after step 1 ────────────────
SET @add_estado_venta_detalle := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''estado_venta_detalle ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones
       ADD COLUMN estado_venta_detalle VARCHAR(255) DEFAULT NULL
         COMMENT ''Texto libre obligatorio cuando estado_venta = Otro.''
         AFTER estado_venta'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND COLUMN_NAME  = 'estado_venta_detalle'
);
PREPARE stmt FROM @add_estado_venta_detalle;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 3. fecha_proximo_seguimiento (idempotent) — runs after step 2 ───────────
SET @add_fecha_seguimiento := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''fecha_proximo_seguimiento ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones
       ADD COLUMN fecha_proximo_seguimiento DATE DEFAULT NULL
         COMMENT ''Fecha en la que se debe volver a contactar al cliente.''
         AFTER estado_venta_detalle'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND COLUMN_NAME  = 'fecha_proximo_seguimiento'
);
PREPARE stmt FROM @add_fecha_seguimiento;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 4. Índices de soporte (idempotentes) ─────────────────────────────────────
SET @add_idx_estado_venta := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''idx_cot_estado_venta ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones ADD INDEX idx_cot_estado_venta (estado_venta)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND INDEX_NAME    = 'idx_cot_estado_venta'
);
PREPARE stmt FROM @add_idx_estado_venta;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_idx_prox_seguimiento := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''idx_cot_prox_seguimiento ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones ADD INDEX idx_cot_prox_seguimiento (fecha_proximo_seguimiento)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND INDEX_NAME    = 'idx_cot_prox_seguimiento'
);
PREPARE stmt FROM @add_idx_prox_seguimiento;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 5. Verificación — deben volver las tres filas ────────────────────────────
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'cotizaciones'
   AND COLUMN_NAME IN ('estado_venta', 'estado_venta_detalle', 'fecha_proximo_seguimiento')
 ORDER BY ORDINAL_POSITION;
