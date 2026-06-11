-- =============================================================================
-- Migration: Add SysAdmin Role
-- Description: Adds the SysAdmin role (id=4) with absolute system-wide authority.
--              Run once against rc_tractoparts if the database already exists
--              from a previous init.sql execution.
-- =============================================================================

USE rc_tractoparts;

INSERT IGNORE INTO roles (id, nombre, descripcion)
VALUES (4, 'SysAdmin', 'Systems administrator; absolute system-wide authority over all entities');
