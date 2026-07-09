-- =============================================================================
-- sql/upgrade_2026_correlativo_692.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Do NOT run sql/init.js / npm run db:init against a live database that
-- already has real cotizaciones — that script DROPs and recreates the whole
-- database from scratch. This script instead:
--   1. Creates the new cotizacion_borrador_lock table (idempotent: safe to
--      re-run, uses CREATE TABLE IF NOT EXISTS).
--   2. Re-calibrates the 2026 correlativo counter so the NEXT quotation
--      created continues the historical Excel series at SC-2026/000692.
--
-- ⚠️  Back up the database before running this. Run manually against the
--     target environment — it is intentionally NOT wired into any npm script
--     so it can never run by accident on the wrong database.
--
-- Usage:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_correlativo_692.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS cotizacion_borrador_lock (
  anio               YEAR         NOT NULL,
  numero_correlativo VARCHAR(20)  NOT NULL,
  id_ejecutivo       INT UNSIGNED NOT NULL,
  nombre_ejecutivo   VARCHAR(100) NOT NULL,
  socket_id          VARCHAR(100) NOT NULL,
  iniciado_en        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (anio),
  CONSTRAINT fk_borrador_ejecutivo FOREIGN KEY (id_ejecutivo)
    REFERENCES usuarios (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Re-calibrate the 2026 counter to 691 so the NEXT generated correlativo is
-- SC-2026/000692. Only touches the row if the counter has not already moved
-- past 691 (i.e. this system has not yet produced a real quotation this
-- year) — this guard prevents accidentally rewinding a counter that has
-- already issued live serials.
UPDATE cotizaciones_correlativo
   SET ultimo_nro = 691
 WHERE anio = 2026
   AND ultimo_nro < 691;

-- If no row exists yet for 2026 at all, seed it.
INSERT INTO cotizaciones_correlativo (anio, ultimo_nro)
SELECT 2026, 691
WHERE NOT EXISTS (SELECT 1 FROM cotizaciones_correlativo WHERE anio = 2026);
