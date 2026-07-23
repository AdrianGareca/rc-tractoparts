-- =============================================================================
-- sql/upgrade_2026_licitaciones.sql
-- ONE-TIME, NON-DESTRUCTIVE upgrade for an ALREADY-RUNNING database.
--
-- Introduces the LICITACIONES module (tenders) on a live database:
--   * rol Proyectos (id=5)
--   * tablas licitaciones_correlativo, licitaciones, licitacion_historial_estados
--   * columna cotizaciones.id_licitacion (FK->licitaciones, ON DELETE SET NULL)
--   * columna notificaciones.id_licitacion + tipo ENUM extendido con 'licitacion'
--     + id_cotizacion pasa a NULLABLE (una notificación es de cotización O de
--       licitación, no de ambas)
--
-- Mirrors what sql/init.sql already bakes in for fresh installs. init.sql only
-- auto-runs on a FIRST boot (empty db_data volume); a database initialised from
-- an older init.sql needs THIS script so the new LicitacionModel/QuotationModel
-- queries don't fail with ER_BAD_FIELD_ERROR / ER_NO_SUCH_TABLE.
--
-- Do NOT run sql/init.js / npm run db:init against a live database — that script
-- DROPs and recreates everything. Run THIS script instead: it is additive only.
--
-- ⚠️  Back up the database first (README §16.7), then run against the target env:
--   mysql -u <user> -p <database_name> < sql/upgrade_2026_licitaciones.sql
--
-- IDEMPOTENT — safe to run on every environment, and safe to run twice. Tables
-- use CREATE TABLE IF NOT EXISTS; every column/index/FK/ENUM change probes
-- information_schema first and only executes the ALTER when needed, so a second
-- run is a no-op.
--
-- ⚠️  Do NOT "simplify" this to `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
-- that clause is a MariaDB extension and is a SYNTAX ERROR (ER_PARSE_ERROR
-- 1064) on real MySQL, which this project runs (`image: mysql:8.0` in
-- docker-compose.yml). The information_schema + PREPARE dance below is the
-- portable MySQL equivalent.
-- =============================================================================

-- ── 1. Rol Proyectos (id=5) — idempotente ────────────────────────────────────
-- ON DUPLICATE KEY UPDATE sobre el id (o el nombre único) hace la re-ejecución
-- un no-op sin fallar por PK/UNIQUE duplicado.
INSERT INTO roles (id, nombre, descripcion) VALUES
  (5, 'Proyectos', 'Projects/tenders executive; manages licitaciones, does not create quotations')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), descripcion = VALUES(descripcion);

-- ── 2. licitaciones_correlativo (idempotente via IF NOT EXISTS) ───────────────
CREATE TABLE IF NOT EXISTS licitaciones_correlativo (
  anio       YEAR         NOT NULL,
  ultimo_nro INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Semilla 2026 — INSERT IGNORE para que una segunda corrida no pise el contador
-- ya avanzado si la primera licitación ya se creó.
INSERT IGNORE INTO licitaciones_correlativo (anio, ultimo_nro) VALUES (2026, 0);

-- ── 3. licitaciones (idempotente via IF NOT EXISTS) ───────────────────────────
CREATE TABLE IF NOT EXISTS licitaciones (
  id                     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  codigo                 VARCHAR(20)   NOT NULL,
  nombre                 VARCHAR(200)  NOT NULL,
  id_cliente             INT UNSIGNED  NOT NULL,
  descripcion            TEXT          DEFAULT NULL,
  presupuesto_referencial DECIMAL(15,2) DEFAULT NULL,
  moneda                 CHAR(3)       NOT NULL DEFAULT 'BOB',
  fecha_limite           DATE          DEFAULT NULL,
  estado                 ENUM(
                           'En preparacion',
                           'Cotizando',
                           'En evaluacion',
                           'Presentada',
                           'Adjudicada',
                           'No adjudicada',
                           'Archivada'
                         ) NOT NULL DEFAULT 'En preparacion',
  observaciones_resultado TEXT         DEFAULT NULL,
  id_responsable         INT UNSIGNED  NOT NULL,
  creado_en              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_licitaciones_codigo (codigo),
  KEY idx_lic_estado      (estado),
  KEY idx_lic_responsable (id_responsable),
  KEY idx_lic_cliente     (id_cliente),
  CONSTRAINT fk_lic_cliente
    FOREIGN KEY (id_cliente)     REFERENCES clientes (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_lic_responsable
    FOREIGN KEY (id_responsable) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. licitacion_historial_estados (idempotente via IF NOT EXISTS) ───────────
CREATE TABLE IF NOT EXISTS licitacion_historial_estados (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_licitacion   INT UNSIGNED NOT NULL,
  estado_anterior VARCHAR(30)  DEFAULT NULL,
  estado_nuevo    VARCHAR(30)  NOT NULL,
  id_usuario      INT UNSIGNED DEFAULT NULL,
  nombre_usuario  VARCHAR(50)  DEFAULT NULL,
  rol_usuario     VARCHAR(30)  DEFAULT NULL,
  observacion     TEXT         DEFAULT NULL,
  ip_origen       VARCHAR(45)  DEFAULT NULL,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lic_hist_licitacion (id_licitacion),
  CONSTRAINT fk_lic_historial_licitacion
    FOREIGN KEY (id_licitacion) REFERENCES licitaciones (id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_lic_historial_usuario
    FOREIGN KEY (id_usuario)    REFERENCES usuarios     (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. cotizaciones.id_licitacion (columna, idempotente) ──────────────────────
SET @add_cot_lic := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''cotizaciones.id_licitacion ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones
       ADD COLUMN id_licitacion INT UNSIGNED DEFAULT NULL
         COMMENT ''FK->licitaciones(id) — vincula la cotización a una licitación paraguas. NULL = cotización normal.''
         AFTER mostrar_codigos'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND COLUMN_NAME  = 'id_licitacion'
);
PREPARE stmt FROM @add_cot_lic;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 6. cotizaciones — índice de id_licitacion (idempotente) ───────────────────
SET @add_cot_lic_idx := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''idx_cot_licitacion ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones ADD INDEX idx_cot_licitacion (id_licitacion)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND INDEX_NAME    = 'idx_cot_licitacion'
);
PREPARE stmt FROM @add_cot_lic_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 7. cotizaciones — FK a licitaciones (idempotente) ─────────────────────────
-- Corre después de 3/5/6, así licitaciones, la columna y el índice ya existen.
SET @add_cot_lic_fk := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''fk_cot_licitacion ya existe — omitido'' AS resultado',
    'ALTER TABLE cotizaciones
       ADD CONSTRAINT fk_cot_licitacion FOREIGN KEY (id_licitacion)
         REFERENCES licitaciones (id) ON DELETE SET NULL ON UPDATE CASCADE'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND CONSTRAINT_NAME = 'fk_cot_licitacion'
);
PREPARE stmt FROM @add_cot_lic_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 8. notificaciones.id_cotizacion → NULLABLE (idempotente) ──────────────────
-- Una notificación de licitación no tiene cotización. Sólo aflojamos el NOT NULL
-- si todavía está en NOT NULL (IS_NULLABLE='NO'); si ya es nullable, no-op.
SET @relax_notif_cot := (
  SELECT IF(
    COUNT(*) = 0,
    'SELECT ''notificaciones.id_cotizacion ya es NULLABLE — omitido'' AS resultado',
    'ALTER TABLE notificaciones
       MODIFY COLUMN id_cotizacion INT UNSIGNED DEFAULT NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'notificaciones'
    AND COLUMN_NAME  = 'id_cotizacion'
    AND IS_NULLABLE  = 'NO'
);
PREPARE stmt FROM @relax_notif_cot;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 9. notificaciones.id_licitacion (columna, idempotente) ────────────────────
SET @add_notif_lic := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''notificaciones.id_licitacion ya existe — omitido'' AS resultado',
    'ALTER TABLE notificaciones
       ADD COLUMN id_licitacion INT UNSIGNED DEFAULT NULL
         COMMENT ''Licitación asociada. NULL cuando la notificación es de una cotización.''
         AFTER id_cotizacion'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'notificaciones'
    AND COLUMN_NAME  = 'id_licitacion'
);
PREPARE stmt FROM @add_notif_lic;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 10. notificaciones.tipo — agregar 'licitacion' al ENUM (idempotente) ──────
-- ALTER aditivo: agrega el valor al final, conserva los 3 existentes. Sólo se
-- ejecuta si el ENUM todavía no lo contiene (COLUMN_TYPE no incluye la cadena).
SET @add_notif_tipo := (
  SELECT IF(
    LOCATE('licitacion', COLUMN_TYPE) > 0,
    'SELECT ''notificaciones.tipo ya incluye licitacion — omitido'' AS resultado',
    'ALTER TABLE notificaciones
       MODIFY COLUMN tipo ENUM(''correccion'',''aprobacion'',''envio_cliente'',''licitacion'')
         NOT NULL DEFAULT ''aprobacion'''
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'notificaciones'
    AND COLUMN_NAME  = 'tipo'
);
PREPARE stmt FROM @add_notif_tipo;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 11. notificaciones — índice de id_licitacion (idempotente) ────────────────
SET @add_notif_lic_idx := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''idx_notif_licitacion ya existe — omitido'' AS resultado',
    'ALTER TABLE notificaciones ADD INDEX idx_notif_licitacion (id_licitacion)'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'notificaciones'
    AND INDEX_NAME    = 'idx_notif_licitacion'
);
PREPARE stmt FROM @add_notif_lic_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 12. notificaciones — FK a licitaciones (idempotente) ──────────────────────
SET @add_notif_lic_fk := (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''fk_notif_licitacion ya existe — omitido'' AS resultado',
    'ALTER TABLE notificaciones
       ADD CONSTRAINT fk_notif_licitacion FOREIGN KEY (id_licitacion)
         REFERENCES licitaciones (id) ON DELETE CASCADE ON UPDATE CASCADE'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'notificaciones'
    AND CONSTRAINT_NAME = 'fk_notif_licitacion'
);
PREPARE stmt FROM @add_notif_lic_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 13. Verificación ──────────────────────────────────────────────────────────
SELECT id, nombre FROM roles WHERE id = 5;

SELECT TABLE_NAME
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('licitaciones', 'licitaciones_correlativo', 'licitacion_historial_estados')
 ORDER BY TABLE_NAME;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND (
        (TABLE_NAME = 'cotizaciones'  AND COLUMN_NAME = 'id_licitacion')
     OR (TABLE_NAME = 'notificaciones' AND COLUMN_NAME IN ('id_cotizacion', 'id_licitacion', 'tipo'))
   )
 ORDER BY TABLE_NAME, COLUMN_NAME;
