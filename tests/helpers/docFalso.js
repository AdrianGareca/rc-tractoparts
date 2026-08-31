// =============================================================================
// tests/helpers/docFalso.js
// Un `doc` de PDFKit de mentira que ANOTA DÓNDE se dibujó cada cosa.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// El bug que le llegó al cliente —el importe en letras impreso ENCIMA de
// «CONDICIONES DE LA OFERTA» en la proforma— pasó por delante de todas las
// pruebas que había. Y no porque estuvieran mal escritas: verificaban que el
// PDF se generara y que CONTUVIERA los textos esperados, y los dos textos
// estaban. Sólo que en el mismo lugar. Un PDF con todo superpuesto pasa esas
// pruebas igual de bien que uno perfecto.
//
// Lo que no se estaba probando no es el contenido: es la GEOMETRÍA. Y la
// geometría no se puede leer del PDF terminado sin un parser; sí se puede
// interceptar en el momento del dibujo, que es lo que hace este archivo.
//
// El arnés nació dentro de tests/unit/pdfBloqueDeCierre.test.js y protegía UN
// drawer de los diez. Está acá afuera para que lo usen todos: cada copia local
// que se hiciera se iba a desincronizar, y un guardia con un agujero es peor
// que no tenerlo porque además da confianza (ver el mismo razonamiento en
// tests/helpers/emojiInterfaz.js).
//
// No es un archivo .test.js a propósito: Jest sólo levanta suites que terminan
// en .test.js, así que esto se importa sin que se lo tome por una.
//
// QUÉ NO ES
// No es un motor de tipografía. Las medidas son un MODELO —ancho de carácter
// proporcional al cuerpo, alto de línea 1.3— lo bastante fiel para distinguir
// «este texto entra en una línea» de «este envuelve a cuatro», que es lo único
// que hace falta para detectar que un bloque se come al de abajo. Los números
// absolutos que salgan de acá no son los del PDF real; las RELACIONES entre
// ellos sí.
// =============================================================================

'use strict';

// Propiedades que JavaScript, Jest o console.log preguntan por su cuenta. Si el
// Proxy de abajo les devolviera una función, `await doc` se colgaría (`then`) o
// las aserciones tratarían al doc como un matcher. Se responden con undefined.
const PROPIEDADES_DE_SISTEMA = new Set([
  'then', 'catch', 'finally', 'toJSON', 'inspect', 'constructor', 'prototype',
  '$$typeof', 'asymmetricMatch', 'nodeType', 'tagName', '_isMockFunction',
  'hasAttribute', 'toStringTag', 'valueOf', 'toString', '@@__IMMUTABLE_ITERABLE__@@',
]);

/**
 * Un doc de PDFKit de mentira.
 *
 * @param {Object} [opciones]
 * @param {Object} [opciones.margenes] — { top, bottom, left, right } para doc.page.margins.
 *   reportePdfService pone temporalmente margins.bottom = 0 antes de dibujar el
 *   pie, así que el objeto tiene que existir y ser escribible o revienta ahí.
 * @param {number} [opciones.anchoPagina] / [opciones.altoPagina] — A4 por defecto.
 * @param {{width:number,height:number}} [opciones.imagen] — dimensiones que
 *   devuelve openImage(). brandStrip.js calcula el ratio con esto para escalar
 *   cada logo; 300x100 da un logo apaisado, que es el caso real.
 */
