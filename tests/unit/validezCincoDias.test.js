/**
 * @jest-environment jsdom
 */
// =============================================================================
// tests/unit/validezCincoDias.test.js
// La validez de la oferta: 5 días calendario desde la emisión, y el PDF dice
// lo mismo en todas sus páginas.
//
// LO QUE SE DECIDIÓ (el Jefe, 2026-09-29)
// La hoja de términos decía 3 días, la página 1 decía la fecha que el
// ejecutivo eligiera (o «15 DÍAS» si no elegía), y en producción ventas daba
// 5 casi siempre. Ahora son 5: la cláusula lo dice, el formulario lo propone y
// la página 1 lo usa cuando no hay fecha.
//
// De paso: la banda de la hoja de términos imprimía las fechas un día antes
// que la página 1 (convertía una fecha sin hora a hora de Bolivia).
//
// QUÉ CUIDA ESTE ARCHIVO
//   1. Que el 5 del formulario, el de la cláusula y el de la página 1 no se
//      separen nunca.
//   2. Que la propuesta del formulario no pise una fecha elegida a mano.
//   3. Que la banda de la hoja de términos imprima el mismo día que la página 1.
// =============================================================================

'use strict';

import {
  DIAS_VALIDEZ, sumarDias, wireValidezPorDefecto,
} from '../../public/js/views/quotationForm/validezPorDefecto.js';

const { docFalso, buscarTexto } = require('../helpers/docFalso');
const { CLAUSULAS, DIAS_VIGENCIA } = require('../../src/services/pdf/terminos');
const { drawTerminosPage } = require('../../src/services/pdf/drawers/terminos');
const { dibujarCondicionesYBanco } = require('../../src/services/pdf/drawers/totals');
const { MARGIN } = require('../../src/services/pdf/constants');

