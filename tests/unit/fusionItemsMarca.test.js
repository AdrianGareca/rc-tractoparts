// =============================================================================
// tests/unit/fusionItemsMarca.test.js
// Dos ítems con el mismo código y distinta marca NO se pueden fusionar.
//
// EL BUG REPORTADO DESDE VENTAS
// «Sobre mismos códigos de ítems pero diferente marca se borra.»
//
// LA CAUSA, QUE ES DE MOMENTO Y NO DE COMPARACIÓN
// La fusión se dispara al SALIR del campo Código (`blur` de .item-codigo). El
// orden natural de carga es: descripción → código → marca. Así que cuando el
// usuario sale del código de la segunda fila, TODAVÍA no eligió su marca: las
// dos filas tienen `marca_id: null`.
//
// La clave compuesta las ve idénticas, las fusiona, y borra la fila — junto con
// la marca que el usuario estaba por elegir. El aviso dice «ya existe con la
// misma marca», que es falso: ninguna de las dos tenía marca todavía.
//
// POR QUÉ IMPORTA EN ESTE NEGOCIO
// En repuestos de maquinaria pesada el MISMO número de parte pertenece a marcas
// distintas — CAT y CUMMINS comparten numeración. Fusionarlas no es un detalle
// de interfaz: es cotizar una pieza que el cliente no pidió, o comprar la
// equivocada. El propio código lo dice en su comentario y aun así lo hacía.
//
// LA DECISIÓN QUE CAMBIA
// Antes: «null === null es intencional, dos filas sin marca con el mismo código
// sí se fusionan.» Ahora no, y la asimetría del costo es el argumento:
//
//   • No fusionar dos filas que SÍ eran duplicadas → el usuario ve dos
//     renglones y los junta a mano. Molesta.
//   • Fusionar dos filas que iban a tener marcas distintas → se BORRA una fila
//     y el dato se pierde, muchas veces sin que nadie lo note.
//
// Una marca vacía no significa «sin marca»: significa «todavía no la eligió».
// Adivinar sobre una clave incompleta destruye datos.
// =============================================================================

'use strict';

import { findDuplicateRow } from '../../public/js/views/quotationForm/lineItemsComponent.js';

/** Una fila del formulario, con lo mínimo que mira la deduplicación. */
const fila = (codigo, marca_id, cantidad = 1) => ({
  codigo, marca_id, cantidad, descripcion_item: 'Repuesto',
});

// ---------------------------------------------------------------------------
describe('el caso que reportó ventas', () => {
  test('dos filas con el mismo código y SIN marca todavía NO se fusionan', () => {
    // El momento exacto del bug: el usuario cargó el código de la segunda fila
    // y todavía no bajó a elegir la marca.
    const items = [
      fila('7E-6116', null, 2),
      fila('7E-6116', null, 3),
    ];

    // La fila 1 acaba de perder el foco del campo código.
    expect(findDuplicateRow(items, 1, '7E-6116')).toBeNull();
  });

  test('el mismo código con marcas DISTINTAS nunca se fusiona', () => {
    // CAT y CUMMINS comparten numeración de parte. Son dos repuestos distintos.
    const items = [
      fila('7E-6116', 4, 2),   // CAT
      fila('7E-6116', 9, 3),   // CUMMINS
    ];

    expect(findDuplicateRow(items, 1, '7E-6116')).toBeNull();
  });

  test('una fila con marca y otra sin marca tampoco se fusionan', () => {
    // La segunda todavía no eligió: no hay forma de saber si es la misma pieza.
    const items = [
      fila('7E-6116', 4, 2),
      fila('7E-6116', null, 3),
    ];

    expect(findDuplicateRow(items, 1, '7E-6116')).toBeNull();
    // Y al revés, por si el usuario completa las filas en otro orden.
    expect(findDuplicateRow(items, 0, '7E-6116')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('la fusión legítima sigue funcionando', () => {
  test('mismo código y MISMA marca sí se fusionan, sumando cantidades', () => {
    // Éste es el caso para el que existe la función: el ejecutivo cargó dos
    // veces el mismo repuesto de la misma marca sin darse cuenta.
    const items = [
      fila('7E-6116', 4, 2),
      fila('7E-6116', 4, 3),
    ];

    const r = findDuplicateRow(items, 1, '7E-6116');
    expect(r).not.toBeNull();
    expect(r.dupeIdx).toBe(0);
    expect(r.merged).toBe(5);
  });

  test('el código se compara sin distinguir mayúsculas ni espacios', () => {
    const items = [
      fila('7e-6116', 4, 1),
      fila('  7E-6116  ', 4, 1),
    ];

    expect(findDuplicateRow(items, 1, '  7E-6116  ')?.merged).toBe(2);
  });

  test('códigos distintos no se tocan aunque compartan marca', () => {
    const items = [
      fila('7E-6116', 4, 1),
      fila('P553191', 4, 1),
    ];

    expect(findDuplicateRow(items, 1, 'P553191')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('casos borde que no deben romper el formulario', () => {
  test('un código vacío nunca fusiona', () => {
    expect(findDuplicateRow([fila('', 4), fila('', 4)], 1, '')).toBeNull();
    expect(findDuplicateRow([fila('', 4), fila('', 4)], 1, '   ')).toBeNull();
  });

  test('una fila sin cantidad cuenta como 1 y no rompe la suma', () => {
    const items = [
      fila('7E-6116', 4, undefined),
      fila('7E-6116', 4, undefined),
    ];

    expect(findDuplicateRow(items, 1, '7E-6116')?.merged).toBe(2);
  });

  test('un índice fuera de rango devuelve null en vez de explotar', () => {
    expect(() => findDuplicateRow([fila('A', 1)], 99, 'A')).not.toThrow();
  });

  test('la cadena vacía del <select> se trata igual que null', () => {
    // El <select> sin elegir devuelve '', y el manejador lo convierte a null.
    // Si alguna vez llegara sin convertir, no debe pasar por «marca conocida».
    const items = [
      fila('7E-6116', '', 2),
      fila('7E-6116', '', 3),
    ];

    expect(findDuplicateRow(items, 1, '7E-6116')).toBeNull();
  });
});
