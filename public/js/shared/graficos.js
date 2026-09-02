// =============================================================================
// public/js/shared/graficos.js
// Gráficos dibujados a mano sobre <canvas>. Sin librería.
//
// POR QUÉ SIN LIBRERÍA
// La CSP de la aplicación es `script-src 'self'` (helmet), así que un CDN no
// carga: meter Chart.js significaría copiar ~200 KB dentro de public/js, sin
// paso de compilación que los recorte. Para tres formas —una serie, un anillo y
// una aguja— no compensa. Si algún día hacen falta gráficos de verdad
// (zoom, tooltips, ejes configurables), ahí sí conviene la librería.
//
// LOS COLORES SALEN DE LOS TOKENS
// Nada de hexadecimales acá: se leen de las variables CSS en el momento de
// dibujar. Por eso los gráficos siguen el tema claro/oscuro sin saber que
// existe, y por eso hay que REDIBUJARLOS cuando el tema cambia.
//
// EL BUG DEL CANVAS QUE CRECE — no tocar `preparar()` sin leer esto
// Asignar `canvas.height` REESCRIBE el atributo `height` del elemento. Si la
// altura deseada se vuelve a leer de ese atributo en el siguiente dibujado, se
// realimenta: 200 → 300 → 450… Con una animación de ~60 cuadros por segundo el
// canvas llegó a medir 590 millones de píxeles y estiró la página entera. La
// altura se guarda UNA vez en `data-alto` y de ahí en más se lee de ahí.
// =============================================================================

'use strict';

/** Quien pidió menos movimiento ve el gráfico ya terminado, nunca a medias. */
const SIN_MOVIMIENTO =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * El valor REAL de un token, ya resuelto por el navegador.
 *
 * El respaldo es SIEMPRE una palabra clave de CSS, nunca un color escrito a
 * mano: en este proyecto los colores salen de public/css/tokens.css y de ningún
 * otro lado (lo vigila tests/unit/estilosInline.test.js, con tope CERO). Y el
 * respaldo es a propósito feo — un gráfico que sale gris canta que falta un
 * token, mientras que uno con el amarillo copiado a mano lo disimularía.
 */
function token(nombre, respaldo) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(nombre).trim();
  // Si el navegador devolviera la referencia sin resolver en vez del color,
  // pasársela a canvas lanza SyntaxError y se cae el dibujado entero. Mejor
  // un respaldo.
  if (!v || v.indexOf('var(') === 0) return respaldo;
  return v;
}

/** Suaviza el final del recorrido: un avance lineal se ve mecánico. */
const suavizar = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Anima de 0 a 1 y devuelve una función para cancelar.
 * Cancelar importa: si el tema cambia a mitad de una animación, la anterior
 * seguiría dibujando con los colores viejos encima de la nueva.
 */
function animar(ms, paso) {
  if (SIN_MOVIMIENTO) { paso(1); return () => {}; }
  let id = 0;
  const inicio = performance.now();
  const cuadro = (ahora) => {
    const t = Math.min(1, (ahora - inicio) / ms);
    paso(suavizar(t));
    if (t < 1) id = requestAnimationFrame(cuadro);
  };
  id = requestAnimationFrame(cuadro);
  return () => cancelAnimationFrame(id);
}

