-- =============================================================================
-- Migration: add comentarios_admin column to cotizaciones
-- Purpose: stores official supervisor review/comments written by the
--          Administracion role before a quotation enters the approval queue.
--          Visible to the Jefe when reviewing in the approval panel.
-- Run once against rc_tractoparts database.
-- =============================================================================

USE rc_tractoparts;

-- Only add if the column does not already exist (check via INFORMATION_SCHEMA)
-- MySQL 5.x / 8.x compatible (no IF NOT EXISTS in ADD COLUMN for MySQL)
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'cotizaciones'
    AND COLUMN_NAME  = 'comentarios_admin'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE cotizaciones ADD COLUMN comentarios_admin TEXT DEFAULT NULL COMMENT ''Supervisor review comment written by Administracion role'' AFTER obs_aprobacion',
  'SELECT ''Column already exists, skipping.'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
