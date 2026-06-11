-- =============================================================================
-- RC Tractoparts — Quotation Management System
-- Base de Datos Sincronizada y Corregida (Estructura + Semillas)
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP DATABASE IF EXISTS rc_tractoparts;
CREATE DATABASE rc_tractoparts;
USE rc_tractoparts;

-- 1. ROLES
CREATE TABLE roles (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre      VARCHAR(30)      NOT NULL,
  descripcion VARCHAR(120)     DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (id, nombre, descripcion) VALUES
  (1, 'Ejecutivo',       'Sales executive; registers quotations and uploads PDFs'),
  (2, 'Administracion',  'Administrative staff; manages clients and reviews records'),
  (3, 'Jefe',            'Department head; approves quotations and manages users'),
  (4, 'SysAdmin',        'Systems administrator; absolute system-wide authority over all entities');

-- 2. USUARIOS
CREATE TABLE usuarios (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nombre_completo  VARCHAR(100)  NOT NULL,
  nombre_usuario   VARCHAR(50)   NOT NULL,
  password_hash    VARCHAR(255)  NOT NULL,
  id_rol           TINYINT UNSIGNED NOT NULL,
  activo           TINYINT(1)    NOT NULL DEFAULT 1,
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta  DATETIME      DEFAULT NULL,
  ultimo_acceso    DATETIME      DEFAULT NULL,
  creado_en        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_nombre_usuario (nombre_usuario),
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (id_rol) REFERENCES roles (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. CLIENTES
CREATE TABLE clientes (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  razon_social VARCHAR(150)  NOT NULL,
  nit          VARCHAR(20)   DEFAULT NULL,
  contacto     VARCHAR(100)  DEFAULT NULL,
  email        VARCHAR(120)  DEFAULT NULL,
  telefono     VARCHAR(30)   DEFAULT NULL,
  activo       TINYINT(1)    NOT NULL DEFAULT 1,
  creado_en    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clientes_nit (nit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. PRODUCTOS
CREATE TABLE productos (
  id                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  codigo            VARCHAR(50)    NOT NULL,
  descripcion       VARCHAR(255)   NOT NULL,
  unidad            VARCHAR(20)    DEFAULT 'UND',
  precio_referencia DECIMAL(15,2) DEFAULT NULL,
  marca             VARCHAR(80)    DEFAULT NULL,
  activo            TINYINT(1)     NOT NULL DEFAULT 1,
  creado_en         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_productos_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. COTIZACIONES_CORRELATIVO
CREATE TABLE cotizaciones_correlativo (
  anio       YEAR         NOT NULL,
  ultimo_nro INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. COTIZACIONES
CREATE TABLE cotizaciones (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  numero_correlativo VARCHAR(20)   NOT NULL,
  id_cliente         INT UNSIGNED  NOT NULL,
  id_ejecutivo       INT UNSIGNED  NOT NULL,
  descripcion        TEXT          NOT NULL,
  monto_total        DECIMAL(15,2) DEFAULT NULL,
  moneda             CHAR(3)       NOT NULL DEFAULT 'USD',
  estado             ENUM('Pendiente', 'En revision', 'En espera', 'Aprobada internamente', 'Enviada al cliente', 'Aceptada', 'Rechazada', 'Archivada') NOT NULL DEFAULT 'Pendiente',
  pdf_ruta           VARCHAR(500)  DEFAULT NULL,
  observaciones      TEXT          DEFAULT NULL,
  fecha_emision      DATE          NOT NULL,
  fecha_validez      DATE          DEFAULT NULL,
  aprobado_por       INT UNSIGNED  DEFAULT NULL,
  fecha_aprobacion   DATETIME      DEFAULT NULL,
  obs_aprobacion     TEXT          DEFAULT NULL,
  comentarios_admin  TEXT          DEFAULT NULL COMMENT 'Supervisor review comment written by Administracion role',
  creado_en          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cotizaciones_correlativo (numero_correlativo),
  CONSTRAINT fk_cot_cliente   FOREIGN KEY (id_cliente)   REFERENCES clientes (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cot_ejecutivo FOREIGN KEY (id_ejecutivo) REFERENCES usuarios (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_cot_aprobador FOREIGN KEY (aprobado_por) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. COTIZACION_DETALLES
CREATE TABLE cotizacion_detalles (
  id                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  id_cotizacion     INT UNSIGNED   NOT NULL,
  id_producto       INT UNSIGNED   DEFAULT NULL,
  descripcion_item VARCHAR(255)   NOT NULL,
  cantidad          DECIMAL(12,4)  NOT NULL,
  precio_unitario   DECIMAL(15,2)  NOT NULL,
  subtotal          DECIMAL(15,2)  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_det_cotizacion FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_det_producto   FOREIGN KEY (id_producto)   REFERENCES productos (id)   ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. AUDITORIA (💡 Aquí añadimos INT UNSIGNED para solucionar el Error 3780)
CREATE TABLE auditoria (
  id_auditoria          INT            NOT NULL AUTO_INCREMENT,
  id_usuario            INT UNSIGNED   NULL, 
  tabla_afectada        VARCHAR(50)    NOT NULL,
  accion                VARCHAR(20)    NOT NULL,
  id_registro_afectado  INT            NULL,
  detalles              TEXT           NULL,
  ip_cliente            VARCHAR(45)    NOT NULL DEFAULT '0.0.0.0',
  fecha_hora            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_auditoria),
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. BITACORA_AUDITORIA
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
  CONSTRAINT fk_bitacora_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. COTIZACION_HISTORIAL_ESTADOS
CREATE TABLE cotizacion_historial_estados (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  id_cotizacion    INT UNSIGNED  NOT NULL,
  estado_anterior  VARCHAR(30)   DEFAULT NULL,
  estado_nuevo     VARCHAR(30)   NOT NULL,
  id_usuario       INT UNSIGNED  DEFAULT NULL,
  nombre_usuario   VARCHAR(50)   DEFAULT NULL,
  rol_usuario      VARCHAR(30)   DEFAULT NULL,
  observacion      TEXT          DEFAULT NULL,
  ip_origen        VARCHAR(45)   DEFAULT NULL,
  creado_en        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_historial_cotizacion FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_historial_usuario    FOREIGN KEY (id_usuario)    REFERENCES usuarios (id)    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- SEMILLERO DE DATOS (Sincronizado con las columnas nuevas)
-- =============================================================================

-- Inserción de Usuarios de Prueba
INSERT INTO usuarios (id, nombre_completo, nombre_usuario, password_hash, id_rol) VALUES
(1, 'Carlos Ejecutivo', 'ejecutivo1', '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 1),
(2, 'Adrian Jefe', 'jefe1', '$2b$10$uN8G6c6K7pYhR6D3e8G6Ou7Bv4K3M2v1A4R5t6Y7u8I9o0P1q2W3e', 3);

-- Inserción de Clientes (💡 Corregido a 'razon_social' para solucionar el Error 1054)
INSERT INTO clientes (id, razon_social, nit, contacto, email, telefono, activo) VALUES
(1, 'Importadora San José', '1020304021', 'Juan Pérez', 'contacto@sanjose.com', '77012345', 1),
(2, 'Constructora Santa Cruz', '5060708032', 'María Delgado', 'info@santacruz.com', '33456789', 1);

-- Inicialización del Correlativo Anual
INSERT INTO cotizaciones_correlativo (anio, ultimo_nro) VALUES (2026, 0);