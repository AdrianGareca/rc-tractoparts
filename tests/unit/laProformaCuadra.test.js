// =============================================================================
// tests/unit/laProformaCuadra.test.js
// La multiplicación impresa en la proforma tiene que dar el resultado impreso
// al lado.
//
// EL BUG
// El validador aceptaba cualquier cantidad de decimales en el precio:
//
//     precio_unitario: z.number().min(0).max(99999999999.99)
//
// pero la base lo guarda como DECIMAL(15,2). El subtotal, en cambio, se
// calculaba con el número SIN redondear y se guardaba ya redondeado. Las dos
// cifras terminaban saliendo de números distintos:
//
//     el usuario teclea (o pega)   12.345
//     MySQL guarda el precio       12.35
//     el subtotal se calculó con   12.345  ->  10 × 12.345 = 123.45
//
// Y la línea de la proforma queda así:
//
//     CANT   P. UNIT    SUBTOTAL
//       10     12.35      123.45
//
// El cliente saca la calculadora, hace 10 × 12,35 y le da 123,50. La proforma
// no cuadra por cinco centavos, con el membrete de la empresa arriba.
//
// No hace falta que alguien tipee tres decimales a propósito: pasa solo con
// pegar precios de una lista del proveedor, que es exactamente como se cargan
// las cotizaciones grandes.
//
// LA REGLA
// El número que se valida es el número que se guarda. Se redondea UNA vez, al
// entrar, con la misma precisión que la columna — y a partir de ahí todas las
// cuentas usan ese mismo valor.
//
// Se redondea en lugar de rechazar a propósito: MySQL ya venía redondeando de
// todos modos, sólo que en un lado y no en el otro. Rechazar obligaría a
// corregir a mano fila por fila una lista pegada de cincuenta ítems, para
// llegar al mismo número al que se llega solo.
// =============================================================================

'use strict';

const { createQuotationSchema } = require('../../src/validators/quotationValidator');
const { calcularSubtotal }      = require('../../src/utils/quotationTotals');

/** Lo que hace la columna al guardar: DECIMAL(15,2) para plata. */
const comoLoGuardaLaBase   = (n) => Math.round(n * 100) / 100;
/** Lo que hace la columna de cantidad: DECIMAL(12,4). */
const comoGuardaLaCantidad = (n) => Math.round(n * 10000) / 10000;

/** Una cotización mínima válida con los ítems que se le pasen. */
const cotizacionCon = (detalles) => ({
  id_cliente:    1,
  descripcion:   'Cotización de prueba',
  fecha_emision: '2026-08-13',
  detalles,
});

/** Corre el validador y devuelve el ítem ya normalizado. */
function validarItem(item) {
  const res = createQuotationSchema.safeParse(cotizacionCon([item]));
  if (!res.success) {
    throw new Error('el validador rechazó la cotización: ' + JSON.stringify(res.error.issues));
  }
  return res.data.detalles[0];
}

// ---------------------------------------------------------------------------
describe('el número que se valida es el que se guarda', () => {
  test('un precio de tres decimales se redondea al entrar', () => {
    const item = validarItem({ descripcion_item: 'Filtro', cantidad: 10, precio_unitario: 12.345 });
    expect(item.precio_unitario).toBe(12.35);
  });

  test('el redondeo es el mismo que aplica la columna', () => {
    // Si el validador redondeara distinto que MySQL, el bug volvería con otra
    // cara: la fila se guardaría con un precio y la cuenta usaría otro.
    for (const crudo of [12.345, 0.005, 99.994, 1.005, 0.001]) {
      const item = validarItem({ descripcion_item: 'X', cantidad: 1, precio_unitario: crudo });
      expect(item.precio_unitario).toBe(comoLoGuardaLaBase(crudo));
    }
  });

  test('la cantidad se redondea a los cuatro decimales de su columna', () => {
    // cantidad es DECIMAL(12,4) — cuatro y no dos, porque se venden metros de
    // manguera y kilos de material a granel.
    const item = validarItem({ descripcion_item: 'Manguera', cantidad: 1.23456, precio_unitario: 10 });
    expect(item.cantidad).toBe(comoGuardaLaCantidad(1.23456));
  });

  test('un precio que ya tenía dos decimales no se toca', () => {
    const item = validarItem({ descripcion_item: 'Filtro', cantidad: 3, precio_unitario: 45.90 });
    expect(item.precio_unitario).toBe(45.90);
  });

  test('el descuento manual también, que se resta del total impreso', () => {
    const res = createQuotationSchema.safeParse({
      ...cotizacionCon([{ descripcion_item: 'X', cantidad: 1, precio_unitario: 10 }]),
      descuento_manual: 15.678,
    });
    expect(res.success).toBe(true);
    expect(res.data.descuento_manual).toBe(15.68);
  });
});

