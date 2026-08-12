// =============================================================================
// tests/unit/saltarAlContenido.test.js
// Quien navega con teclado tiene que poder llegar al contenido sin recorrer
// todo el menú.
//
// EL PROBLEMA MEDIDO
// El dashboard es de dos columnas: una barra lateral fija con la navegación
// completa, y el contenido a la derecha. El orden del documento es ese mismo:
// primero el menú entero, después lo que la persona vino a hacer.
//
// Con mouse no se nota — se hace clic donde uno quiere. Con teclado, cada Tab
// avanza un elemento: para llegar al primer botón del contenido hay que pasar
// por el logo, los ítems del menú (uno por cada pantalla habilitada según el
// rol), el usuario del pie, el toggle del menú, el buscador y el tema. Y hay
// que hacerlo DE NUEVO en cada pantalla, porque la barra lateral se vuelve a
// recorrer cada vez.
//
// No es un caso hipotético en esta empresa: es exactamente cómo trabaja quien
// carga cotizaciones todo el día y no suelta el teclado, y es la única forma de
// trabajar para quien usa un lector de pantalla.
//
// LA SOLUCIÓN, QUE ES LA MISMA DESDE HACE VEINTE AÑOS
// Un enlace «Saltar al contenido» que es el PRIMER elemento enfocable de la
// página y apunta al contenedor principal. Está oculto hasta que recibe foco,
// así que con mouse nadie lo ve nunca. Un Tab y un Enter, y estás adentro.
//
// Este archivo exige las cuatro condiciones que lo hacen funcionar: que exista,
// que apunte a un destino real, que sea lo primero, y que se VEA al enfocarlo.
// Las tres primeras sin la cuarta dan el peor resultado posible: el foco se va
// a un enlace invisible y la persona no tiene idea de dónde está parada.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const PUBLICO = path.resolve(__dirname, '../../public');

const leer = (archivo) => fs.readFileSync(path.join(PUBLICO, archivo), 'utf8');

// El login es una sola tarjeta centrada: no hay menú que saltear, y agregarle
// el enlace sería ruido. La regla aplica donde hay navegación por delante del
// contenido — o sea, el dashboard.
const dashboard = leer('dashboard.html');

// ---------------------------------------------------------------------------
describe('el enlace de salto existe y llega a algún lado', () => {
  test('el dashboard lo tiene', () => {
    expect(dashboard).toMatch(/class="[^"]*skip-link/);
  });

  test('apunta al contenido principal y ese destino existe', () => {
    const enlace = dashboard.match(/<a[^>]*class="[^"]*skip-link[^"]*"[^>]*>/);
    expect(enlace).not.toBeNull();

    const destino = enlace[0].match(/href="#([^"]+)"/);
    expect(destino).not.toBeNull();

    // Un href="#algo" que no corresponde a ningún id manda el foco a la nada:
    // el navegador no mueve nada y la persona aprieta Enter sin resultado.
    const id = destino[1];
    expect(dashboard).toMatch(new RegExp(`id="${id}"`));
  });

  test('el destino es el <main>, no una sección cualquiera', () => {
    // Tiene que llevar al contenedor del contenido. Apuntar a la primera
    // tarjeta funcionaría hoy y se rompería cuando esa tarjeta cambie de lugar.
    expect(dashboard).toMatch(/<main[^>]*id="page-content"/);
  });
});

// ---------------------------------------------------------------------------
describe('está donde tiene que estar y se ve cuando corresponde', () => {
  test('es el primer elemento enfocable del documento', () => {
    // Si aparece después del menú no sirve para nada: para llegar a él ya
    // habría que haber recorrido todo lo que venía a saltear.
    const cuerpo = dashboard.slice(dashboard.indexOf('<body'));

    const posSalto = cuerpo.indexOf('skip-link');
    // El primer candidato a recibir foco que trae el dashboard.
    const posMenu  = cuerpo.search(/<(a|button|input|select|textarea)[\s>]/);

    expect(posSalto).toBeGreaterThan(-1);
    expect(posSalto).toBeLessThan(posMenu === -1 ? Infinity : posMenu + 1);
  });

  test('está oculto de arranque pero NO para los lectores de pantalla', () => {
    const css = leer('css/base.css') + leer('css/layout.css');

    expect(css).toMatch(/\.skip-link\s*\{/);

    // display:none y visibility:hidden sacan al elemento del recorrido de foco
    // por completo: quedaría escrito en el HTML y nunca alcanzable con Tab, que
    // es justo lo único que tenía que hacer.
    const bloque = css.slice(css.indexOf('.skip-link'), css.indexOf('.skip-link') + 400);
    expect(bloque).not.toMatch(/display:\s*none/);
    expect(bloque).not.toMatch(/visibility:\s*hidden/);
  });

  test('vuelve a la vista al recibir el foco', () => {
    const css = leer('css/base.css') + leer('css/layout.css');

    // Sin la regla :focus el enlace se enfoca fuera de pantalla: el cursor de
    // teclado desaparece y la persona no sabe dónde está parada. Es peor que
    // no tener el enlace.
    expect(css).toMatch(/\.skip-link:focus/);
  });
});
