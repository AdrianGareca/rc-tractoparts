// =============================================================================
// tests/unit/quotationNotificaciones.test.js
// Red de seguridad de la fusión de los dos streams de notificaciones.
//
// El feed del ejecutivo mezcla dos orígenes distintos: las correcciones salen
// del historial de estados (sin campo `tipo`) y las aprobaciones/envíos de la
// tabla `notificaciones` (ya etiquetadas). Si el etiquetado o el orden se
// rompen, el frontend las pinta mal o muestra lo viejo primero.
// =============================================================================

'use strict';

const {
  mergeNotificaciones,
  NOTIFIED_ROLES,
} = require('../../src/controllers/quotation/quotationNotificationController');

const correccion = (fecha, extra = {}) => ({ id_cotizacion: 1, fecha_solicitud: fecha, ...extra });
const aprobacion = (fecha, tipo = 'aprobacion') => ({ id_cotizacion: 2, fecha_solicitud: fecha, tipo });

describe('mergeNotificaciones — etiquetado', () => {
  test('las correcciones reciben tipo "correccion"', () => {
    const out = mergeNotificaciones([correccion('2026-07-26')], []);

    expect(out[0].tipo).toBe('correccion');
  });

  test('no pisa el tipo de las que ya vienen etiquetadas', () => {
    const out = mergeNotificaciones([], [aprobacion('2026-07-26', 'envio_cliente')]);

    expect(out[0].tipo).toBe('envio_cliente');
  });

  test('conserva el resto de los campos de la fila', () => {
    const out = mergeNotificaciones([correccion('2026-07-26', { observacion: 'Faltan precios' })], []);

    expect(out[0].observacion).toBe('Faltan precios');
    expect(out[0].id_cotizacion).toBe(1);
  });

  test('no muta las filas de entrada', () => {
    const fila = correccion('2026-07-26');
    mergeNotificaciones([fila], []);

    expect(fila.tipo).toBeUndefined();
  });
});

describe('mergeNotificaciones — orden', () => {
  test('ordena de más nueva a más vieja', () => {
    const out = mergeNotificaciones(
      [correccion('2026-01-01'), correccion('2026-07-26')],
      [aprobacion('2026-05-15')]
    );

    expect(out.map(r => r.fecha_solicitud)).toEqual(['2026-07-26', '2026-05-15', '2026-01-01']);
  });

  test('intercala los dos streams por fecha, no los concatena', () => {
    const out = mergeNotificaciones(
      [correccion('2026-01-01'), correccion('2026-12-31')],
      [aprobacion('2026-06-15')]
    );

    expect(out[1].tipo).toBe('aprobacion');
  });

  test('funciona con fechas completas (datetime)', () => {
    const out = mergeNotificaciones(
      [correccion('2026-07-26T08:00:00Z')],
      [aprobacion('2026-07-26T18:00:00Z')]
    );

    expect(out[0].tipo).toBe('aprobacion');
  });
});

describe('mergeNotificaciones — casos borde', () => {
  test('dos listas vacías dan un array vacío', () => {
    expect(mergeNotificaciones([], [])).toEqual([]);
  });

  test('sin argumentos no rompe', () => {
    expect(mergeNotificaciones()).toEqual([]);
  });

  test('un solo stream se devuelve igual', () => {
    expect(mergeNotificaciones([correccion('2026-07-26')], [])).toHaveLength(1);
    expect(mergeNotificaciones([], [aprobacion('2026-07-26')])).toHaveLength(1);
  });
});

describe('NOTIFIED_ROLES', () => {
  test('solo Ejecutivo y Proyectos reciben feed personal', () => {
    expect(NOTIFIED_ROLES).toEqual(['Ejecutivo', 'Proyectos']);
  });

  test('Jefe, Administracion y SysAdmin no están (usan la bitácora)', () => {
    ['Jefe', 'Administracion', 'SysAdmin'].forEach((rol) => {
      expect(NOTIFIED_ROLES).not.toContain(rol);
    });
  });
});