// ---------------------------------------------------------------------------
describe('la línea de la proforma cuadra', () => {
  // La prueba que importa: lo que el cliente hace con una calculadora.
  const CASOS = [
    { cantidad: 10,      precio: 12.345,   nombre: 'tres decimales, el caso que falló' },
    { cantidad: 3,       precio: 45.90,    nombre: 'un precio normal' },
    { cantidad: 1,       precio: 0.005,    nombre: 'medio centavo' },
    { cantidad: 7,       precio: 99.999,   nombre: 'un precio que sube al entero' },
    { cantidad: 1.5,     precio: 33.333,   nombre: 'cantidad fraccionaria' },
    { cantidad: 2.25,    precio: 10.005,   nombre: 'las dos con decimales' },
  ];

  test.each(CASOS)('$nombre — cantidad × precio da el subtotal impreso', ({ cantidad, precio }) => {
    const item = validarItem({ descripcion_item: 'X', cantidad, precio_unitario: precio });

    // Lo que la base termina guardando en cada columna.
    const precioGuardado   = comoLoGuardaLaBase(item.precio_unitario);
    const cantidadGuardada = comoGuardaLaCantidad(item.cantidad);

    // El subtotal se calcula con esos MISMOS valores, no con los que se
    // tecleraron. Ahí estaba la grieta.
    const subtotal = calcularSubtotal(item.cantidad, item.precio_unitario);

    // Y lo que hace el cliente con la calculadora, sobre lo que ve impreso.
    const loQueDaLaCalculadora = Math.round(cantidadGuardada * precioGuardado * 100) / 100;

    expect(subtotal).toBe(loQueDaLaCalculadora);
  });
});

// ---------------------------------------------------------------------------
describe('lo que ya funcionaba sigue funcionando', () => {
  test('un precio de cero se sigue aceptando', () => {
    // Se usa para ítems de regalo o servicios bonificados, y es válido.
    const item = validarItem({ descripcion_item: 'Bonificado', cantidad: 1, precio_unitario: 0 });
    expect(item.precio_unitario).toBe(0);
  });

  test('un precio negativo se sigue rechazando', () => {
    const res = createQuotationSchema.safeParse(cotizacionCon([
      { descripcion_item: 'X', cantidad: 1, precio_unitario: -5 },
    ]));
    expect(res.success).toBe(false);
  });

  test('una cantidad de cero se sigue rechazando', () => {
    const res = createQuotationSchema.safeParse(cotizacionCon([
      { descripcion_item: 'X', cantidad: 0, precio_unitario: 10 },
    ]));
    expect(res.success).toBe(false);
  });

  test('el redondeo no puede convertir una cantidad válida en cero', () => {
    // 0.00001 redondeado a cuatro decimales da 0, y una cantidad de cero está
    // prohibida. Tiene que rechazarse, no colarse como cero.
    const res = createQuotationSchema.safeParse(cotizacionCon([
      { descripcion_item: 'X', cantidad: 0.00001, precio_unitario: 10 },
    ]));
    expect(res.success).toBe(false);
  });
});
