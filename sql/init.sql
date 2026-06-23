-- RC Tractoparts — Quotation Management System
-- MASTER INITIALIZATION SCRIPT  (Single Source of Truth)
--
-- This file is the ONLY SQL script required to bootstrap the full database
-- from scratch.  It supersedes and absorbs all former migration files:
--   * migration_add_sysadmin_role.sql    -> SysAdmin role now seeded inline
--   * migration_add_en_espera.sql        -> 'En espera' ENUM value baked in
--   * migration_add_comentarios_admin.sql -> comentarios_admin column baked in
--   * migration_add_marcas.sql           -> marcas table + FK baked in
--
-- 3NF NORMALIZATION AUDIT (applied in-place, no ALTER TABLE scripts required):
--   * productos.marca VARCHAR(80) REMOVED -> replaced with productos.marca_id
--     INT UNSIGNED FK→marcas(id). Eliminates the denormalized brand-name string
--     and establishes proper referential integrity (2NF/3NF compliance).
--   * cotizacion_detalles: codigo_parte VARCHAR(50) ADDED. Stores the
--     Manufacturer Part Number per line item for ad-hoc parts not yet in the
--     productos catalog, satisfying the heavy-machinery quoting requirement.
--
-- Execution order (strict -- respects all FK constraints):
--   1.  Database bootstrap
--   2.  roles
--   3.  usuarios
--   4.  marcas
--   5.  clientes
--   6.  productos
--   7.  cotizaciones_correlativo
--   8.  cotizaciones
--   9.  cotizacion_detalles  (native marca_id FK -- no ALTER TABLE needed)
--   10. auditoria
--   11. bitacora_auditoria
--   12. cotizacion_historial_estados
--   13. Seed data
--
-- NOTE: Development password hashes below are PLACEHOLDERS.
--       Run  `node scripts/seed-users.js --execute`  after init to replace
--       them with properly derived bcrypt hashes for each test account.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =============================================================================
-- 0. DATABASE BOOTSTRAP
-- =============================================================================

DROP DATABASE IF EXISTS rc_tractoparts;
CREATE DATABASE rc_tractoparts
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE rc_tractoparts;

-- =============================================================================
-- 1. ROLES
-- =============================================================================

