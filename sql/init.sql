-- =============================================================================
-- RC Tractoparts — Quotation Management System
-- Database Initialization Script (Section 3.5.2 — Data Dictionary)
-- Engine: MySQL 8.0+  |  Charset: utf8mb4  |  Collation: utf8mb4_unicode_ci
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS rc_tractoparts;
USE rc_tractoparts;
-- ---------------------------------------------------------------------------
-- 1. ROLES — Strong entity; catalog of system profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(30)      NOT NULL,
  descripcion VARCHAR(120)     DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the three system roles
INSERT IGNORE INTO roles (id, nombre, descripcion) VALUES
  (1, 'Ejecutivo',       'Sales executive; registers quotations and uploads PDFs'),
  (2, 'Administracion',  'Administrative staff; manages clients and reviews records'),
  (3, 'Jefe',            'Department head; approves quotations and manages users');

-- ---------------------------------------------------------------------------
-- 2. USUARIOS — Strong entity; system user accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nombre_completo  VARCHAR(100)  NOT NULL,
  nombre_usuario   VARCHAR(50)   NOT NULL,
  password_hash    VARCHAR(255)  NOT NULL,               -- bcrypt hash, never plaintext
  id_rol           TINYINT UNSIGNED NOT NULL,
  activo           TINYINT(1)    NOT NULL DEFAULT 1,     -- 1=active, 0=inactive
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0, -- consecutive failed logins
  bloqueado_hasta  DATETIME      DEFAULT NULL,           -- NULL = not locked
  ultimo_acceso    DATETIME      DEFAULT NULL,
  creado_en        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_nombre_usuario (nombre_usuario),
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (id_rol) REFERENCES roles (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. CLIENTES — Strong entity; commercial counterparts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  razon_social VARCHAR(150)  NOT NULL,
  nit          VARCHAR(20)   DEFAULT NULL,               -- Tax ID; NULL for prospects
  contacto     VARCHAR(100)  DEFAULT NULL,
  email        VARCHAR(120)  DEFAULT NULL,
  telefono     VARCHAR(30)   DEFAULT NULL,
  activo       TINYINT(1)    NOT NULL DEFAULT 1,
  creado_en    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clientes_nit (nit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. PRODUCTOS — Strong entity; internal product/part catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
  id               INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  codigo           VARCHAR(50)    NOT NULL,
  descripcion      VARCHAR(255)   NOT NULL,
  unidad           VARCHAR(20)    DEFAULT 'UND',
  precio_referencia DECIMAL(15,2) DEFAULT NULL,
  marca            VARCHAR(80)    DEFAULT NULL,
  activo           TINYINT(1)     NOT NULL DEFAULT 1,
  creado_en        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_productos_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. COTIZACIONES_CORRELATIVO — Weak entity; atomic serial number generator
--    One row per calendar year; incremented inside a SELECT ... FOR UPDATE transaction
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizaciones_correlativo (
  anio      YEAR         NOT NULL,   -- 1-byte MySQL YEAR type; PK guarantees one row per year
  ultimo_nro INT UNSIGNED NOT NULL DEFAULT 0, -- last assigned serial for this year
  PRIMARY KEY (anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. COTIZACIONES — Weak entity; main quotation record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizaciones (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  numero_correlativo VARCHAR(20)   NOT NULL,              -- COT-YYYY-NNNN; generated atomically
  id_cliente         INT UNSIGNED  NOT NULL,
  id_ejecutivo       INT UNSIGNED  NOT NULL,
  descripcion        TEXT          NOT NULL,
  monto_total        DECIMAL(15,2) DEFAULT NULL,
  moneda             CHAR(3)       NOT NULL DEFAULT 'USD', -- ISO 4217 code
  estado             ENUM(
    'Pendiente',
    'En revision',
    'Aprobada internamente',
    'Enviada al cliente',
    'Aceptada',
    'Rechazada',
    'Archivada'
  ) NOT NULL DEFAULT 'Pendiente',
  pdf_ruta           VARCHAR(500)  DEFAULT NULL,          -- relative path to the stored PDF
  observaciones      TEXT          DEFAULT NULL,
  fecha_emision      DATE          NOT NULL,
  fecha_validez      DATE          DEFAULT NULL,
  aprobado_por       INT UNSIGNED  DEFAULT NULL,          -- FK → usuarios.id (Jefe who decided)
  fecha_aprobacion   DATETIME      DEFAULT NULL,
  obs_aprobacion     TEXT          DEFAULT NULL,
  creado_en          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cotizaciones_correlativo (numero_correlativo),
  CONSTRAINT fk_cot_cliente   FOREIGN KEY (id_cliente)   REFERENCES clientes (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cot_ejecutivo FOREIGN KEY (id_ejecutivo) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cot_aprobador FOREIGN KEY (aprobado_por) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 7. COTIZACION_DETALLES — Weak entity; line items of each quotation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizacion_detalles (
  id               INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  id_cotizacion    INT UNSIGNED   NOT NULL,
  id_producto      INT UNSIGNED   DEFAULT NULL,           -- NULL = free-text item, no catalog ref
  descripcion_item VARCHAR(255)   NOT NULL,
  cantidad         DECIMAL(12,4)  NOT NULL,
  precio_unitario  DECIMAL(15,2)  NOT NULL,
  subtotal         DECIMAL(15,2)  NOT NULL,               -- persisted = cantidad × precio_unitario
  PRIMARY KEY (id),
  CONSTRAINT fk_det_cotizacion FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_det_producto   FOREIGN KEY (id_producto)   REFERENCES productos (id)   ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 8. AUDITORIA — Sprint 2 HU11: simplified audit trail (structural log)
--    Captures the table affected, action code, record ID, client IP, and an
--    optional JSON detail blob. Complements bitacora_auditoria (legacy).
--    No UPDATE/DELETE is permitted on this table by any application role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
  id_auditoria          INT            NOT NULL AUTO_INCREMENT,
  id_usuario            INT            NULL,
  tabla_afectada        VARCHAR(50)    NOT NULL,
  accion                VARCHAR(20)    NOT NULL,
  id_registro_afectado  INT            NULL,
  detalles              TEXT           NULL,
  ip_cliente            VARCHAR(45)    NOT NULL DEFAULT '0.0.0.0',
  fecha_hora            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_auditoria),
  CONSTRAINT fk_auditoria_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 9. BITACORA_AUDITORIA — Weak entity; immutable audit log (extended / legacy)
--    No UPDATE/DELETE is permitted on this table by any application role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bitacora_auditoria (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario     INT UNSIGNED    DEFAULT NULL,
  nombre_usuario VARCHAR(50)     DEFAULT NULL,            -- denormalized; survives user deletion
  accion         VARCHAR(80)     NOT NULL,                -- e.g. LOGIN, CREAR_COTIZACION, APROBAR
  entidad        VARCHAR(50)     DEFAULT NULL,            -- affected table name
  id_entidad     INT UNSIGNED    DEFAULT NULL,            -- affected record ID
  detalle        JSON            DEFAULT NULL,            -- extra context (before/after values)
  ip_origen      VARCHAR(45)     DEFAULT NULL,            -- IPv4 or IPv6
  resultado      ENUM('exito','fallo') NOT NULL DEFAULT 'exito',
  creado_en      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_bitacora_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