// ---------------------------------------------------------------------------
// 1. Un solo número en los tres lugares
// ---------------------------------------------------------------------------
describe('los 5 días dicen lo mismo en todos lados', () => {
  test('la cláusula, el PDF y el formulario usan el mismo número', () => {
    expect(DIAS_VIGENCIA).toBe(5);
    expect(DIAS_VALIDEZ).toBe(DIAS_VIGENCIA);
  });

  test('la cláusula 1 dice «cinco (5) días calendario desde su emisión»', () => {
    const [titulo, cuerpo] = CLAUSULAS[0];
    expect(titulo).toBe('Vigencia de la Oferta');
    expect(cuerpo).toContain('cinco (5) días calendario desde su emisión');
  });

  test('sin fecha, la página 1 imprime «5 DÍAS CALENDARIO» (antes, 15)', () => {
    const doc = docFalso({
      margenes: { top: MARGIN, bottom: MARGIN + 45, left: MARGIN, right: MARGIN },
    });
    dibujarCondicionesYBanco(doc, { fecha_validez: null, moneda: 'BOB' }, 100, 280);
    expect(buscarTexto(doc, '5 DÍAS CALENDARIO').length).toBeGreaterThan(0);
    expect(buscarTexto(doc, '15 DÍAS CALENDARIO')).toHaveLength(0);
  });

  test('con fecha, la página 1 imprime esa fecha', () => {
    const doc = docFalso({
      margenes: { top: MARGIN, bottom: MARGIN + 45, left: MARGIN, right: MARGIN },
    });
    dibujarCondicionesYBanco(doc, { fecha_validez: '2026-10-04', moneda: 'BOB' }, 100, 280);
    expect(buscarTexto(doc, 'HASTA EL 04/10/2026').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. sumarDias
// ---------------------------------------------------------------------------
describe('sumarDias — cuenta días calendario sin mirar la zona horaria', () => {
  test.each([
    ['2026-09-29', '2026-10-04'],   // cruza de mes
    ['2026-12-29', '2027-01-03'],   // cruza de año
    ['2028-02-26', '2028-03-02'],   // año bisiesto
  ])('%s + 5 → %s', (desde, hasta) => {
    expect(sumarDias(desde, 5)).toBe(hasta);
  });

  test.each([[''], [null], [undefined], ['29/09/2026'], ['no es fecha']])(
    'con %p devuelve vacío', (v) => {
      expect(sumarDias(v, 5)).toBe('');
    });
});

// ---------------------------------------------------------------------------
// 3. El formulario
// ---------------------------------------------------------------------------
function formulario({ emision = '', validez = '', esEdicion = false } = {}) {
  const c = document.createElement('div');
  c.innerHTML = `
    <input type="date" id="fecha_emision" value="${emision}" />
    <input type="date" id="fecha_validez" value="${validez}" />`;
  wireValidezPorDefecto(c, { esEdicion });
  return c;
}

function elegirEmision(c, valor) {
  const e = c.querySelector('#fecha_emision');
  e.value = valor;
  e.dispatchEvent(new Event('change'));
}

const validezDe = (c) => c.querySelector('#fecha_validez').value;

describe('el formulario propone la validez', () => {
  test('al elegir la emisión, la validez queda en emisión + 5', () => {
    const c = formulario();
    elegirEmision(c, '2026-09-29');
    expect(validezDe(c)).toBe('2026-10-04');
  });

  test('si cambia la emisión y la validez era la propuesta, la sigue', () => {
    const c = formulario();
    elegirEmision(c, '2026-09-29');
    elegirEmision(c, '2026-10-01');
    expect(validezDe(c)).toBe('2026-10-06');
  });

  test('una fecha elegida a mano no se pisa', () => {
    const c = formulario();
    elegirEmision(c, '2026-09-29');
    c.querySelector('#fecha_validez').value = '2026-10-15';
    elegirEmision(c, '2026-10-01');
    expect(validezDe(c)).toBe('2026-10-15');
  });

  test('al editar una cotización con validez propia, no se toca', () => {
    const c = formulario({ emision: '2026-09-01', validez: '2026-09-11' });
    expect(validezDe(c)).toBe('2026-09-11');
    elegirEmision(c, '2026-09-02');
    expect(validezDe(c)).toBe('2026-09-11');
  });

  test('al editar una que ya tenía los 5 días, cambiar la emisión la arrastra', () => {
    const c = formulario({ emision: '2026-09-01', validez: '2026-09-06' });
    elegirEmision(c, '2026-09-03');
    expect(validezDe(c)).toBe('2026-09-08');
  });

  test('corregir la emisión con el teclado (pasa por vacío) igual arrastra la validez', () => {
    // Al borrar el día con Backspace, Chrome deja el campo vacío y dispara
    // 'change'. Ese vacío no puede hacer olvidar cuál era la propuesta.
    const c = formulario();
    elegirEmision(c, '2026-09-29');
    elegirEmision(c, '');
    expect(validezDe(c)).toBe('2026-10-04');
    elegirEmision(c, '2026-09-20');
    expect(validezDe(c)).toBe('2026-09-25');
  });

  test('un borrador recuperado con emisión y sin validez la recibe al abrirse', () => {
    expect(validezDe(formulario({ emision: '2026-09-01' }))).toBe('2026-09-06');
  });

  test('una EDICIÓN sin validez no la recibe sola al abrirse', () => {
    // Si no, al guardar cualquier otro cambio se escribiría una validez que
    // nadie eligió (y quizás ya vencida).
    const c = formulario({ emision: '2026-09-01', esEdicion: true });
    expect(validezDe(c)).toBe('');
    elegirEmision(c, '2026-09-02');
    expect(validezDe(c)).toBe('2026-09-07');   // si cambia la emisión, sí
  });

  test('sin emisión, la validez queda vacía', () => {
    expect(validezDe(formulario())).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. La banda de la hoja de términos imprime el día correcto
// ---------------------------------------------------------------------------
describe('la banda de la hoja de términos no corre las fechas un día', () => {
  const dibujar = (fechas) => {
    const doc = docFalso({
      margenes: { top: MARGIN, bottom: MARGIN + 45, left: MARGIN, right: MARGIN },
    });
    drawTerminosPage(doc, {
      numero_correlativo: 'SC-2026/000162',
      cliente_nombre:     'CLIENTE',
      entidad_emisora:    'Roca Importaciones S.R.L.',
      ...fechas,
    });
    return doc;
  };

  test('con fechas como las entrega la base (medianoche UTC)', () => {
    // Así llegan de mysql2 con timezone '+00:00'. El caso real: la página 1
    // decía 27/08 y la banda 26/08.
    const doc = dibujar({
      fecha_emision: new Date('2026-08-27T00:00:00.000Z'),
      fecha_validez: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(buscarTexto(doc, '27/08/2026').length).toBeGreaterThan(0);
    expect(buscarTexto(doc, '01/09/2026').length).toBeGreaterThan(0);
    expect(buscarTexto(doc, '26/08/2026')).toHaveLength(0);
  });

  test('con fechas como texto AAAA-MM-DD', () => {
    const doc = dibujar({ fecha_emision: '2026-09-08', fecha_validez: '2026-09-13' });
    expect(buscarTexto(doc, '08/09/2026').length).toBeGreaterThan(0);
    expect(buscarTexto(doc, '13/09/2026').length).toBeGreaterThan(0);
  });
});
