-- =============================================================================
-- Migration: Add 'En espera' state to cotizaciones ENUM
-- Run this against an EXISTING database where init.sql was already applied.
-- Safe to run multiple times (ALTER TABLE only changes the column definition).
-- =============================================================================

USE rc_tractoparts;

ALTER TABLE cotizaciones
  MODIFY COLUMN estado
    ENUM(
      'Pendiente',
      'En revision',
      'En espera',
      'Aprobada internamente',
      'Enviada al cliente',
      'Aceptada',
      'Rechazada',
      'Archivada'
    ) NOT NULL DEFAULT 'Pendiente';
