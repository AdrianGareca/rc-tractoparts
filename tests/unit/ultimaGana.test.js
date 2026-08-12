// =============================================================================
// tests/unit/ultimaGana.test.js
// Una respuesta vieja no puede pisar a una nueva.
//
// EL BUG, QUE NO DA NINGUNA SEÑAL
// Los cuatro paneles de listado y las dos pantallas de reportes disparan su
// consulta y escriben el resultado cuando llega. Sin nada que ordene las
// llegadas, la respuesta LENTA de un pedido viejo pisa a la RÁPIDA de uno
// nuevo.
//
// El caso concreto que lo vuelve grave: el Jefe elige «Este año» y aprieta
// Aplicar — consulta pesada, tres segundos. Sin esperar, elige «Hoy» y aprieta
// otra vez — cuatrocientos milisegundos. Termina primero la de hoy. Dos
// segundos y medio después llega la del año y sobrescribe la pantalla.
//
// El Jefe queda mirando el volumen ANUAL creyendo que es el del día. No hay
// error, no hay parpadeo, no hay forma de notarlo: los números son reales, sólo
// que de otro período.
//
// EL PATRÓN YA EXISTÍA Y NO SE REPLICÓ
// `ExecutiveStrategy._loadQuotations` usa un AbortController y está bien. Los
// otros seis lugares no lo tienen. Este módulo lo vuelve una pieza compartida
// para que el próximo panel no tenga que acordarse.
// =============================================================================

'use strict';

import { crearTurnero } from '../../public/js/shared/ultimaGana.js';

/** Una promesa que resuelve en `ms` con `valor`. */
const demora = (ms, valor) => new Promise((r) => setTimeout(() => r(valor), ms));

describe('crearTurnero — la última pedida es la que escribe', () => {
  test('la respuesta lenta de un pedido viejo NO escribe', async () => {
    const turnero = crearTurnero();
    const escrituras = [];

    // El caso del Jefe: primero «Este año» (lento), después «Hoy» (rápido).
    const anual = turnero.ejecutar(async () => {
      const datos = await demora(50, 'volumen anual');
      return datos;
    }).then((r) => { if (r.vigente) escrituras.push(r.valor); });

    const hoy = turnero.ejecutar(async () => {
      const datos = await demora(5, 'volumen de hoy');
      return datos;
    }).then((r) => { if (r.vigente) escrituras.push(r.valor); });

    await Promise.all([anual, hoy]);

    // Sólo la última pedida escribió, aunque terminó primero.
    expect(escrituras).toEqual(['volumen de hoy']);
  });

  test('sin competencia, la única respuesta escribe normalmente', () => {
    const turnero = crearTurnero();
    return turnero.ejecutar(async () => 'datos').then((r) => {
      expect(r.vigente).toBe(true);
      expect(r.valor).toBe('datos');
    });
  });

  test('un error de la petición vigente se propaga — no se traga', async () => {
    // Si la consulta falla de verdad, el panel tiene que poder mostrar su
    // estado de error. Tragarse la excepción dejaría el esqueleto para siempre.
    const turnero = crearTurnero();
    await expect(
      turnero.ejecutar(async () => { throw new Error('500 del servidor'); })
    ).rejects.toThrow('500 del servidor');
  });

  test('un error de una petición YA vencida no se propaga', async () => {
    // Al revés: si falla la vieja, el panel ya está mostrando la nueva y un
    // cartel de error sería mentira sobre lo que se ve en pantalla.
    const turnero = crearTurnero();

    const vieja = turnero.ejecutar(async () => {
      await demora(50);
      throw new Error('la vieja fallo');
    });

    turnero.ejecutar(async () => demora(5, 'nueva'));

    await expect(vieja).resolves.toMatchObject({ vigente: false });
  });

  test('tres pedidos seguidos: sólo escribe el tercero', async () => {
    const turnero = crearTurnero();
    const escrituras = [];

    await Promise.all([80, 40, 10].map((ms, i) =>
      turnero.ejecutar(() => demora(ms, `pedido ${i + 1}`))
        .then((r) => { if (r.vigente) escrituras.push(r.valor); })
    ));

    expect(escrituras).toEqual(['pedido 3']);
  });

  test('dos turneros distintos no se estorban', () => {
    // Cada panel tiene el suyo: que el de clientes pida algo no puede invalidar
    // lo que está cargando el de auditoría.
    const a = crearTurnero();
    const b = crearTurnero();

    return Promise.all([
      a.ejecutar(async () => 'de A'),
      b.ejecutar(async () => 'de B'),
    ]).then(([ra, rb]) => {
      expect(ra.vigente).toBe(true);
      expect(rb.vigente).toBe(true);
    });
  });
});