CREATE TABLE roles (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(30)      NOT NULL,
  descripcion VARCHAR(120)     DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- All 4 canonical roles -- IDs are fixed and referenced by application code
INSERT INTO roles (id, nombre, descripcion) VALUES
  (1, 'Ejecutivo',      'Sales executive; registers quotations and uploads PDFs'),
  (2, 'Administracion', 'Administrative staff; manages clients and reviews records'),
  (3, 'Jefe',           'Department head; approves quotations and manages users'),
  (4, 'SysAdmin',       'Systems administrator; absolute system-wide authority over all entities');

-- =============================================================================
-- 2. USUARIOS
-- =============================================================================

CREATE TABLE usuarios (
  id                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  nombre_completo   VARCHAR(100)     NOT NULL,
  nombre_usuario    VARCHAR(50)      NOT NULL,
  password_hash     VARCHAR(255)     NOT NULL,
  id_rol            TINYINT UNSIGNED NOT NULL,
  activo            TINYINT(1)       NOT NULL DEFAULT 1,
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta   DATETIME         DEFAULT NULL,
  ultimo_acceso     DATETIME         DEFAULT NULL,
  creado_en         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_nombre_usuario (nombre_usuario),
  CONSTRAINT fk_usuarios_rol
    FOREIGN KEY (id_rol) REFERENCES roles (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Development / test seed accounts.
-- IMPORTANT: The hashes below are PLACEHOLDER values.
--   Run `node scripts/seed-users.js --execute` to overwrite with proper hashes.
--   Passwords defined in seed-users.js: jefe->'jefe123', admin->'admin123',
--   sysadmin->'sysadmin123', ejecutivos->'ejecutivo123'.
INSERT INTO usuarios (id, nombre_completo, nombre_usuario, password_hash, id_rol) VALUES
  (1, 'Carlos Ejecutivo',      'ejecutivo1',  '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 1),
  (2, 'Elena Ejecutivo',       'elena_ejec',  '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 1),
  (3, 'Carlos Administracion', 'carlos_admin','$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 2),
  (4, 'Admin del Sistema',     'admin',       '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 2),
  (5, 'Jefe del Sistema',      'jefe',        '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 3),
  (6, 'Adrian Jefe',           'jefe1',       '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 3),
  (7, 'System Administrator',  'sysadmin',    '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 4);

-- =============================================================================
-- 3. MARCAS  (Spare Part Brands Catalog)
-- =============================================================================

CREATE TABLE marcas (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_marcas_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8 default heavy-machinery brands
INSERT INTO marcas (nombre) VALUES
  ('Caterpillar'),
  ('Komatsu'),
  ('John Deere'),
  ('Volvo'),
  ('Cummins'),
  ('Case'),
  ('JCB'),
  ('Alternativo');

-- =============================================================================
-- 4. CLIENTES
-- =============================================================================

CREATE TABLE clientes (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  razon_social VARCHAR(150) NOT NULL,
  nit          VARCHAR(20)  DEFAULT NULL,
  contacto     VARCHAR(100) DEFAULT NULL,
  email        VARCHAR(120) DEFAULT NULL,
  telefono     VARCHAR(30)  DEFAULT NULL,
  direccion    VARCHAR(200) DEFAULT NULL
    COMMENT 'Dirección postal o comercial del cliente',
  ciudad       VARCHAR(100) DEFAULT NULL
    COMMENT 'Ciudad donde opera el cliente',
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clientes_nit (nit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. PRODUCTOS
--    3NF fix: the former denormalized `marca VARCHAR(80)` column has been
--    replaced with `marca_id INT UNSIGNED FK→marcas(id)`.  Every catalog item
--    now references the canonical `marcas` table, eliminating transitive
--    dependency and enforcing brand referential integrity.
-- =============================================================================

CREATE TABLE productos (
  id                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  codigo            VARCHAR(50)    NOT NULL,
  descripcion       VARCHAR(255)   NOT NULL,
  unidad            VARCHAR(20)    DEFAULT 'UND',
  precio_referencia DECIMAL(15,2)  DEFAULT NULL,
  marca_id          INT UNSIGNED   NULL
    COMMENT '3NF: FK to marcas.id — replaces the former denormalized marca VARCHAR(80) column.',
  activo            TINYINT(1)     NOT NULL DEFAULT 1,
  creado_en         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_productos_codigo (codigo),
  CONSTRAINT fk_productos_marca
    FOREIGN KEY (marca_id) REFERENCES marcas (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 6. COTIZACIONES_CORRELATIVO
-- =============================================================================

CREATE TABLE cotizaciones_correlativo (
  anio       YEAR         NOT NULL,
  ultimo_nro INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 7. COTIZACIONES
-- =============================================================================

CREATE TABLE cotizaciones (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  numero_correlativo VARCHAR(20)   NOT NULL,
  id_cliente         INT UNSIGNED  NOT NULL,
  id_ejecutivo       INT UNSIGNED  NOT NULL,
  descripcion        TEXT          NOT NULL,
  monto_total        DECIMAL(15,2) DEFAULT NULL,
  moneda             CHAR(3)       NOT NULL DEFAULT 'USD',
  estado             ENUM(
                       'Pendiente',
                       'En revision',
                       'En espera',
                       'Aprobada internamente',
                       'Enviada al cliente',
                       'Aceptada',
                       'Rechazada',
                       'Archivada'
                     ) NOT NULL DEFAULT 'Pendiente',
  pdf_ruta           VARCHAR(500)  DEFAULT NULL,
  excel_ruta         VARCHAR(500)  DEFAULT NULL
    COMMENT 'Relative path to the uploaded Excel spreadsheet; NULL when not yet generated',
  tipo_pedido        VARCHAR(50)   DEFAULT NULL
    COMMENT 'Tipo o canal del pedido (ej. EMAIL, PRESENCIAL, TELÉFONO) — aparece en el box de metadatos del PDF',
  tiempo_entrega     VARCHAR(100)  DEFAULT NULL
    COMMENT 'Tiempo estimado de entrega global de la cotización (ej. 25 DÍAS CALENDARIO)',
  observaciones      TEXT          DEFAULT NULL,
  fecha_emision      DATE          NOT NULL,
  fecha_validez      DATE          DEFAULT NULL,
  aprobado_por       INT UNSIGNED  DEFAULT NULL,
  fecha_aprobacion   DATETIME      DEFAULT NULL,
  obs_aprobacion     TEXT          DEFAULT NULL,
  comentarios_admin  TEXT          DEFAULT NULL
    COMMENT 'Supervisor review comment written by Administracion role',
  -- Requester block (physical sheet: DATOS DEL SOLICITANTE)
  solicitante_no_solicitud VARCHAR(100)  DEFAULT NULL
    COMMENT 'Nº de Solicitud / Nº de OC del solicitante interno',
  solicitante_area         VARCHAR(100)  DEFAULT NULL
    COMMENT 'Área o departamento del solicitante',
  solicitante_celular      VARCHAR(30)   DEFAULT NULL
    COMMENT 'Número de celular del solicitante',
  solicitante_correo       VARCHAR(120)  DEFAULT NULL
    COMMENT 'Correo electrónico del solicitante',
  -- Equipment block (physical sheet: DATOS DEL EQUIPO)
  equipo_marca             VARCHAR(80)   DEFAULT NULL
    COMMENT 'Marca del equipo/maquinaria a reparar',
  equipo_tipo              VARCHAR(80)   DEFAULT NULL
    COMMENT 'Tipo de equipo (ej. Excavadora, Cargador Frontal)',
  equipo_modelo            VARCHAR(80)   DEFAULT NULL
    COMMENT 'Modelo del equipo',
  equipo_serie             VARCHAR(80)   DEFAULT NULL
    COMMENT 'Número de serie del equipo',
  equipo_motor             VARCHAR(80)   DEFAULT NULL
    COMMENT 'Número de motor del equipo',
  creado_en          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cotizaciones_correlativo (numero_correlativo),
  CONSTRAINT fk_cot_cliente
    FOREIGN KEY (id_cliente)   REFERENCES clientes (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cot_ejecutivo
    FOREIGN KEY (id_ejecutivo) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cot_aprobador
    FOREIGN KEY (aprobado_por) REFERENCES usuarios (id) ON DELETE SET NULL  ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 8. COTIZACION_DETALLES
--    3NF-compliant: every non-prime attribute depends solely on the PK (id).
--    • id_producto  — FK to productos(id); links to the structural catalog.
--    • codigo_parte — Manufacturer Part Number stored per line for ad-hoc
--                     items where id_producto is NULL (dynamic entry).  When
--                     id_producto IS NOT NULL, codigo_parte SHOULD mirror
--                     productos.codigo (enforced at the application layer).
--    • marca_id     — FK to marcas(id): brand selected at quote time; may
--                     differ from productos.marca_id (e.g. alternative brand).
--    • subtotal     — Intentionally stored (cantidad × precio_unitario).
--                     Financial audit immutability is an accepted, documented
--                     exception to strict 3NF for monetary records.
-- =============================================================================

CREATE TABLE cotizacion_detalles (
  id               INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  id_cotizacion    INT UNSIGNED   NOT NULL,
  id_producto      INT UNSIGNED   DEFAULT NULL,
  descripcion_item VARCHAR(255)   NOT NULL,
  cantidad         DECIMAL(12,4)  NOT NULL,
  precio_unitario  DECIMAL(15,2)  NOT NULL,
  subtotal         DECIMAL(15,2)  NOT NULL
    COMMENT 'Stored computed value (cantidad × precio_unitario) — immutable for financial audit.',
  codigo_parte     VARCHAR(50)    NULL
    COMMENT 'Manufacturer Part Number — ad-hoc when id_producto is NULL; mirrors productos.codigo when set.',
  codigo_alternativo VARCHAR(100)  NULL
    COMMENT 'Código alternativo del fabricante o código cruzado para la línea — aparece en columna PDF.',
  unidad           VARCHAR(20)    NOT NULL DEFAULT 'UND'
    COMMENT 'Unidad de medida del ítem (UND, KG, M, etc.).',
  tiempo_entrega   VARCHAR(100)   NULL
    COMMENT 'Tiempo de entrega específico para esta línea (ej. 15 DÍAS HÁBILES).',
  marca_id         INT UNSIGNED   NULL
    COMMENT 'FK to marcas.id — NULL means no brand assigned or brand was deleted.',
  -- Multi-quantity rows for the same codigo_parte are fully supported: no
  -- unique constraint on (id_cotizacion, codigo_parte) is intentional — the
  -- business rule (merge identical parts into one row) is enforced client-side.
  PRIMARY KEY (id),
  CONSTRAINT fk_det_cotizacion
    FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones (id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_det_producto
    FOREIGN KEY (id_producto)   REFERENCES productos    (id) ON DELETE SET NULL  ON UPDATE CASCADE,
  CONSTRAINT fk_det_marca
    FOREIGN KEY (marca_id)      REFERENCES marcas        (id) ON DELETE SET NULL  ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 9. AUDITORIA
-- =============================================================================

CREATE TABLE auditoria (
  id_auditoria         INT           NOT NULL AUTO_INCREMENT,
  id_usuario           INT UNSIGNED  NULL,
  tabla_afectada       VARCHAR(50)   NOT NULL,
  accion               VARCHAR(20)   NOT NULL,
  id_registro_afectado INT           NULL,
  detalles             TEXT          NULL,
  ip_cliente           VARCHAR(45)   NOT NULL DEFAULT '0.0.0.0',
  fecha_hora           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_auditoria),
  CONSTRAINT fk_auditoria_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 10. BITACORA_AUDITORIA
-- =============================================================================

CREATE TABLE bitacora_auditoria (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario     INT UNSIGNED    DEFAULT NULL,
  nombre_usuario VARCHAR(50)     DEFAULT NULL,
  accion         VARCHAR(80)     NOT NULL,
  entidad        VARCHAR(50)     DEFAULT NULL,
  id_entidad     INT UNSIGNED    DEFAULT NULL,
  detalle        JSON            DEFAULT NULL,
  ip_origen      VARCHAR(45)     DEFAULT NULL,
  resultado      ENUM('exito','fallo') NOT NULL DEFAULT 'exito',
  creado_en      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_bitacora_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 11. COTIZACION_HISTORIAL_ESTADOS
-- =============================================================================

CREATE TABLE cotizacion_historial_estados (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_cotizacion   INT UNSIGNED NOT NULL,
  estado_anterior VARCHAR(30)  DEFAULT NULL,
  estado_nuevo    VARCHAR(30)  NOT NULL,
  id_usuario      INT UNSIGNED DEFAULT NULL,
  nombre_usuario  VARCHAR(50)  DEFAULT NULL,
  rol_usuario     VARCHAR(30)  DEFAULT NULL,
  observacion     TEXT         DEFAULT NULL,
  ip_origen       VARCHAR(45)  DEFAULT NULL,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_historial_cotizacion
    FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones (id) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT fk_historial_usuario
    FOREIGN KEY (id_usuario)    REFERENCES usuarios      (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- notificaciones — Targeted in-app notifications for the Ejecutivo feed.
--
-- Populated by the backend when the Jefe approves a quotation
-- (estado → 'Aprobada internamente') or marks it 'Enviada al cliente'.
-- The Ejecutivo polling endpoint reads from this table to surface the badge.
--
-- leida = 0 (unread) | 1 (read). The badge count reflects unread rows only.
-- ---------------------------------------------------------------------------
CREATE TABLE notificaciones (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_usuario      INT UNSIGNED NOT NULL,           -- recipient Ejecutivo
  id_cotizacion   INT UNSIGNED NOT NULL,
  tipo            ENUM('correccion','aprobacion','envio_cliente') NOT NULL DEFAULT 'aprobacion',
  mensaje         TEXT         NOT NULL,
  leida           TINYINT(1)   NOT NULL DEFAULT 0,
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_usuario_leida (id_usuario, leida),
  CONSTRAINT fk_notif_usuario
    FOREIGN KEY (id_usuario)    REFERENCES usuarios    (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notif_cotizacion
    FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Sample clients
INSERT INTO clientes (id, razon_social, nit, contacto, email, telefono, activo) VALUES
  (1, 'Importadora San Jose',    '1020304021', 'Juan Perez',    'contacto@sanjose.com', '77012345', 1),
  (2, 'Constructora Santa Cruz', '5060708032', 'Maria Delgado', 'info@santacruz.com',   '33456789', 1);

-- Annual serial-number counter (starts at 0 for the current year)
INSERT INTO cotizaciones_correlativo (anio, ultimo_nro) VALUES (2026, 0);
