// =============================================================================
// tests/unit/quotationFormObservers.test.js
// Red de seguridad del patrón Observer del formulario de cotización.
//
// Fija el contrato que la modularización NO puede alterar: el Subject es la
// única fuente de verdad, entrega snapshots inmutables, y notifica en cada
// mutación. Los dos Observers concretos se prueban con celdas DOM falsas.
// =============================================================================

'use strict';

import {
  LineItemsSubject,
  Observer,
  RowSubtotalObserver,
  TotalsObserver,
} from '../../public/js/views/quotationForm/observers.js';

/** Observer espía que guarda cada snapshot recibido. */
class SpyObserver extends Observer {
  constructor() { super(); this.snapshots = []; }
  update(items) { this.snapshots.push(items); }
}

/** Celda DOM mínima: sólo necesitamos textContent. */
const cell = () => ({ textContent: '' });

describe('LineItemsSubject', () => {
  test('addItem agrega una fila con los valores por defecto y devuelve su índice', () => {
    const subject = new LineItemsSubject();

    expect(subject.addItem()).toBe(0);
    expect(subject.addItem()).toBe(1);

    expect(subject.getItems()[0]).toEqual({
      descripcion_item:   '',
      codigo:             '',
      codigo_alternativo: '',
      unidad:             'UND',
      cantidad:           1,
      precio_unitario:    0,
      marca_id:           null,
      tiempo_entrega:     '',
    });
  });

  test('addItemData hidrata los campos presentes y completa los faltantes', () => {
    const subject = new LineItemsSubject();

    const idx = subject.addItemData({ descripcion_item: 'Filtro de aceite', cantidad: 3 });

    expect(idx).toBe(0);
    expect(subject.getItems()[0]).toEqual({
      descripcion_item:   'Filtro de aceite',
      codigo:             '',
      codigo_alternativo: '',
      unidad:             'UND',
      cantidad:           3,
      precio_unitario:    0,
      marca_id:           null,
      tiempo_entrega:     '',
    });
  });

  test('addItemData sin argumentos no explota', () => {
    const subject = new LineItemsSubject();
    expect(() => subject.addItemData()).not.toThrow();
    expect(subject.getItems()).toHaveLength(1);
  });

  test('getItems devuelve una copia: mutarla no toca el estado interno', () => {
    const subject = new LineItemsSubject();
    subject.addItemData({ descripcion_item: 'Original' });

    const copia = subject.getItems();
    copia[0].descripcion_item = 'Alterado';
    copia.push({ descripcion_item: 'Colado' });

    expect(subject.getItems()).toHaveLength(1);
    expect(subject.getItems()[0].descripcion_item).toBe('Original');
  });

  test('notifica a los observers en cada mutación', () => {
    const subject = new LineItemsSubject();
    const spy     = new SpyObserver();
    subject.subscribe(spy);

    subject.addItem();                              // 1
    subject.updateItem(0, 'cantidad', 5);           // 2
    subject.addItemData({ descripcion_item: 'X' }); // 3
    subject.removeItem(1);                          // 4

    expect(spy.snapshots).toHaveLength(4);
    expect(spy.snapshots[3]).toHaveLength(1);
  });

  test('el snapshot que reciben los observers también es una copia', () => {
    const subject = new LineItemsSubject();
    const spy     = new SpyObserver();
    subject.subscribe(spy);

    subject.addItemData({ descripcion_item: 'Intacto' });
    spy.snapshots[0][0].descripcion_item = 'Pisado';

    expect(subject.getItems()[0].descripcion_item).toBe('Intacto');
  });

  test('updateItem sobre un índice inexistente se ignora sin notificar', () => {
    const subject = new LineItemsSubject();
    const spy     = new SpyObserver();
    subject.subscribe(spy);

    subject.updateItem(99, 'cantidad', 7);

    expect(spy.snapshots).toHaveLength(0);
    expect(subject.getItems()).toHaveLength(0);
  });

  test('removeItem reindexa las filas restantes', () => {
    const subject = new LineItemsSubject();
    subject.addItemData({ descripcion_item: 'A' });
    subject.addItemData({ descripcion_item: 'B' });
    subject.addItemData({ descripcion_item: 'C' });

    subject.removeItem(1);

    expect(subject.getItems().map(i => i.descripcion_item)).toEqual(['A', 'C']);
  });

  test('unsubscribe corta las notificaciones de ese observer', () => {
    const subject = new LineItemsSubject();
    const spy     = new SpyObserver();
    subject.subscribe(spy);

    subject.addItem();
    subject.unsubscribe(spy);
    subject.addItem();

    expect(spy.snapshots).toHaveLength(1);
  });
});