function docFalso(opciones = {}) {
  const textos   = [];
  const imagenes = [];
  const formas   = [];
  const lineas   = [];
  const eventos  = {};

  let pagina        = 0;   // índice de la página donde se está dibujando
  let totalPaginas  = 1;
  let puntoActual   = null;  // último moveTo(), para armar el segmento en lineTo()

  const margenes = Object.assign(
    { top: 36, bottom: 36, left: 36, right: 36 },
    opciones.margenes || {}
  );
  const dimsImagen = opciones.imagen || { width: 300, height: 100 };

  const doc = {
    // --- lo que leen las aserciones ------------------------------------------
    textos,
    imagenes,
    formas,
    lineas,
    get paginas() { return totalPaginas; },
    get paginaActual() { return pagina; },

    // --- estado gráfico ------------------------------------------------------
    _y: 0,
    _x: 0,
    _fontSize: 7,
    _font: 'Helvetica',
    page: {
      width:  opciones.anchoPagina ?? 595.28,
      height: opciones.altoPagina  ?? 841.89,
      margins: margenes,
    },

    // --- API de PDFKit -------------------------------------------------------
    font:        (f) => { if (typeof f === 'string') doc._font = f; return doc; },
    fontSize:    (n) => { doc._fontSize = n; return doc; },
    fillColor:   () => doc,
    strokeColor: () => doc,
    lineWidth:   () => doc,
    lineCap:     () => doc,
    lineJoin:    () => doc,
    dash:        () => doc,
    undash:      () => doc,
    opacity:     () => doc,
    fillOpacity: () => doc,
    strokeOpacity: () => doc,
    save:        () => doc,
    restore:     () => doc,
    rotate:      () => doc,
    translate:   () => doc,
    scale:       () => doc,
    clip:        () => doc,
    moveDown:    () => doc,
    moveUp:      () => doc,
    pipe:        () => doc,

    // El relleno y el trazo llegan SIEMPRE después del rect/roundedRect que
    // define la caja, así que la geometría ya quedó anotada al crearla: acá no
    // hay nada que medir.
    fill:          () => doc,
    stroke:        () => doc,
    fillAndStroke: () => doc,

    rect: (x, y, w, h) => {
      formas.push({ tipo: 'rect', x, y, ancho: w, alto: h, arriba: y, abajo: y + h, izquierda: x, derecha: x + w, pagina });
      return doc;
    },
    roundedRect: (x, y, w, h, r) => {
      formas.push({ tipo: 'roundedRect', x, y, ancho: w, alto: h, radio: r, arriba: y, abajo: y + h, izquierda: x, derecha: x + w, pagina });
      return doc;
    },
    circle: (x, y, r) => {
      formas.push({ tipo: 'circle', x: x - r, y: y - r, ancho: r * 2, alto: r * 2, arriba: y - r, abajo: y + r, izquierda: x - r, derecha: x + r, pagina });
      return doc;
    },

    moveTo: (x, y) => { puntoActual = { x, y }; return doc; },
    lineTo: (x, y) => {
      lineas.push({
        x1: puntoActual ? puntoActual.x : x,
        y1: puntoActual ? puntoActual.y : y,
        x2: x, y2: y, pagina,
      });
      puntoActual = { x, y };
      return doc;
    },

    // openImage se usa en brandStrip.js para leer el tamaño real del PNG y
    // calcular el object-fit a mano. Devolver dimensiones fijas alcanza: lo que
    // se está probando es dónde CAE la franja, no si el logo se ve lindo.
    openImage: (ruta) => ({ ...dimsImagen, ruta }),

    image: (src, x, y, opts = {}) => {
      // fit:[w,h] es una CAJA máxima, no el tamaño dibujado; como cota superior
      // sirve igual para detectar que la imagen invade lo de abajo.
      const ancho = opts.width  ?? (opts.fit ? opts.fit[0] : 50);
      const alto  = opts.height ?? (opts.fit ? opts.fit[1] : 50);
      imagenes.push({
        src: typeof src === 'string' ? src : (src && src.ruta) || '<imagen>',
        x, y, ancho, alto,
        arriba: y, abajo: y + alto, izquierda: x, derecha: x + ancho,
        pagina,
      });
      doc._y = y + alto;
      return doc;
    },

    addPage: () => {
      totalPaginas += 1;
      pagina = totalPaginas - 1;
      doc._y = margenes.top;
      doc._x = margenes.left;
      return doc;
    },
    bufferedPageRange: () => ({ start: 0, count: totalPaginas }),
    switchToPage: (i) => { pagina = i; return doc; },
    flushPages: () => doc,

    on: (evento, cb) => {
      (eventos[evento] || (eventos[evento] = [])).push(cb);
      return doc;
    },
    // Los servicios que arman el PDF en memoria (reportePdfService) resuelven su
    // Promise en el evento 'end'. Sin esto el test se queda esperando para siempre.
    end: () => {
      (eventos.end || []).forEach((cb) => cb());
      return doc;
    },
    emit: (evento, ...args) => {
      (eventos[evento] || []).forEach((cb) => cb(...args));
      return doc;
    },

    text: (contenido, x, y, opts) => {
      // PDFKit acepta text(str, opts) y text(str, x, y) además de la forma
      // completa. Sin normalizar acá, un drawer que use la forma corta anotaría
      // x = {width: ...} y toda la geometría saldría basura sin avisar.
      let px = x, py = y, o = opts;
      if (typeof x === 'object' && x !== null) { o = x; px = doc._x; py = doc._y; }
      else if (typeof y === 'object' && y !== null) { o = y; py = doc._y; }
      o = o || {};

      const texto = String(contenido);
      const anchoCaja = o.width;
      const alto  = doc.heightOfString(texto, { width: anchoCaja ?? Infinity });
      const anchoTexto = doc.widthOfString(texto);
      // Si el texto entra en la caja, su caja REAL es la del texto, no la del
      // ancho declarado. La diferencia importa: en la caja de DATOS DE
      // COTIZACIÓN el rótulo declara 78 pt de ancho y ocupa 45, y el valor
      // arranca en 82 — medirlo por el ancho declarado daría un choque que en
      // el papel no existe.
      const ancho = anchoCaja == null ? anchoTexto : Math.min(anchoCaja, anchoTexto);

      let izquierda = px;
      if (anchoCaja != null && o.align === 'center') izquierda = px + (anchoCaja - ancho) / 2;
      if (anchoCaja != null && o.align === 'right')  izquierda = px + anchoCaja - ancho;

      textos.push({
        contenido: texto,
        x: px, y: py,
        izquierda, derecha: izquierda + ancho,
        arriba: py, abajo: py + alto,
        ancho, alto,
        width: anchoCaja,
        fontSize: doc._fontSize,
        font: doc._font,
        align: o.align || 'left',
        lineas: Math.max(1, Math.round(alto / (doc._fontSize * 1.3))),
        pagina,
      });

      doc._y = py + alto;
      doc._x = px;
      return doc;
    },

    // Simulación de ajuste de línea, no una medida real: sólo necesita ser lo
    // bastante fiel para que un texto corto quepa en una línea y uno largo
    // envuelva a varias — como hace el _calcRowHeight() real que esto imita.
    heightOfString: (contenido, opts = {}) => {
      const width = opts.width ?? Infinity;
      const charW = doc._fontSize * 0.5;
      const palabras = String(contenido).split(' ');
      let lineas2 = 1;
      let anchoLinea = 0;
      for (const palabra of palabras) {
        const w = (palabra.length + 1) * charW;
        if (anchoLinea + w > width && anchoLinea > 0) {
          lineas2 += 1;
          anchoLinea = w;
        } else {
          anchoLinea += w;
        }
      }
      return lineas2 * (doc._fontSize * 1.3);
    },

    // MISMO modelo que heightOfString, a propósito: si midieran distinto,
    // «entra en una línea» según uno y «no entra» según el otro, y las cajas
    // anotadas contradirían a los altos calculados por el propio drawer.
    widthOfString: (contenido) => {
      const charW = doc._fontSize * 0.5;
      return String(contenido)
        .split(' ')
        .reduce((total, palabra) => total + (palabra.length + 1) * charW, 0);
    },

    get y() { return doc._y; },
    set y(v) { doc._y = v; },
    get x() { return doc._x; },
    set x(v) { doc._x = v; },
  };

  // Un método que falte tiene que decir CUÁL falta. Con el objeto pelado el
  // error es «doc.loQueSea is not a function» a treinta líneas de distancia del
  // drawer que lo llamó; así el mensaje nombra el método y qué hacer.
  // Se devuelve una función que explota AL LLAMARLA, no se explota al leer la
  // propiedad: leerla es lo que hacen Jest y console.log todo el tiempo.
  return new Proxy(doc, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return undefined;
      if (PROPIEDADES_DE_SISTEMA.has(prop)) return undefined;
      return () => {
        throw new Error(
          `docFalso no simula doc.${String(prop)}(). Un drawer lo llamó: agregalo `
          + 'en tests/helpers/docFalso.js (si sólo encadena, alcanza con () => doc; '
          + 'si dibuja algo, anotá su geometría).'
        );
      };
    },
  });
}

