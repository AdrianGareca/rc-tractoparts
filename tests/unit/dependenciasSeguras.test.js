// =============================================================================
// tests/unit/dependenciasSeguras.test.js
// El parche de `qs` no puede desaparecer solo.
//
// EL PROBLEMA QUE RESUELVE EL OVERRIDE
// `qs` es la librería con la que Express interpreta los parámetros de CADA URL
// que recibe la aplicación. Las versiones hasta la 6.15.3 arrastran dos avisos
// de seguridad (GHSA-x5fp-wj9c-mxmx y GHSA-4mjr-xmp4-gh2g), los dos de
// denegación de servicio con una cadena de consulta armada a propósito.
//
// El arreglo está publicado en `qs` 6.16.0, pero Express 4 y body-parser lo
// declaran como `~6.15.1` — o sea, «cualquier 6.15.x y ninguna 6.16». Con esa
// restricción, `npm audit fix` deja el problema donde está: lo único que lo
// resolvería es saltar a Express 5, un cambio mayor en una aplicación en
// producción.
//
// Por eso package.json lleva un `overrides` que fuerza la versión parcheada en
// todo el árbol. Es la herramienta que npm tiene justamente para esto.
//
// POR QUÉ HACE FALTA VIGILARLO
// Un `overrides` es tres líneas en package.json que no rompen nada al quitarse.
// Alguien que ordene el archivo, resuelva un conflicto de merge a favor de la
// otra rama, o regenere package.json, se lo lleva puesto — y la aplicación
// vuelve a la versión vulnerable sin que falle ni una prueba ni el arranque.
// Sólo se notaría corriendo `npm audit`, que nadie corre a diario.
//
// CUÁNDO SE PUEDE BORRAR ESTE ARCHIVO
// El día que Express (o body-parser) declare una versión de `qs` que ya incluya
// el arreglo. Ahí el override sobra y este test también.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../..');

const leerJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** Compara dos versiones semver. Devuelve <0, 0 o >0. */
function comparar(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

const MINIMA_SEGURA = '6.16.0';

describe('el parche de qs sigue puesto', () => {
  const pkg = leerJson(path.join(RAIZ, 'package.json'));

  test('package.json declara el override', () => {
    if (!pkg.overrides || !pkg.overrides.qs) {
      throw new Error(
        'Falta `overrides.qs` en package.json.\n\n' +
        'Sin él, npm instala la versión de `qs` que pide Express (~6.15.1), que ' +
        'arrastra dos avisos de denegación de servicio. `qs` interpreta los ' +
        'parámetros de cada URL que entra a la aplicación.\n\n' +
        'Restaurar con:  "overrides": { "qs": "^' + MINIMA_SEGURA + '" }'
      );
    }
  });

  test('el override apunta a una versión con el arreglo', () => {
    const declarada = String(pkg.overrides.qs).replace(/^[\^~>=]+/, '');
    expect(comparar(declarada, MINIMA_SEGURA)).toBeGreaterThanOrEqual(0);
  });

  test('la versión REALMENTE instalada tiene el arreglo', () => {
    // Se mira node_modules, no package.json: lo que corre es lo instalado. Un
    // override bien escrito con un `npm install` a medias no protege de nada.
    const ruta = path.join(RAIZ, 'node_modules/qs/package.json');
    if (!fs.existsSync(ruta)) {
      throw new Error('No está instalado `qs`. Correr `npm install`.');
    }

    const instalada = leerJson(ruta).version;
    if (comparar(instalada, MINIMA_SEGURA) < 0) {
      throw new Error(
        `Está instalada la versión ${instalada} de qs y el arreglo entra en ` +
        `${MINIMA_SEGURA}.\n\n` +
        'El override está declarado pero no se aplicó: correr `npm install` ' +
        'para que npm rehaga el árbol.'
      );
    }
  });

  test('la revisión semanal sigue en pie', () => {
    // El override deja la auditoría en cero HOY. Lo que la mantiene así es que
    // alguien vuelva a mirar: si el workflow desaparece o deja de auditar, un
    // aviso nuevo puede quedarse meses sin que nadie se entere — y eso no lo
    // detecta ninguna otra prueba, porque el código sigue funcionando igual.
    const ruta = path.join(RAIZ, '.github/workflows/auditoria-dependencias.yml');
    if (!fs.existsSync(ruta)) {
      throw new Error(
        'Falta .github/workflows/auditoria-dependencias.yml.\n\n' +
        'Es la revisión semanal que avisa por correo cuando aparece una ' +
        'vulnerabilidad nueva. Sin ella hay que acordarse de correr `npm audit` ' +
        'a mano, y nadie se acuerda.'
      );
    }

    const yml = fs.readFileSync(ruta, 'utf8');
    expect(yml).toMatch(/npm audit/);
    expect(yml).toMatch(/schedule:/);
    // Sin `workflow_dispatch` no se puede lanzar a mano, y una alarma que no se
    // puede probar no se sabe si funciona hasta el día que hace falta.
    expect(yml).toMatch(/workflow_dispatch:/);
  });

  test('mysql2 tiene su propio parche', () => {
    // Se actualizó junto con qs (3.22.3 → 3.24.3) por un aviso moderado. No
    // necesita override: la versión corregida entra en el rango que ya declara
    // package.json, así que alcanza con no volver atrás.
    const instalada = leerJson(path.join(RAIZ, 'node_modules/mysql2/package.json')).version;
    expect(comparar(instalada, '3.23.1')).toBeGreaterThanOrEqual(0);
  });
});