describe('RowSubtotalObserver', () => {
  test('escribe cantidad × precio en la celda de cada fila', () => {
    const celdas = { 0: cell(), 1: cell() };
    const container = {
      querySelector: (sel) => celdas[sel.match(/"(\d+)"/)[1]] ?? null,
    };

    new RowSubtotalObserver(container).update([
      { cantidad: 3,  precio_unitario: 10.5 },
      { cantidad: 12, precio_unitario: 2.25 },
    ]);

    expect(celdas[0].textContent).toBe('31.50');
    expect(celdas[1].textContent).toBe('27.00');
  });

  test('los valores no numéricos cuentan como 0', () => {
    const celda = cell();
    const container = { querySelector: () => celda };

    new RowSubtotalObserver(container).update([{ cantidad: 'abc', precio_unitario: 10 }]);

    expect(celda.textContent).toBe('0.00');
  });

  test('una fila sin celda en el DOM no rompe el recorrido', () => {
    const celda = cell();
    const container = {
      querySelector: (sel) => (sel.includes('"1"') ? celda : null),
    };

    expect(() => new RowSubtotalObserver(container).update([
      { cantidad: 1, precio_unitario: 1 },
      { cantidad: 2, precio_unitario: 3 },
    ])).not.toThrow();

    expect(celda.textContent).toBe('6.00');
  });
});

describe('TotalsObserver', () => {
  test('sin descuento, el total es igual al subtotal', () => {
    const sub = cell(); const tot = cell();

    new TotalsObserver(sub, tot, null).update([
      { cantidad: 2, precio_unitario: 100 },
      { cantidad: 1, precio_unitario: 50.5 },
    ]);

    expect(sub.textContent).toBe('250.50');
    expect(tot.textContent).toBe('250.50');
  });

  test('resta el descuento leído del input en vivo', () => {
    const sub = cell(); const tot = cell();

    new TotalsObserver(sub, tot, { value: '50' }).update([
      { cantidad: 2, precio_unitario: 100 },
    ]);

    expect(sub.textContent).toBe('200.00');
    expect(tot.textContent).toBe('150.00');
  });

  test('un descuento negativo no infla el total por encima del subtotal', () => {
    const sub = cell(); const tot = cell();

    new TotalsObserver(sub, tot, { value: '-999' }).update([
      { cantidad: 1, precio_unitario: 80 },
    ]);

    expect(sub.textContent).toBe('80.00');
    expect(tot.textContent).toBe('80.00');
  });

  test('setDiscountEl reconecta el input después del render', () => {
    const sub = cell(); const tot = cell();
    const obs = new TotalsObserver(sub, tot, null);

    obs.setDiscountEl({ value: '25' });
    obs.update([{ cantidad: 1, precio_unitario: 100 }]);

    expect(tot.textContent).toBe('75.00');
  });

  test('una lista vacía deja todo en 0.00', () => {
    const sub = cell(); const tot = cell();

    new TotalsObserver(sub, tot, null).update([]);

    expect(sub.textContent).toBe('0.00');
    expect(tot.textContent).toBe('0.00');
  });
});
