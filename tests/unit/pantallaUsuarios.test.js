/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/pantallaUsuarios.test.js
// La pantalla "Gestión de usuarios", que Jefe y Administración comparten.
//
// POR QUÉ ESTA PRUEBA SE ESCRIBIÓ ANTES DE TOCAR NADA
// Las dos strategies tenían su propio `_renderUsers`, de ~70 líneas cada uno y
// byte por byte iguales salvo el id del botón de crear. Esa duplicación ya se
// había empezado a pudrir: una pedía un esqueleto de 7 columnas y la otra de 8,
// sobre la misma tabla de 6 — o sea que alguien editó una copia y se olvidó de
// la otra. Se arreglaron las dos el 2026-08-31, pero el problema de fondo es
// que la próxima divergencia puede caer en algo que importe más que un detalle
// visual, como un permiso.
//
// Esta prueba es de CARACTERIZACIÓN: fija lo que las dos pantallas dibujan y
// cablean HOY, para que la unificación posterior tenga que demostrar que no
// cambió nada. Sin ella, unificar dos pantallas sin pruebas es exactamente la
// apuesta que ya salió mal una vez ("tras la refactorización hubo errores en
// la interfaz").
//
// Se invoca el método sobre un objeto mínimo con `call` en vez de construir la
// strategy entera: `_renderUsers` sólo usa `panel` y los cuatro `this._show*`,
// así que armar el dashboard completo sería pedirle a la prueba que dependa de
// medio sistema para verificar una tabla.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  showToast: jest.fn(),
}));

jest.mock('../../public/js/services/authSession.js', () => ({
  __esModule: true,
  default: { getRole: () => 'Jefe', getUser: () => ({ id: 1, rol: 'Jefe' }), getToken: () => 't' },
}));

import api from '../../public/js/services/apiClient.js';
import { AdminStrategy }   from '../../public/js/views/dashboard/strategies/adminStrategy.js';
import { ManagerStrategy } from '../../public/js/views/dashboard/strategies/managerStrategy.js';

const USUARIOS = [
  { id: 1, nombre_completo: 'Ana Pérez',  nombre_usuario: 'ana',  rol: 'Ejecutivo', id_rol: 1, activo: 1, can_approve_quotations: 0 },
  { id: 2, nombre_completo: 'Beto <b>',   nombre_usuario: 'beto', rol: 'Jefe',      id_rol: 3, activo: 0, can_approve_quotations: 1 },
];

/** Objeto mínimo que hace de `this`: sólo los cuatro modales que el método usa. */
function espia() {
  return {
    _showCreateUserModal:   jest.fn(),
    _showEditUserModal:     jest.fn(),
    _confirmDeactivateUser: jest.fn(),
    _confirmActivateUser:   jest.fn(),
  };
}

async function dibujar(Strategy) {
  const panel = document.createElement('div');
  document.body.appendChild(panel);
  const ctx = espia();
  await Strategy.prototype._renderUsers.call(ctx, panel);
  return { panel, ctx };
}

describe('pantalla de usuarios — lo que dibujan Jefe y Administración', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    api.get.mockResolvedValue({ data: USUARIOS });
  });

  test.each([
    ['Administración', AdminStrategy,   'btn-create-user-admin'],
    ['Jefe',           ManagerStrategy, 'btn-create-user'],
  ])('%s: tabla de 6 columnas, una fila por usuario y su botón de crear', async (_rol, Strategy, botonId) => {
    const { panel } = await dibujar(Strategy);

    expect(panel.querySelectorAll('thead th')).toHaveLength(6);
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(USUARIOS.length);
    expect(panel.querySelector(`#${botonId}`)).not.toBeNull();
  });

  test.each([
    ['Administración', AdminStrategy],
    ['Jefe',           ManagerStrategy],
  ])('%s: el usuario activo ofrece Desactivar y el inactivo, Activar', async (_rol, Strategy) => {
    const { panel } = await dibujar(Strategy);

    // Ana está activa (id 1), Beto no (id 2).
    expect(panel.querySelector('[data-user-deact="1"]')).not.toBeNull();
    expect(panel.querySelector('[data-user-act="1"]')).toBeNull();
    expect(panel.querySelector('[data-user-act="2"]')).not.toBeNull();
    expect(panel.querySelector('[data-user-deact="2"]')).toBeNull();
  });

  test.each([
    ['Administración', AdminStrategy],
    ['Jefe',           ManagerStrategy],
  ])('%s: los cuatro botones quedan cableados a su modal', async (_rol, Strategy) => {
    const { panel, ctx } = await dibujar(Strategy);

    panel.querySelector('[data-user-edit="1"]').click();
    expect(ctx._showEditUserModal).toHaveBeenCalledWith('1', 'Ana Pérez', '1', '0');

    panel.querySelector('[data-user-deact="1"]').click();
    expect(ctx._confirmDeactivateUser).toHaveBeenCalledWith('1', 'ana');

    panel.querySelector('[data-user-act="2"]').click();
    expect(ctx._confirmActivateUser).toHaveBeenCalledWith('2', 'beto');

    panel.querySelector('button[id^="btn-create-user"]').click();
    expect(ctx._showCreateUserModal).toHaveBeenCalled();
  });

  test.each([
    ['Administración', AdminStrategy],
    ['Jefe',           ManagerStrategy],
  ])('%s: escapa el HTML que viene del servidor', async (_rol, Strategy) => {
    const { panel } = await dibujar(Strategy);
    // "Beto <b>" no debe crear un <b> real dentro de la tabla.
    expect(panel.querySelector('tbody b')).toBeNull();
    expect(panel.textContent).toContain('Beto <b>');
  });

  test.each([
    ['Administración', AdminStrategy],
    ['Jefe',           ManagerStrategy],
  ])('%s: si la carga falla muestra el error y no una tabla vacía', async (_rol, Strategy) => {
    api.get.mockRejectedValue(new Error('sin conexión'));
    const { panel } = await dibujar(Strategy);

    expect(panel.querySelector('table')).toBeNull();
    expect(panel.textContent).toContain('sin conexión');
  });

  // ── El punto de todo esto ────────────────────────────────────────────────
  test('las dos pantallas son IDÉNTICAS salvo el id del botón de crear', async () => {
    const { panel: pAdmin }   = await dibujar(AdminStrategy);
    const { panel: pManager } = await dibujar(ManagerStrategy);

    // Se normalizan dos cosas y sólo dos: el id que legítimamente difiere, y el
    // espacio ENTRE etiquetas (las dos plantillas escriben el <thead> con
    // distinto sangrado — una pone los seis <th> en una línea y la otra en dos.
    // El navegador no dibuja distinto por eso). Todo lo demás tiene que
    // coincidir carácter por carácter: si mañana alguien toca una sola de las
    // dos copias, esto se pone en rojo.
    const normalizar = (html) => html
      .replace(/btn-create-user-admin/g, 'btn-create-user')
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .trim();

    expect(normalizar(pAdmin.innerHTML)).toBe(normalizar(pManager.innerHTML));
  });
});
