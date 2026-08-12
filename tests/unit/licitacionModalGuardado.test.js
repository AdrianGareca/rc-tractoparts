// =============================================================================
// tests/unit/licitacionModalGuardado.test.js
// Lo que el formulario de licitación manda al servidor.
//
// POR QUÉ ESTE ARCHIVO EXISTE RECIÉN AHORA
// Esta validación vivía adentro de openLicitacionModal, entre el armado del
// HTML y el cableado de eventos. No era probable: para ejercitarla había que
// montar el modal entero en un DOM y simular un submit. Al partir la función se
// convirtió en `leerCabecera($)`, que recibe un buscador de elementos y
// devuelve un objeto — y eso sí se prueba en tres líneas.
//
// Es la diferencia práctica entre una función de 269 líneas y cuatro de sesenta:
// no es estética, es que las reglas quedan al alcance de una prueba.
//
// QUÉ SE PROTEGE
// Dos decisiones que se ven en el PDF y en los reportes:
//   • el convocante sale del campo OCULTO, no de lo que se tipeó
//   • un presupuesto vacío es null, no cero
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), upload: jest.fn() },
  showToast: jest.fn(),
}));

import { leerCabecera } from '../../public/js/views/dashboard/modules/licitacion/modalGuardado.js';

/**
 * Un buscador de elementos falso: devuelve `{ value }` para cada selector.
 * Es todo lo que leerCabecera usa del DOM.
 */
const buscador = (valores) => (sel) => ({ value: valores[sel] ?? '' });

const COMPLETO = {
  '#lic-nombre':       '  Provisión de repuestos flota municipal 2026  ',
  '#lic-id-cliente':   '42',
  '#lic-descripcion':  '  Repuestos de tren de rodaje  ',
  '#lic-presupuesto':  '150000.50',
  '#lic-moneda':       'USD',
  '#lic-fecha-limite': '2026-09-30',
};

// ---------------------------------------------------------------------------
describe('un formulario completo', () => {
  test('arma el envío con los campos limpios', () => {
    const { payload, error } = leerCabecera(buscador(COMPLETO));

    expect(error).toBeNull();
    expect(payload).toEqual({
      nombre:                  'Provisión de repuestos flota municipal 2026',
      id_cliente:              42,
      descripcion:             'Repuestos de tren de rodaje',
      presupuesto_referencial: 150000.50,
      moneda:                  'USD',
      fecha_limite:            '2026-09-30',
    });
  });

  test('el id del convocante viaja como número, no como texto', () => {
    // El servidor lo valida con Zod esperando un entero. Un '42' con comillas
    // lo rechaza y el modal muestra un error de validación que la persona no
    // puede corregir: eligió bien la entidad.
    const { payload } = leerCabecera(buscador(COMPLETO));
    expect(typeof payload.id_cliente).toBe('number');
  });
});

// ---------------------------------------------------------------------------
describe('lo que se rechaza antes de salir a la red', () => {
  test('sin nombre no se guarda', () => {
    const { payload, error } = leerCabecera(buscador({ ...COMPLETO, '#lic-nombre': '   ' }));
    expect(payload).toBeNull();
    expect(error).toMatch(/nombre/i);
  });

  test('escribir el convocante sin elegirlo de la lista no alcanza', () => {
    // El caso real: se tipea «Gobierno Municipal…», aparece el desplegable, y
    // se sigue de largo al campo siguiente sin hacer clic. El campo de texto
    // muestra algo; el oculto está vacío. Antes esto llegaba al servidor con un
    // NaN y volvía como un error genérico de validación.
    const { payload, error } = leerCabecera(buscador({ ...COMPLETO, '#lic-id-cliente': '' }));

    expect(payload).toBeNull();
    expect(error).toMatch(/lista/i);
  });

  test('un id que no es número tampoco pasa', () => {
    const { payload, error } = leerCabecera(buscador({ ...COMPLETO, '#lic-id-cliente': 'abc' }));
    expect(payload).toBeNull();
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('los campos opcionales distinguen vacío de cero', () => {
  test('sin presupuesto manda null, no 0', () => {
    // «No se cargó presupuesto» y «el presupuesto es cero» son cosas distintas.
    // Con 0 la licitación aparecería en los reportes como que tiene un techo de
    // cero bolivianos, y cualquier cotización la pasaría.
    const { payload } = leerCabecera(buscador({ ...COMPLETO, '#lic-presupuesto': '   ' }));
    expect(payload.presupuesto_referencial).toBeNull();
  });

  test('un presupuesto de cero sí se guarda como cero', () => {
    const { payload } = leerCabecera(buscador({ ...COMPLETO, '#lic-presupuesto': '0' }));
    expect(payload.presupuesto_referencial).toBe(0);
  });

  test('sin descripción ni fecha límite manda null', () => {
    const { payload } = leerCabecera(buscador({
      ...COMPLETO, '#lic-descripcion': '  ', '#lic-fecha-limite': '',
    }));
    expect(payload.descripcion).toBeNull();
    expect(payload.fecha_limite).toBeNull();
  });
});
