/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/pantallaConsumo.test.js
// El reporte «Consumo por ítem», dibujado y con sus controles apretados.
//
// POR QUÉ EXISTE
// El 2026-09-15 cambiaron dos cosas de esta pantalla a la vez:
//   1. abre con los últimos 12 meses en lugar de todo el historial (decisión de
//      Adrian tras la prueba de rendimiento: el historial completo pasaba del
//      minuto con años de datos);
//   2. el cableado de los controles salió a su propia función para no pasar el
//      tope de largo de funciones.
// La segunda es exactamente el tipo de extracción que ya rompió la interfaz una
// vez en este proyecto sin que ninguna prueba se enterara: el HTML queda igual
// y un botón deja de hacer algo. No había ninguna prueba de esta pantalla.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  showToast: jest.fn(),
}));

import api from '../../public/js/services/apiClient.js';
import { mountClienteItemReport } from '../../public/js/views/dashboard/modules/clienteItemReport.js';
import { ultimos12Meses } from '../../public/js/shared/fechaLocal.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const RESPUESTA = {
  success: true, agrupar: 'item', ejecutivos: [],
  data: [{ codigo: 'ZZ-500', marca_nombre: null, descripcion: 'Buje', unidad: 'PZA', cantidad_total: 3, clientes: 1, cotizaciones: 1, ultima_vez: '2026-09-01', sin_codigo: 0 }],
  pagination: { page: 1, limit: 50, totalRecords: 1, totalPages: 1, hasNext: false, hasPrev: false },
};

/** Los parámetros de la última consulta que hizo la pantalla. */
const ultimaConsulta = () => new URL(api.get.mock.calls.at(-1)[0], 'http://x').searchParams;

let panel, destruir;

beforeEach(async () => {
  document.body.innerHTML = '<div id="panel"></div>';
  panel = document.getElementById('panel');
  jest.clearAllMocks();
  api.get.mockResolvedValue(RESPUESTA);
  destruir = await mountClienteItemReport(panel);
});

afterEach(() => destruir?.());

describe('pantalla de consumo — rango inicial', () => {
  test('abre con los últimos 12 meses, visibles en los campos de fecha', () => {
    const [desde, hasta] = ultimos12Meses();

    expect(panel.querySelector('#ci-desde').value).toBe(desde);
    expect(panel.querySelector('#ci-hasta').value).toBe(hasta);
  });

  test('la primera consulta ya lleva ese rango, no pide todo el historial', () => {
    const [desde, hasta] = ultimos12Meses();
    const q = ultimaConsulta();

    expect(q.get('fecha_desde')).toBe(desde);
    expect(q.get('fecha_hasta')).toBe(hasta);
    expect(q.get('agrupar')).toBe('item');
  });

  test('la nota avisa cómo ver el historial completo', () => {
    expect(panel.querySelector('#ci-nota').textContent).toContain('vaciá las dos fechas');
  });
});

describe('pantalla de consumo — controles', () => {
  test('vaciar las fechas y aplicar pide todo el historial', async () => {
    panel.querySelector('#ci-desde').value = '';
    panel.querySelector('#ci-hasta').value = '';
    panel.querySelector('#ci-apply').click();
    await tick();

    const q = ultimaConsulta();
    expect(q.has('fecha_desde')).toBe(false);
    expect(q.has('fecha_hasta')).toBe(false);
  });

  test('«Limpiar» vuelve al rango de 12 meses y borra los demás filtros', async () => {
    panel.querySelector('#ci-desde').value = '2020-01-01';
    panel.querySelector('#ci-q').value = 'filtro';
    panel.querySelector('#ci-clear').click();
    await tick();

    const [desde, hasta] = ultimos12Meses();
    const q = ultimaConsulta();
    expect(q.get('fecha_desde')).toBe(desde);
    expect(q.get('fecha_hasta')).toBe(hasta);
    expect(q.has('q')).toBe(false);
  });

  test('la pestaña «Detalle por ejecutivo» cambia la vista y conserva el rango', async () => {
    panel.querySelector('#ci-vistas [data-vista="detalle"]').click();
    await tick();

    const q = ultimaConsulta();
    expect(q.get('agrupar')).toBe('detalle');
    expect(q.get('fecha_desde')).toBe(ultimos12Meses()[0]);
  });

  test('buscar con Enter aplica el texto', async () => {
    const campo = panel.querySelector('#ci-q');
    campo.value = 'ZZ-500';
    campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await tick();

    expect(ultimaConsulta().get('q')).toBe('ZZ-500');
  });

  test('cambiar el estado vuelve a consultar con ese estado', async () => {
    const estado = panel.querySelector('#ci-estado');
    estado.value = 'Confirmada';
    estado.dispatchEvent(new Event('change'));
    await tick();

    expect(ultimaConsulta().get('estado')).toBe('Confirmada');
  });
});
