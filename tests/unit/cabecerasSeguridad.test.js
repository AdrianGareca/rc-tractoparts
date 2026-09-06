// =============================================================================
// tests/unit/cabecerasSeguridad.test.js
// Las cabeceras de seguridad que la aplicación manda en cada respuesta.
//
// POR QUÉ EXISTE
// `src/app.js` hace `app.use(helmet())` y confía en los valores por defecto de
// la librería. Eso funciona, pero deja la protección a merced de una
// dependencia: una actualización mayor puede aflojar una directiva y nada lo
// notaría — la aplicación sigue andando igual, sólo que peor protegida.
//
// Se descubrió al actualizar helmet 7 → 8 (2026-09-06). Se compararon las dos
// versiones cabecera por cabecera antes de aplicar el cambio, y de las doce
// sólo se movió una: HSTS pasó de 180 a 365 días. Pero ese trabajo fue manual;
// esto lo deja hecho para la próxima.
//
// LO QUE MÁS IMPORTA ACÁ ES `style-src 'unsafe-inline'`
// La aplicación tiene estilos escritos en el atributo `style=` de algunos
// elementos (23 hoy, con un trinquete que sólo los deja bajar — ver
// tests/unit/estilosInline.test.js). Si una versión de helmet quitara
// 'unsafe-inline' de style-src, el navegador dejaría de aplicarlos: media
// interfaz se vería rota, sin un solo error en el servidor.
//
// Y `script-src 'self'` es lo que bloqueó un <script> escrito dentro del HTML
// en esta misma sesión. No es teoría: ya mordió.
//
// CÓMO SE PRUEBA
// Se levanta un Express mínimo con el MISMO `helmet()` sin argumentos que usa
// la aplicación, se le hace una petición real y se leen las cabeceras que
// devuelve. No se lee la configuración: se mide lo que sale por el cable.
// =============================================================================

'use strict';

const express = require('express');
const helmet  = require('helmet');
const http    = require('http');

/** Levanta un servidor con helmet() y devuelve las cabeceras de una respuesta. */
function cabeceras() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(helmet());
    app.get('/', (_req, res) => res.send('ok'));

    const srv = app.listen(0, () => {
      const { port } = srv.address();
      http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume();
        res.on('end', () => { srv.close(); resolve(res.headers); });
      }).on('error', (e) => { srv.close(); reject(e); });
    });
    srv.on('error', reject);
  });
}

let h;
beforeAll(async () => { h = await cabeceras(); });

describe('la política de contenido (CSP)', () => {
  test('existe', () => {
    expect(h['content-security-policy']).toBeTruthy();
  });

  test("style-src conserva 'unsafe-inline'", () => {
    // Sin esto los estilos escritos en atributos `style=` dejan de aplicarse y
    // parte de la interfaz se ve rota, sin ningún error en el servidor.
    const csp = h['content-security-policy'];
    const style = (csp.match(/style-src[^;]*/) || [''])[0];

    if (!style.includes("'unsafe-inline'")) {
      throw new Error(
        `style-src quedó como «${style}».\n\n` +
        "Sin 'unsafe-inline' el navegador descarta los estilos que la aplicación " +
        'escribe en el atributo style= de algunos elementos. La página carga, no ' +
        'hay error en los registros, y se ve rota.\n\n' +
        'Si esto lo cambió una actualización de helmet: o se declara la directiva ' +
        'a mano en src/app.js, o se migran esos estilos a clases (ver el trinquete ' +
        'de tests/unit/estilosInline.test.js).'
      );
    }
  });

  test("script-src sigue restringido a 'self'", () => {
    const csp = h['content-security-policy'];
    const script = (csp.match(/script-src[^;]*/) || [''])[0];

    expect(script).toContain("'self'");
    // Si alguna vez apareciera 'unsafe-inline' o 'unsafe-eval' acá, la
    // protección contra scripts inyectados se cae. Es un aflojamiento que
    // tiene que ser deliberado, no heredado de una dependencia.
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  test.each([
    ["default-src", "'self'"],
    ["object-src",  "'none'"],
    ["base-uri",    "'self'"],
    ["form-action", "'self'"],
  ])('%s sigue en %s', (directiva, valor) => {
    const trozo = (h['content-security-policy'].match(new RegExp(directiva + '[^;]*')) || [''])[0];
    expect(trozo).toContain(valor);
  });
});

describe('las demás cabeceras de seguridad', () => {
  test.each([
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options',        'SAMEORIGIN'],
    ['referrer-policy',        'no-referrer'],
    ['cross-origin-opener-policy',   'same-origin'],
    ['cross-origin-resource-policy', 'same-origin'],
  ])('%s = %s', (cabecera, valor) => {
    expect(h[cabecera]).toBe(valor);
  });

  test('HSTS pide HTTPS por al menos 180 días', () => {
    // helmet 8 lo subió de 180 a 365 días. Se comprueba un MÍNIMO y no un valor
    // exacto: subirlo es una mejora y no debe romper la prueba; bajarlo sí
    // debilita la protección y tiene que cantar.
    const hsts = h['strict-transport-security'] || '';
    const m = hsts.match(/max-age=(\d+)/);
    expect(m).not.toBeNull();

    const dias = Number(m[1]) / 86400;
    if (dias < 180) {
      throw new Error(
        `HSTS quedó en ${Math.round(dias)} días y el mínimo aceptado son 180.\n\n` +
        'Cuanto más corto, más ventana hay para que un atacante en la misma red ' +
        'degrade la conexión a HTTP antes de que el navegador recuerde exigir HTTPS.'
      );
    }
    expect(hsts).toContain('includeSubDomains');
  });
});

describe('la aplicación no anuncia con qué está hecha', () => {
  test('no manda X-Powered-By', () => {
    // Express lo manda por defecto; helmet lo saca. Decirle a un atacante qué
    // marco y qué versión corre le ahorra el trabajo de averiguarlo.
    expect(h['x-powered-by']).toBeUndefined();
  });
});
