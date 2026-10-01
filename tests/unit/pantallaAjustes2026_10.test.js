/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/pantallaAjustes2026_10.test.js
// Tres arreglos de pantalla del recorrido rol por rol (decididos por Adrian el
// 2026-10-01), montados en un DOM real:
//
//   1. El diálogo «Aprobar» del Jefe mostraba «#<id interno>» y prometía que
//      «se generará el número oficial de correlativo» — falso, el correlativo
//      existe desde que se crea la cotización. Ahora muestra el correlativo.
//   2. La lista del ejecutivo no tenía filtro de fechas. Ahora tiene Desde/Hasta.
//   3. La campana del Jefe tiene una sección «Ventas por confirmar».
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn() },
  showToast: jest.fn(),
}));

// El modal real arma su propio esqueleto en el documento; acá basta con que
// le pase el cuerpo a quien lo abre, para poder mirar lo que dibujó.
jest.mock('../../public/js/views/dashboard/modalUI.js', () => {
  const UI = {
    titulo: null,
    openModal: jest.fn((titulo, fn) => {
      UI.titulo = titulo;
      globalThis.document.body.innerHTML = '<div id="cuerpo"></div>';
      fn(globalThis.document.getElementById('cuerpo'));
    }),
    closeModal: jest.fn(),
    requestClose: jest.fn(),
  };
  return { __esModule: true, UI };
});

import api, { showToast } from '../../public/js/services/apiClient.js';
import { UI } from '../../public/js/views/dashboard/modalUI.js';
import { ManagerStrategy }   from '../../public/js/views/dashboard/strategies/managerStrategy.js';
import { ExecutiveStrategy } from '../../public/js/views/dashboard/strategies/executiveStrategy.js';
import { refreshNotifBadge } from '../../public/js/views/dashboard/modules/notificationsView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
describe('1. diálogo de aprobar del Jefe', () => {
  const q = { id: 245, numero_correlativo: 'SC-2026/000198', cliente_nombre: 'Minera del Sur' };

  test('muestra el correlativo y el cliente, no el número interno', () => {
    new ManagerStrategy({ id: 1, rol: 'Jefe' })._showApproveDialog(245, true, q);

    const texto = document.getElementById('cuerpo').textContent;
    expect(texto).toContain('SC-2026/000198');
    expect(texto).toContain('Minera del Sur');
    expect(texto).not.toContain('#245');
  });

  test('ya no promete generar un correlativo', () => {
    new ManagerStrategy({ id: 1, rol: 'Jefe' })._showApproveDialog(245, true, q);

    expect(document.getElementById('cuerpo').textContent.toLowerCase()).not.toContain('correlativo');
  });

  test('el de rechazar también muestra el correlativo', () => {
    new ManagerStrategy({ id: 1, rol: 'Jefe' })._showApproveDialog(245, false, q);

    expect(document.getElementById('cuerpo').textContent).toContain('SC-2026/000198');
  });

  test('sin la cotización a mano, cae al número interno en vez de romperse', () => {
    new ManagerStrategy({ id: 1, rol: 'Jefe' })._showApproveDialog(245, true);

    expect(document.getElementById('cuerpo').textContent).toContain('#245');
  });
});

// ---------------------------------------------------------------------------
describe('2. filtro de fechas en la lista del ejecutivo', () => {
  const vacio = { success: true, total: 0, data: [],
    pagination: { page: 1, limit: 25, totalRecords: 0, totalPages: 1, hasNext: false, hasPrev: false } };

  /** Monta el tablero del ejecutivo y devuelve solo los pedidos al listado. */
  async function montar() {
    api.get.mockResolvedValue(vacio);
    document.body.innerHTML = '<div id="app"></div>';
    const estrategia = new ExecutiveStrategy({ id: 7, rol: 'Ejecutivo' });
    await estrategia.render(document.getElementById('app'));
    await tick();
    return estrategia;
  }
  const pedidosAlListado = () => api.get.mock.calls
    .map(([url]) => url)
    .filter((url) => /^\/api\/cotizaciones\?/.test(url));

  test('dibuja los dos campos de fecha', async () => {
    await montar();

    expect(document.getElementById('filter-desde').type).toBe('date');
    expect(document.getElementById('filter-hasta').type).toBe('date');
  });

  test('al elegir un rango, las dos solapas lo piden al servidor', async () => {
    await montar();
    api.get.mockClear();

    document.getElementById('filter-desde').value = '2026-09-01';
    document.getElementById('filter-hasta').value = '2026-09-30';
    document.getElementById('filter-hasta').dispatchEvent(new Event('change'));
    await tick();

    const pedidos = pedidosAlListado();
    expect(pedidos).toHaveLength(2);   // «Mis cotizaciones» y el conteo de «Equipo»
    for (const url of pedidos) {
      expect(url).toContain('fecha_desde=2026-09-01');
      expect(url).toContain('fecha_hasta=2026-09-30');
    }
  });

  test('sin fechas no manda los parámetros', async () => {
    await montar();

    for (const url of pedidosAlListado()) expect(url).not.toContain('fecha_');
  });

  test('un rango al revés avisa y no consulta', async () => {
    await montar();
    api.get.mockClear();

    document.getElementById('filter-desde').value = '2026-09-30';
    document.getElementById('filter-hasta').value = '2026-09-01';
    document.getElementById('filter-hasta').dispatchEvent(new Event('change'));
    await tick();

    expect(pedidosAlListado()).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Desde'), 'warning');
  });
});

// ---------------------------------------------------------------------------
describe('3. la campana del Jefe', () => {
  test('agrupa los avisos bajo «Ventas por confirmar» y no ofrece «marcar como leídas»', async () => {
    document.body.innerHTML = `
      <button id="btn-notificaciones" class="hidden"><span id="notif-count"></span></button>`;
    api.get.mockResolvedValue({
      success: true, total: 1,
      data: [{
        tipo: 'venta_por_confirmar', id_cotizacion: 3,
        numero_correlativo: 'SC-2026/000201', cliente_nombre: 'Minera del Sur',
        observacion: 'Juan anotó «Venta concretada» en el seguimiento. Falta confirmar la venta.',
        fecha_solicitud: '2026-10-01T14:00:00',
      }],
    });

    await refreshNotifBadge(UI);
    const boton = document.getElementById('btn-notificaciones');
    expect(boton.classList.contains('hidden')).toBe(false);

    boton.click();
    await tick();

    const texto = document.getElementById('cuerpo').textContent;
    expect(texto).toContain('Ventas por confirmar');
    expect(texto).toContain('SC-2026/000201');
    expect(texto).toContain('Falta confirmar la venta');
    // Se borra sola cuando el Jefe confirma: no hay nada que marcar.
    expect(document.getElementById('btn-marcar-leidas')).toBeNull();
  });
});
