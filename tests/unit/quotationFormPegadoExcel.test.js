/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/quotationFormPegadoExcel.test.js
// El pegado desde Excel de punta a punta, con el formulario de verdad montado.
//
// POR QUÉ EXISTE
// Las piezas del pegado tienen cada una su test (excelPaste, marcasParecidas,
// revisionImportacion), pero ninguno probaba que estuvieran BIEN CONECTADAS
// dentro del formulario: que la marca resuelta llegue al selector de la fila,
// que el tiempo de entrega llegue a su campo, que la ventana de revisión
// cambie la fila correcta. El 2026-09-11 Adrian probó el pegado en producción
// y «no pasaba» — resultó ser el caché de Cloudflare sirviendo el código
// viejo, pero hasta descartarlo no había cómo saber si el problema estaba en
// esta conexión. Este test la cubre.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => {
  const api = { get: jest.fn(), post: jest.fn(), put: jest.fn(), upload: jest.fn() };
  return { __esModule: true, default: api, showToast: jest.fn() };
});

jest.mock('../../public/js/services/socketClient.js', () => ({
  __esModule: true,
  connectSocket: jest.fn(),
}));

jest.mock('../../public/js/views/dashboard/modules/clientModal.js', () => ({
  __esModule: true,
  openClienteModal: jest.fn(),
}));

import api from '../../public/js/services/apiClient.js';
import { connectSocket } from '../../public/js/services/socketClient.js';
import { mountQuotationForm } from '../../public/js/views/quotationForm.js';

const MARCAS = [
  { id: 11, nombre: 'CAT' },
  { id: 1,  nombre: 'Caterpillar' },
  { id: 2,  nombre: 'Komatsu' },
];

// La planilla de la empresa, tal como la mandó Adrian (con el encabezado
// «PRECIO TOTAL» partido en dos líneas dentro de la celda).
const PLANILLA = [
  'ITEM\tCÓDIGO\tCODIGO ALTERNATIVO\tMARCA\tDESCRIPCION \tCANT.\tUNI\tPRECIO UNITARIO\t"PRECIO ',
  'TOTAL"\tTIEMPO DE ENTREGA',
  '1\t8M-4987\t\tCATERPILLAR\tANILLO D/GOMA\t1\tUN\t1.00\t1.00 \t15 DIAS CALENDARIO / ORIGINAL',
  '2\t122-7352\t\tCAT\tASIENTO D/V \t24\tUN\t15.00\t360.00 \t15 DIAS CALENDARIO / ORIGINAL',
  '3\t6N-6444\t\tCATERPILLER\tELEMENTO \t1\tUN\t35.00\t35.00 \t20 DIAS',
  'TOTAL USD\t\t\t\t\t\t\t\t396.00 \t',
].join('\n');

/** Deja correr la cola de tareas pendientes, varias vueltas (jsdom no trae setImmediate). */
async function flush(vueltas = 5) {
  for (let i = 0; i < vueltas; i++) await new Promise((r) => setTimeout(r, 0));
}

let container;

beforeEach(async () => {
  jest.clearAllMocks();
  localStorage.clear();
  connectSocket.mockResolvedValue({
    on() {}, emit() {}, disconnect() {}, timeout() { return this; }, connected: false,
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  api.get.mockImplementation((url) => {
    if (url.includes('/api/marcas'))       return Promise.resolve({ data: MARCAS });
    if (url.includes('next-correlativo')) return Promise.resolve({ data: { numero_correlativo: 'SC-2026/000001' } });
    return Promise.resolve({ data: [] });
  });

  document.body.innerHTML = '<div id="modal-body"></div>';
  container = document.getElementById('modal-body');
  mountQuotationForm(container, {});
  await flush();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pegar(texto) {
  container.querySelector('#btn-pegar-excel').click();
  document.querySelector('#excel-paste-textarea').value = texto;
  document.querySelector('#excel-paste-importar').click();
}

const filas   = () => [...container.querySelectorAll('#items-body tr')];
const campo   = (fila, nombre) => fila.querySelector(`[data-field="${nombre}"]`).value;

describe('pegar la planilla real en el formulario montado', () => {
  test('entran los 3 repuestos, reemplazando la fila en blanco inicial', () => {
    expect(filas()).toHaveLength(1);        // la fila en blanco con la que arranca
    pegar(PLANILLA);
    expect(filas()).toHaveLength(3);
  });

  test('cada fila queda con la marca QUE ESCRIBIÓ el vendedor', () => {
    pegar(PLANILLA);
    const [a, b, c] = filas();
    expect(campo(a, 'marca_id')).toBe('1');   // CATERPILLAR -> Caterpillar
    expect(campo(b, 'marca_id')).toBe('11');  // CAT -> CAT, no Caterpillar
    expect(campo(c, 'marca_id')).toBe('');    // CATERPILLER: no existe, se decide en la revisión
  });

  test('el código, la descripción y el tiempo de entrega llegan a sus campos', () => {
    pegar(PLANILLA);
    const [a, , c] = filas();
    expect(campo(a, 'codigo')).toBe('8M-4987');
    expect(campo(a, 'descripcion_item')).toBe('ANILLO D/GOMA');
    expect(campo(a, 'tiempo_entrega')).toBe('15 DIAS CALENDARIO / ORIGINAL');
    expect(campo(c, 'tiempo_entrega')).toBe('20 DIAS');
  });

  test('la marca desconocida abre la revisión, y «Usar» cambia SU fila', () => {
    pegar(PLANILLA);

    const revision = [...document.querySelectorAll('.sub-modal-overlay')]
      .find((o) => o.textContent.includes('Revisar lo importado'));
    expect(revision).toBeDefined();
    expect(revision.textContent).toContain('CATERPILLER');

    revision.querySelector('[data-usar="0"]').click();

    const [a, b, c] = filas();
    expect(campo(c, 'marca_id')).toBe('1');
    // Las otras dos no se tocan.
    expect(campo(a, 'marca_id')).toBe('1');
    expect(campo(b, 'marca_id')).toBe('11');
  });

  test('si todas las marcas se reconocen, no aparece ninguna ventana de revisión', () => {
    pegar(PLANILLA.replace('CATERPILLER', 'Komatsu'));
    const revision = [...document.querySelectorAll('.sub-modal-overlay')]
      .find((o) => o.textContent.includes('Revisar lo importado'));
    expect(revision).toBeUndefined();
    expect(campo(filas()[2], 'marca_id')).toBe('2');
  });
});
