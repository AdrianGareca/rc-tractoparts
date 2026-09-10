// =============================================================================
// tests/unit/robotsTxt.test.js
// El sistema interno no se publica en los buscadores.
//
// POR QUÉ EXISTE
// `rctractoparts.org` sirve sólo una pantalla de login y el cascarón del panel:
// no hay contenido público. Sin `robots.txt`, Google indexa igual esas páginas
// y los archivos de JavaScript que las acompañan — un mapa gratis de cómo está
// armado el sistema, a cambio de nada.
//
// NO ES UN CONTROL DE SEGURIDAD, Y ESA DISTINCIÓN IMPORTA
// robots.txt es una petición, no una barrera. Lo que de verdad protege es que
// las 60 rutas exijan sesión (tests/unit/rutasProtegidas.test.js). Esta prueba
// vigila una cosa mucho más chica: que el archivo siga ahí y siga diciendo lo
// que dice.
//
// El riesgo real que ataja es un descuido: alguien mueve o renombra la carpeta
// `public/`, o vacía el archivo, y nadie se entera — porque un robots.txt que
// falta no rompe absolutamente nada. Simplemente, meses después, el sistema
// aparece en Google.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

// Tiene que estar en public/: es la carpeta que Express sirve como estática
// (`app.use(express.static(...))`), y robots.txt SÓLO funciona si se responde
// en la raíz del dominio.
const RUTA = path.resolve(__dirname, '../../public/robots.txt');

const leer = () => fs.readFileSync(RUTA, 'utf8').replace(/\r\n/g, '\n');

/** Las directivas activas, sin comentarios ni líneas vacías. */
const directivas = () => leer()
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

describe('el archivo existe y se sirve', () => {
  test('está en public/, que es lo que Express publica', () => {
    if (!fs.existsSync(RUTA)) {
      throw new Error(
        'Falta public/robots.txt.\n\n' +
        'Sin él, los buscadores indexan la pantalla de login, el cascarón del ' +
        'panel y los archivos de JavaScript del sistema. No es una filtración ' +
        '—el código del navegador siempre es visible— pero publica gratis un ' +
        'mapa de cómo está armado.'
      );
    }
  });

  test('no está vacío', () => {
    // Un archivo de cero bytes responde 200 y no dice nada: los buscadores lo
    // interpretan como «indexá todo». Es peor que no tenerlo, porque parece
    // que el tema está resuelto.
    expect(leer().trim().length).toBeGreaterThan(20);
  });
});

describe('lo que dice', () => {
  test('se dirige a todos los buscadores', () => {
    expect(directivas()).toContain('User-agent: *');
  });

  test('no permite indexar nada', () => {
    const disallow = directivas().filter((l) => /^Disallow:/i.test(l));

    if (!disallow.includes('Disallow: /')) {
      throw new Error(
        `Las reglas de exclusión quedaron como:\n  ${disallow.join('\n  ') || '(ninguna)'}\n\n` +
        'Se esperaba «Disallow: /», que deja todo el dominio fuera de los ' +
        'buscadores. Este dominio no tiene contenido público: sólo el login y ' +
        'el panel, que exigen sesión.\n\n' +
        'Si SE AGREGÓ contenido público a propósito, actualizá también esta prueba.'
      );
    }
  });

  test('no hay ningún Allow que contradiga al Disallow', () => {
    // Un `Allow:` suelto —agregado para dejar pasar una página concreta y
    // olvidado después— abre justamente lo que este archivo cierra.
    const allow = directivas().filter((l) => /^Allow:/i.test(l));
    expect(allow).toEqual([]);
  });

  test('explica por qué, no sólo qué', () => {
    // El archivo tiene que decir que NO es un control de seguridad. Quien lo
    // lea dentro de un año tiene que entender que la protección real está en
    // otro lado y no confiarse de estas dos líneas.
    const texto = leer().toLowerCase();
    expect(texto).toMatch(/no es un control de seguridad/);
    expect(texto).toMatch(/petición|peticion/);
  });
});

describe('los andamios de prueba no se publican', () => {
  test('las páginas prueba-* siguen fuera del control de versiones', () => {
    // Se comprobó en producción que prueba-paleta.html da 404, pero eso depende
    // de que el .gitignore siga excluyéndolas. public/ se sirve ENTERA y sin
    // login: una página de prueba versionada por accidente queda accesible
    // desde internet.
    const gitignore = fs.readFileSync(
      path.resolve(__dirname, '../../.gitignore'), 'utf8');

    for (const patron of ['prueba-*.html', 'prueba-*.js']) {
      if (!gitignore.includes(patron)) {
        throw new Error(
          `Desapareció «${patron}» del .gitignore.\n\n` +
          'public/ se sirve entera y sin login. Los andamios de prueba usan ' +
          'colores escritos a mano y no forman parte del producto: si viajaran ' +
          'al servidor quedarían accesibles desde internet.'
        );
      }
    }
  });
});