// =============================================================================
// Utilidades de aserción
// =============================================================================

/** Las anotaciones cuyo texto matchea. Acepta regex o string (subcadena). */
function buscarTexto(doc, patron) {
  const prueba = patron instanceof RegExp
    ? (s) => patron.test(s)
    : (s) => s.includes(String(patron));
  return doc.textos.filter((t) => prueba(t.contenido));
}

/** La primera anotación que matchea, o undefined. Azúcar para el caso común. */
function unTexto(doc, patron) {
  return buscarTexto(doc, patron)[0];
}

/**
 * Pares de textos cuyas cajas se superponen: se pisan verticalmente Y comparten
 * rango horizontal. Las dos condiciones a la vez — dos textos a la misma altura
 * en columnas distintas (el rótulo a la izquierda y el valor a la derecha) no se
 * pisan, y ése es justamente el layout normal de media proforma.
 *
 * @param {Object} doc
 * @param {Object} [op]
 * @param {number} [op.tolerancia=1] — puntos de solape que se dejan pasar. Los
 *   altos salen de un MODELO tipográfico, no de la fuente real, así que un
 *   solape de fracciones de punto es ruido del modelo y no un defecto del PDF.
 * @param {(t)=>boolean} [op.ignorar] — textos que no se miran (por ejemplo los
 *   rótulos de reserva de la franja de marcas).
 * @returns {Array<{a,b,solapeVertical:number,solapeHorizontal:number}>}
 */