/** Ajusta el canvas a su ancho en pantalla y a la densidad del monitor. */
function preparar(canvas) {
  if (!canvas.dataset.alto) {
    canvas.dataset.alto = String(Number(canvas.getAttribute('height')) || 180);
  }
  const h = Number(canvas.dataset.alto);

  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.getBoundingClientRect().width) || 320);

  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  // Reasignar el tamaño BORRA el canvas: sólo se toca si de verdad cambió.
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// ---------------------------------------------------------------------------
// Serie temporal — el monto mes a mes.
// ---------------------------------------------------------------------------
function pintarSerie(canvas, valores, etiquetas, avance) {
  const base = preparar(canvas);
  if (!base || valores.length < 2) return;
  const { ctx, w, h } = base;

  const izq = 46, der = 12, arr = 14, abj = 24;
  const aw = w - izq - der;
  const ah = h - arr - abj;
  const max = Math.max.apply(null, valores) * 1.12 || 1;

  const x = (i) => izq + (aw * i) / (valores.length - 1);
  const y = (v) => arr + ah - (ah * v) / max;

  ctx.strokeStyle = token('--border', 'gray');
  ctx.fillStyle = token('--text-muted', 'gray');
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(izq, yy); ctx.lineTo(w - der, yy); ctx.stroke();
    ctx.fillText(Math.round(v).toLocaleString('es-BO'), izq - 8, yy);
  }

  // El trazo se escribe de izquierda a derecha.
  const hasta = 1 + (valores.length - 1) * avance;
  const enteros = Math.floor(hasta);
  const puntos = [];
  for (let i = 0; i < Math.min(enteros, valores.length); i++) puntos.push([x(i), y(valores[i])]);
  if (enteros < valores.length && enteros > 0) {
    const f = hasta - enteros;
    const a = valores[enteros - 1], b = valores[enteros];
    puntos.push([x(enteros - 1 + f), y(a + (b - a) * f)]);
  }
  if (puntos.length < 2) return;

  const color = token('--clr-marca', 'gray');

  const grad = ctx.createLinearGradient(0, arr, 0, arr + ah);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(puntos[0][0], arr + ah);
  puntos.forEach((p) => ctx.lineTo(p[0], p[1]));
  ctx.lineTo(puntos[puntos.length - 1][0], arr + ah);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  puntos.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();

  const u = puntos[puntos.length - 1];
  ctx.fillStyle = token('--bg-surface', 'black');
  ctx.beginPath(); ctx.arc(u[0], u[1], 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(u[0], u[1], 4.5, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = token('--text-muted', 'gray');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const salto = etiquetas.length > 8 ? 2 : 1;
  etiquetas.forEach((et, i) => {
    if (i % salto === 0) ctx.fillText(et, x(i), arr + ah + 7);
  });
}

/**
 * Dibuja una serie temporal y la re-dibuja sola cuando cambia el ancho o el
 * tema. Devuelve una función para desmontarla.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{etiqueta: string, valor: number}>} datos
 */
export function serieTemporal(canvas, datos) {
  const valores   = datos.map((d) => Number(d.valor) || 0);
  const etiquetas = datos.map((d) => String(d.etiqueta));
  return montar(canvas, (avance) => pintarSerie(canvas, valores, etiquetas, avance), 1000);
}

// ---------------------------------------------------------------------------
// Anillo — el reparto por estado.
// ---------------------------------------------------------------------------
function pintarAnillo(canvas, segmentos, avance) {
  const base = preparar(canvas);
  if (!base) return;
  const { ctx, w, h } = base;

  const cx = w / 2, cy = h / 2;
  const radio = Math.min(w, h) / 2 - 6;
  const grosor = Math.max(12, radio * 0.32);
  const total = segmentos.reduce((s, e) => s + e.valor, 0);
  if (total <= 0) return;

  let ang = -Math.PI / 2;
  const fin = -Math.PI / 2 + Math.PI * 2 * avance;
  segmentos.forEach((e) => {
    const barrido = (e.valor / total) * Math.PI * 2;
    const hasta = Math.min(ang + barrido, fin);
    if (hasta > ang) {
      ctx.strokeStyle = token(e.token, 'gray');
      ctx.lineWidth = grosor;
      ctx.beginPath();
      ctx.arc(cx, cy, radio - grosor / 2, ang, hasta);
      ctx.stroke();
    }
    ang += barrido;
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = token('--text-primary', 'gray');
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillText(String(Math.round(total * avance)), cx, cy + 2);
  ctx.fillStyle = token('--text-muted', 'gray');
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText('TOTAL', cx, cy + 17);
}

/** @param {Array<{etiqueta: string, valor: number, token: string}>} segmentos */
export function anillo(canvas, segmentos) {
  const limpios = segmentos.filter((s) => Number(s.valor) > 0);
  return montar(canvas, (avance) => pintarAnillo(canvas, limpios, avance), 900);
}

// ---------------------------------------------------------------------------
// Aguja — un porcentaje suelto (la conversión).
// ---------------------------------------------------------------------------
function pintarAguja(canvas, pct, avance) {
  const base = preparar(canvas);
  if (!base) return;
  const { ctx, w, h } = base;

  const cx = w / 2, cy = h / 2 + 10;
  const radio = Math.min(w / 2, h) - 14;
  const grosor = Math.max(10, radio * 0.2);
  const desde = Math.PI * 0.78, hasta = Math.PI * 2.22;

  ctx.lineCap = 'round';
  ctx.strokeStyle = token('--bg-raised', 'gray');
  ctx.lineWidth = grosor;
  ctx.beginPath(); ctx.arc(cx, cy, radio, desde, hasta); ctx.stroke();

  const frac = Math.max(0, Math.min(1, pct / 100)) * avance;
  if (frac > 0) {
    ctx.strokeStyle = token('--clr-marca', 'gray');
    ctx.lineWidth = grosor;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, desde, desde + (hasta - desde) * frac);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = token('--text-primary', 'gray');
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillText((pct * avance).toFixed(1) + '%', cx, cy + 2);
}

export function aguja(canvas, porcentaje) {
  const pct = Number(porcentaje) || 0;
  return montar(canvas, (avance) => pintarAguja(canvas, pct, avance), 1100);
}

// ---------------------------------------------------------------------------
// Montaje común: anima al aparecer, redibuja al cambiar de ancho o de tema.
// ---------------------------------------------------------------------------
function montar(canvas, pintar, ms) {
  let cancelar = () => {};

  const redibujar = (animando) => {
    cancelar();
    if (animando) cancelar = animar(ms, pintar);
    else pintar(1);
  };

  let esperando;
  const alRedimensionar = () => {
    clearTimeout(esperando);
    // Sin animación: arrastrar el borde de la ventana no tiene que disparar
    // una animación por cada píxel.
    esperando = setTimeout(() => redibujar(false), 150);
  };
  window.addEventListener('resize', alRedimensionar);

  // El tema se anuncia cambiando data-theme en <html>. Los gráficos leen los
  // tokens al dibujar, así que hay que volver a pintarlos o quedan con los
  // colores del tema anterior.
  const observador = new MutationObserver(() => redibujar(false));
  observador.observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme']
  });

  redibujar(true);

  return () => {
    cancelar();
    clearTimeout(esperando);
    window.removeEventListener('resize', alRedimensionar);
    observador.disconnect();
  };
}

// ---------------------------------------------------------------------------
// Cifras que suben desde cero.
// ---------------------------------------------------------------------------
/**
 * Anima el número de un elemento desde 0 hasta su valor.
 *
 * Se le pasa el FORMATEADOR y no un texto ya armado: así una cifra en
 * bolivianos sigue mostrándose como bolivianos en cada paso, en vez de contar
 * en crudo y recién al final parecerse a lo que va a quedar.
 */
export function contarHasta(el, valor, formatear) {
  const destino = Number(valor);
  const fmt = typeof formatear === 'function'
    ? formatear
    : (v) => Math.round(v).toLocaleString('es-BO');

  if (!isFinite(destino)) return () => {};
  return animar(850, (t) => { el.textContent = fmt(destino * t); });
}
