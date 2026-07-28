/* ============================================================================
   public/js/theme-boot.js
   Aplica el tema guardado ANTES del primer pintado.

   Por qué es un archivo aparte y NO un <script type="module">:
   los módulos se difieren hasta después de parsear el documento, así que el
   navegador alcanzaría a pintar la app en oscuro y recién después cambiaría a
   claro — el "flash" blanco/negro clásico. Este script es CLÁSICO y bloqueante:
   corre antes del primer paint.

   Por qué no es inline: helmet() aplica una CSP con script-src 'self', que
   bloquea el JavaScript embebido en el HTML. Un archivo propio sí pasa.

   Deliberadamente NO importa nada y duplica las tres líneas de lógica de
   services/theme.js. Es el precio de correr antes que todo lo demás; si
   cambian las claves, hay que tocar los dos (theme.test.js lo verifica).
   ========================================================================== */
(function () {
  'use strict';
  try {
    var mode = localStorage.getItem('rc_theme');
    // 'auto' (o cualquier valor inesperado) NO escribe el atributo: así manda
    // la media query prefers-color-scheme de tokens.css.
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  } catch (e) {
    /* localStorage bloqueado (modo privado, cookies denegadas): se usa el
       tema por defecto. Nunca debe impedir que la página cargue. */
  }
})();