function textosQueSePisan(doc, op = {}) {
  const tolerancia = op.tolerancia ?? 1;
  const ignorar = op.ignorar || (() => false);

  const lista = doc.textos.filter((t) => t.contenido.trim() !== '' && !ignorar(t));
  const pares = [];

  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const a = lista[i], b = lista[j];
      // Dos páginas distintas nunca se pisan, por más que compartan coordenadas.
      if (a.pagina !== b.pagina) continue;

      const solapeVertical   = Math.min(a.abajo, b.abajo) - Math.max(a.arriba, b.arriba);
      const solapeHorizontal = Math.min(a.derecha, b.derecha) - Math.max(a.izquierda, b.izquierda);
      if (solapeVertical > tolerancia && solapeHorizontal > tolerancia) {
        pares.push({ a, b, solapeVertical, solapeHorizontal });
      }
    }
  }
  return pares;
}

/** Los choques en texto legible, para que el rojo diga QUÉ se pisó con qué. */
function describirChoques(pares) {
  return pares
    .map(({ a, b, solapeVertical, solapeHorizontal }) =>
      `«${recortar(a.contenido)}» (${a.x.toFixed(1)}, ${a.y.toFixed(1)}) se pisa con `
      + `«${recortar(b.contenido)}» (${b.x.toFixed(1)}, ${b.y.toFixed(1)}) — `
      + `${solapeVertical.toFixed(1)} pt en vertical, ${solapeHorizontal.toFixed(1)} pt en horizontal`)
    .join('\n  ');
}

function recortar(s) {
  return s.length > 48 ? `${s.slice(0, 45)}...` : s;
}

/**
 * La Y máxima que alcanzó el CONTENIDO dibujado: textos e imágenes.
 *
 * Las formas quedan fuera a propósito. Los rectángulos son decoración —fondos
 * de fila, barras de pie, marcos— y varios se dibujan justamente en los bordes
 * de la hoja; incluirlos convertiría a esta medida en «el alto de la página» y
 * dejaría de servir para lo único que se usa: saber dónde termina lo que hay
 * que leer.
 *
 * @param {Object} doc
 * @param {Object} [op]
 * @param {number} [op.pagina] — sólo esa página; por defecto, todas.
 * @param {boolean} [op.incluirImagenes=true]
 */
function alturaUsada(doc, op = {}) {
  const incluirImagenes = op.incluirImagenes !== false;
  const dePagina = (o) => op.pagina == null || o.pagina === op.pagina;

  const fondos = [
    ...doc.textos.filter(dePagina),
    ...(incluirImagenes ? doc.imagenes.filter(dePagina) : []),
  ].map((o) => o.abajo);

  return fondos.length === 0 ? 0 : Math.max(...fondos);
}

module.exports = {
  docFalso,
  buscarTexto,
  unTexto,
  textosQueSePisan,
  describirChoques,
  alturaUsada,
};
