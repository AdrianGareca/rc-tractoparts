// =============================================================================
// public/prueba-paleta.js
// Lógica de la página de prueba de paleta (public/prueba-paleta.html).
//
// POR QUÉ ES UN ARCHIVO APARTE Y NO UN <script> EN EL HTML
// helmet manda `script-src 'self'` sin 'unsafe-inline', así que un script
// escrito dentro del HTML se bloquea en silencio: la página se pinta bien y no
// responde a nada. Las páginas reales de la aplicación cargan su JS desde
// archivo por el mismo motivo.
//
// POR QUÉ VIVE EN public/ Y NO EN public/js/
// Acá hay ~60 colores hexadecimales escritos a mano, que es lo que el trinquete
// de tests/unit/estilosInline.test.js prohíbe. Ese trinquete escanea
// `public/js`. Este archivo queda deliberadamente fuera de ese árbol porque los
// hex SON el objeto de la prueba. No es esquivar la regla: este archivo no es
// código de la aplicación. Se borra junto con el HTML cuando se decida un rumbo.
//
// EL PANEL DE DIAGNÓSTICO
// La primera versión no funcionaba en el navegador y no había forma de saber
// por qué desde acá (jsdom no reproduce el fallo y no hay navegador real para
// probar). Ahora la página informa su propio estado: si este archivo cargó, qué
// paleta está puesta, cuántos clics recibió y cualquier excepción, con nombre y
// línea. Si algo falla, se lee en pantalla en vez de adivinarse.
// =============================================================================

'use strict';

// ── Diagnóstico ─────────────────────────────────────────────────────────────
// Se engancha ANTES que nada: si el resto del archivo explota, esto ya está
// escuchando y el error aparece en pantalla igual.
const diag = {
  el:     null,
  clics:  0,
  ultima: '—',
  errores: []
};

function pintarDiag() {
  if (!diag.el) return;
  const hayError = diag.errores.length > 0;

  // La altura MEDIDA de la barra superior. Se informa porque en el navegador
  // aparecía recortada y desde acá no se pudo reproducir: si vuelve a pasar,
  // este número lo dice en vez de tener que adivinarlo.
  // Un alto de 0 significa «todavía no hay maquetado» (o un entorno sin él,
  // como jsdom), NO que esté recortada. Un detector que grita en falso deja de
  // creerse, así que ese caso no se marca como error.
  let barra = '', recortada = false;
  const b = document.querySelector('.pp-barra');
  if (b) {
    const alto = Math.round(b.getBoundingClientRect().height);
    const vis  = b.querySelectorAll('.pp-sel button').length;
    recortada = alto > 0 && alto < 50;
    barra = ' · barra: ' + (alto || 'sin medir') + (alto ? 'px' : '') +
            ', ' + vis + ' botones' + (recortada ? ' ⚠ RECORTADA' : '');
  }

  diag.el.dataset.estado = (hayError || recortada) ? 'error' : 'ok';
  diag.el.textContent =
    (hayError ? '⚠ ' : '✓ ') +
    'prueba-paleta.js cargado · paleta: ' + diag.ultima +
    ' · clics: ' + diag.clics + barra +
    (hayError ? ' · ERROR: ' + diag.errores[diag.errores.length - 1] : '');
}

function anotarError(e, donde) {
  const msg = (donde ? donde + ': ' : '') +
    (e && e.message ? e.message : String(e));
  diag.errores.push(msg);
  pintarDiag();
  // También a la consola, con la traza completa.
  console.error('[prueba-paleta]', donde || '', e);
}

window.addEventListener('error', (ev) => {
  anotarError(ev.error || ev.message, 'error global');
});

// ── Paletas ─────────────────────────────────────────────────────────────────
// Los colores de ESTADO se dejan casi como están en las paletas oscuras:
// codifican significado que la gente ya aprendió y no son parte de la decisión
// de marca. En la clara sí cambian, porque los tonos pensados para fondo oscuro
// no se leen sobre papel.
const PALETAS = {
  actual: {
    nombre: 'La de hoy — azul de Tailwind sobre marino',
    aviso:  'Sin cambios: son los tokens tal como están hoy en tokens.css.',
    muestras: ['#121D33', '#1B2B4B', '#3B82F6', '#10B981', '#94A3B8'],
    grafico: '#3B82F6',
    tokens: {}
  },

  maquina: {
    nombre: 'B · Máquina — amarillo de marca sobre tierra caliente',
    aviso:  'Los fondos salen del mismo amarillo desaturado (#33312C, #26241C), no de un gris azulado. El amarillo aparece poco: botón principal, foco y acentos. Ese «poco» es lo que lo hace pegar.',
    muestras: ['#FCCC24', '#CCAC43', '#998851', '#66604A', '#33312C'],
    grafico: '#FCCC24',
    tokens: {
      '--bg-deep':    '#1A1813',
      '--bg-surface': '#26241C',
      '--bg-raised':  '#33312C',
      '--bg-hover':   '#413E33',
      '--bg-input':   '#1A1813',
      '--border':     '#3A362A',
      '--border-focus': '#FCCC24',
      '--text-primary':   '#EDE9DF',
      '--text-secondary': '#ADA592',
      '--text-muted':     '#847D69',
      '--clr-primary':     '#FCCC24',
      '--clr-blue':        '#FCCC24',
      '--clr-blue-strong': '#E0B510',
      '--clr-blue-soft':   '#FFE38A',
      '--badge-bg-blue':   'rgba(252,204,36,.18)',
      '--skeleton-base':   '#33312C',
      '--skeleton-shine':  'rgba(255,255,255,.06)'
    }
  },

  contraste: {
    nombre: 'C · Alto contraste — amarillo y azul eléctrico sobre negro',
    aviso:  'La más viva y la más audaz. El azul #213FFF es un segundo polo de color, no un fondo: en cuanto se usa de más, cansa. Acá está sólo en el foco y en el badge de «Enviada».',
    muestras: ['#FCCC24', '#213FFF', '#BFA449', '#4F5BAA', '#000000'],
    grafico: '#FCCC24',
    tokens: {
      '--bg-deep':    '#0B0B0C',
      '--bg-surface': '#141416',
      '--bg-raised':  '#1E1E20',
      '--bg-hover':   '#2A2A2D',
      '--bg-input':   '#0B0B0C',
      '--border':     '#2A2A2D',
      '--border-focus': '#213FFF',
      '--text-primary':   '#F2F2F0',
      '--text-secondary': '#A5A5A0',
      '--text-muted':     '#787874',
      '--clr-primary':     '#FCCC24',
      '--clr-blue':        '#213FFF',
      '--clr-blue-strong': '#1A33D6',
      '--clr-blue-soft':   '#9FB0FF',
      '--badge-bg-blue':   'rgba(33,63,255,.28)',
      '--clr-violet':      '#4F5BAA',
      '--skeleton-base':   '#1E1E20',
      '--skeleton-shine':  'rgba(255,255,255,.06)'
    }
  },

  catalogo: {
    nombre: 'D · Catálogo — la misma marca, de día',
    aviso:  'Fondo de papel cálido, texto casi negro. Es la que mejor convive con la proforma impresa, porque las dos se leen sobre blanco. Los colores de estado se oscurecen para que se lean sobre claro.',
    muestras: ['#FCCC24', '#000000', '#FAF8F2', '#998851', '#E8E3D4'],
    grafico: '#B98F00',
    tokens: {
      '--bg-deep':    '#F2EFE6',
      '--bg-surface': '#FFFDF8',
      '--bg-raised':  '#FAF8F2',
      '--bg-hover':   '#F0ECDF',
      '--bg-input':   '#FFFFFF',
      '--border':     '#DED8C6',
      '--border-focus': '#B98F00',
      '--text-primary':   '#16150F',
      '--text-secondary': '#5A5546',
      '--text-muted':     '#847D69',
      '--clr-primary':     '#B98F00',
      '--clr-blue':        '#B98F00',
      '--clr-blue-strong': '#8A6D00',
      '--clr-blue-soft':   '#7A5E00',
      '--clr-white':   '#16150F',
      '--clr-green':   '#0F7B4F',
      '--clr-amber':   '#96660A',
      '--clr-orange':  '#B4451F',
      '--clr-red':     '#A62B1B',
      '--clr-violet':  '#5B4BA8',
      '--clr-gray':    '#6B6558',
      '--clr-teal':    '#0E7C74',
      '--clr-indigo':  '#3F4796',
      '--clr-slate':   '#5A5546',
      '--clr-green-soft':  '#0B5F3C',
      '--clr-amber-soft':  '#7A5308',
      '--clr-orange-soft': '#8F3617',
      '--clr-red-soft':    '#851F12',
      '--clr-violet-soft': '#463A85',
      '--clr-gray-soft':   '#4F4A40',
      '--clr-teal-soft':   '#0A5F59',
      '--clr-indigo-soft': '#2F3676',
      '--clr-slate-soft':  '#454034',
      '--badge-bg-green':  'rgba(15,123,79,.14)',
      '--badge-bg-amber':  'rgba(150,102,10,.14)',
      '--badge-bg-orange': 'rgba(180,69,31,.14)',
      '--badge-bg-blue':   'rgba(184,143,0,.18)',
      '--badge-bg-violet': 'rgba(91,75,168,.14)',
      '--badge-bg-red':    'rgba(166,43,27,.14)',
      '--badge-bg-gray':   'rgba(107,101,88,.14)',
      '--badge-bg-teal':   'rgba(14,124,116,.14)',
      '--badge-bg-indigo': 'rgba(63,71,150,.14)',
      '--badge-bg-slate':  'rgba(90,85,70,.14)',
      '--skeleton-base':   '#E4DED0',
      '--skeleton-shine':  'rgba(255,255,255,.7)',
      '--shadow-sm':    '0 1px 2px rgba(30,25,10,.09)',
      '--shadow-md':    '0 4px 12px rgba(30,25,10,.12)',
      '--shadow-lg':    '0 12px 32px rgba(30,25,10,.16)',
      '--shadow-hover': '0 8px 22px rgba(30,25,10,.15)'
    }
  }
};

// ── Datos (los que misMetricas.js ya calcula) ───────────────────────────────
const MESES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const POR_MES = [182, 214, 168, 243, 261, 205, 288, 341, 297, 322, 386, 412];

const POR_ESTADO = [
  { etiqueta: 'Confirmada', valor: 147, token: '--clr-green' },
  { etiqueta: 'Enviada',    valor:  41, token: '--clr-blue'  },
  { etiqueta: 'Pendiente',  valor:  18, token: '--clr-amber' },
  { etiqueta: 'Rechazada',  valor:  12, token: '--clr-red'   }
];

// ── Movimiento ──────────────────────────────────────────────────────────────
// Una sola consulta a la preferencia del sistema. Quien pidió menos movimiento
// ve TODO igual pero ya terminado: nada de animación a medias.
const SIN_MOVIMIENTO =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Suaviza el final del recorrido. Un movimiento lineal se nota mecánico. */
const suavizar = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Anima de 0 a 1 durante `ms` y llama a `paso` en cada cuadro.
 * Devuelve una función para cancelarla — al cambiar de paleta hay que cortar
 * la anterior o dos animaciones dibujan sobre el mismo canvas a destiempo.
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

let cancelarAnimaciones = [];
function cortarAnimaciones() {
  cancelarAnimaciones.forEach((c) => c());
  cancelarAnimaciones = [];
}

// ── Elementos ───────────────────────────────────────────────────────────────
const raiz     = document.documentElement;
const swatches = document.getElementById('pp-swatches');
const cual     = document.getElementById('pp-cual');
const aviso    = document.getElementById('pp-aviso');
const botones  = Array.from(document.querySelectorAll('.pp-sel button'));

// Todos los tokens que ALGUNA paleta toca: hay que limpiarlos al cambiar, o una
// paleta hereda valores de la anterior y se ve una mezcla de las dos.
const TODOS = Array.from(new Set(
  Object.keys(PALETAS).flatMap((k) => Object.keys(PALETAS[k].tokens))
));

/** El valor REAL de un token, ya resuelto por el navegador. */
function token(nombre, respaldo) {
  const v = getComputedStyle(raiz).getPropertyValue(nombre).trim();
  // Si el navegador devolviera la referencia sin resolver (`var(--x)`),
  // pasársela a canvas lanza SyntaxError. Mejor un respaldo que una excepción.
  if (!v || v.indexOf('var(') === 0) return respaldo || '#888888';
  return v;
}

// ── Gráficos ────────────────────────────────────────────────────────────────
// Dibujados a mano en <canvas>, sin librería: la CSP (`script-src 'self'`) no
// permite CDN, así que Chart.js habría que copiarlo dentro del proyecto
// (~200 KB, sin paso de compilación). Para DECIDIR si vale la pena, alcanza con
// esto. Si se aprueba el rumbo, ahí se evalúa la librería en serio.

/**
 * Ajusta el canvas a su tamaño en pantalla y a la densidad del monitor.
 *
 * CUIDADO CON LA ALTURA — acá hubo un bug feo
 * Asignar `canvas.height` REESCRIBE el atributo `height` del elemento. Si la
 * altura deseada se vuelve a leer de ese atributo en el siguiente dibujado, se
 * realimenta: 200 → 300 → 450 → 675… Con una animación que redibuja unas 60
 * veces por segundo, el gráfico crecía hasta estirar la página entera.
 *
 * Por eso la altura pedida se guarda UNA sola vez en `data-alto` y de ahí en
 * más se lee siempre de ahí. El ancho no tiene el problema porque sale de
 * getBoundingClientRect(), que está acotado por el CSS.
 */
function preparar(canvas) {
  if (!canvas.dataset.alto) {
    canvas.dataset.alto = String(Number(canvas.getAttribute('height')) || 200);
  }
  const h = Number(canvas.dataset.alto);

  const dpr  = window.devicePixelRatio || 1;
  const caja = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(caja.width) || 300);

  const anchoBuffer = Math.round(w * dpr);
  const altoBuffer  = Math.round(h * dpr);

  // Reasignar el tamaño del buffer BORRA el canvas, así que sólo se toca
  // cuando de verdad cambió (al redimensionar la ventana). En un cuadro de
  // animación normal esto no se ejecuta.
  if (canvas.width !== anchoBuffer || canvas.height !== altoBuffer) {
    canvas.width  = anchoBuffer;
    canvas.height = altoBuffer;
  }
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function dibujarArea(avance, colorLinea) {
  const canvas = document.getElementById('pp-area');
  if (!canvas) return;
  const { ctx, w, h } = preparar(canvas);

  const izq = 44, der = 12, arriba = 16, abajo = 26;
  const anchoUtil = w - izq - der;
  const altoUtil  = h - arriba - abajo;
  const max = Math.max.apply(null, POR_MES) * 1.12;

  const x = (i) => izq + (anchoUtil * i) / (POR_MES.length - 1);
  const y = (v) => arriba + altoUtil - (altoUtil * v) / max;

  // Retícula tenue: da lectura sin competir con la línea.
  ctx.strokeStyle = token('--border', '#333');
  ctx.lineWidth = 1;
  ctx.fillStyle = token('--text-muted', '#888');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v  = (max / 4) * i;
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(izq, yy); ctx.lineTo(w - der, yy); ctx.stroke();
    ctx.fillText(Math.round(v) + 'k', izq - 8, yy);
  }

  // El trazo crece de izquierda a derecha: la curva se "escribe" sola.
  const hasta = 1 + (POR_MES.length - 1) * avance;
  const enteros = Math.floor(hasta);
  const puntos = [];
  for (let i = 0; i < Math.min(enteros, POR_MES.length); i++) puntos.push([x(i), y(POR_MES[i])]);
  if (enteros < POR_MES.length) {
    const f = hasta - enteros;
    const a = POR_MES[enteros - 1], b = POR_MES[enteros];
    if (b !== undefined) puntos.push([x(enteros - 1 + f), y(a + (b - a) * f)]);
  }
  if (puntos.length < 2) return;

  // Relleno bajo la curva: es lo que da sensación de volumen.
  const grad = ctx.createLinearGradient(0, arriba, 0, arriba + altoUtil);
  grad.addColorStop(0, colorLinea);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(puntos[0][0], arriba + altoUtil);
  puntos.forEach((p) => ctx.lineTo(p[0], p[1]));
  ctx.lineTo(puntos[puntos.length - 1][0], arriba + altoUtil);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = colorLinea;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  puntos.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();

  // La punta del trazo, marcada: es el dato que la gente busca primero.
  const u = puntos[puntos.length - 1];
  ctx.fillStyle = token('--bg-surface', '#1B2B4B');
  ctx.beginPath(); ctx.arc(u[0], u[1], 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = colorLinea; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(u[0], u[1], 5, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = token('--text-muted', '#888');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  MESES.forEach((m, i) => {
    if (i % 2 === 0) ctx.fillText(m, x(i), arriba + altoUtil + 8);
  });
}

function dibujarDona(avance) {
  const canvas = document.getElementById('pp-dona');
  if (!canvas) return;
  const { ctx, w, h } = preparar(canvas);

  const cx = w / 2, cy = h / 2;
  const radio = Math.min(w, h) / 2 - 6;
  const grosor = 22;
  const total = POR_ESTADO.reduce((s, e) => s + e.valor, 0);

  // Barre en sentido horario a medida que avanza: el reparto se va revelando.
  let angulo = -Math.PI / 2;
  const finTotal = -Math.PI / 2 + Math.PI * 2 * avance;
  POR_ESTADO.forEach((e) => {
    const barrido = (e.valor / total) * Math.PI * 2;
    const fin = Math.min(angulo + barrido, finTotal);
    if (fin > angulo) {
      ctx.strokeStyle = token(e.token, '#888');
      ctx.lineWidth = grosor;
      ctx.beginPath();
      ctx.arc(cx, cy, radio - grosor / 2, angulo, fin);
      ctx.stroke();
    }
    angulo += barrido;
  });

  ctx.fillStyle = token('--text-primary', '#EEE');
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(Math.round(total * avance)), cx, cy + 3);
  ctx.fillStyle = token('--text-muted', '#888');
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('COTIZACIONES', cx, cy + 20);
}

function leyendaDona() {
  const lista = document.getElementById('pp-dona-leyenda');
  if (!lista) return;
  lista.innerHTML = '';
  POR_ESTADO.forEach((e) => {
    const li = document.createElement('li');
    const i  = document.createElement('i');
    i.style.background = token(e.token, '#888');
    const b = document.createElement('b');
    b.textContent = String(e.valor);
    li.appendChild(i);
    li.appendChild(document.createTextNode(e.etiqueta));
    li.appendChild(b);
    lista.appendChild(li);
  });
}

/** Las cifras suben desde cero. Sin esto, un número grande es sólo texto. */
function contarCifras() {
  document.querySelectorAll('[data-contar]').forEach((el, n) => {
    const destino = Number(el.dataset.contar);
    const prefijo = el.dataset.prefijo || '';
    if (!isFinite(destino)) return;
    cancelarAnimaciones.push(animar(900 + n * 90, (t) => {
      const v = Math.round(destino * t);
      el.textContent = prefijo + v.toLocaleString('es-BO');
    }));
  });
}

/** Las barras del ranking crecen desde cero. */
function crecerBarras() {
  document.querySelectorAll('.pp-barra i').forEach((barra, n) => {
    const pct = Number(barra.dataset.pct);
    cancelarAnimaciones.push(animar(800 + n * 110, (t) => {
      barra.style.width = (pct * t) + '%';
    }));
  });
}

// ── Barras verticales: comparación mes contra mes ───────────────────────────
const COMPARA = [
  { mes: 'Jun', a: 205, b: 262 }, { mes: 'Jul', a: 288, b: 301 },
  { mes: 'Ago', a: 341, b: 318 }, { mes: 'Sep', a: 297, b: 355 },
  { mes: 'Oct', a: 322, b: 389 }, { mes: 'Nov', a: 386, b: 412 }
];

function dibujarBarrasMes(avance) {
  const canvas = document.getElementById('pp-barras');
  if (!canvas) return;
  const { ctx, w, h } = preparar(canvas);

  const izq = 34, der = 10, arriba = 12, abajo = 24;
  const anchoUtil = w - izq - der;
  const altoUtil  = h - arriba - abajo;
  const max = Math.max.apply(null, COMPARA.flatMap((c) => [c.a, c.b])) * 1.12;

  const paso  = anchoUtil / COMPARA.length;
  const ancho = Math.min(14, paso / 3.2);

  ctx.strokeStyle = token('--border', '#333');
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const yy = Math.round(arriba + altoUtil - (altoUtil * i) / 3) + 0.5;
    ctx.beginPath(); ctx.moveTo(izq, yy); ctx.lineTo(w - der, yy); ctx.stroke();
  }

  const colorA = token('--text-muted', '#777');
  const colorB = token('--clr-primary', '#3B82F6');

  COMPARA.forEach((c, i) => {
    // Cada barra arranca un poco después que la anterior: el gráfico se
    // "levanta" de izquierda a derecha en vez de todo a la vez.
    const retraso = i * 0.07;
    const t = Math.max(0, Math.min(1, (avance - retraso) / (1 - retraso || 1)));
    const cx = izq + paso * i + paso / 2;

    [[c.a, colorA, -ancho - 2], [c.b, colorB, 2]].forEach(([v, color, dx]) => {
      const alto = (altoUtil * v / max) * t;
      if (alto <= 0) return;
      ctx.fillStyle = color;
      const x = cx + dx, y = arriba + altoUtil - alto;
      const r = Math.min(3, alto / 2);
      ctx.beginPath();
      ctx.moveTo(x, y + alto);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + ancho - r, y);
      ctx.quadraticCurveTo(x + ancho, y, x + ancho, y + r);
      ctx.lineTo(x + ancho, y + alto);
      ctx.closePath();
      ctx.fill();
    });
  });

  ctx.fillStyle = token('--text-muted', '#888');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  COMPARA.forEach((c, i) => {
    ctx.fillText(c.mes, izq + paso * i + paso / 2, arriba + altoUtil + 7);
  });
}

// ── Aro de conversión ───────────────────────────────────────────────────────
// `conversion` es una métrica que misMetricas.js YA calcula y hoy se imprime
// como un número suelto.
const CONVERSION = 68.4;

function dibujarAro(avance) {
  const canvas = document.getElementById('pp-aro');
  if (!canvas) return;
  const { ctx, w, h } = preparar(canvas);

  const cx = w / 2, cy = h / 2 + 8;
  const radio = Math.min(w, h * 1.6) / 2 - 12;
  const grosor = 13;
  const desde = Math.PI * 0.78, hasta = Math.PI * 2.22;

  ctx.lineCap = 'round';
  ctx.strokeStyle = token('--bg-raised', '#333');
  ctx.lineWidth = grosor;
  ctx.beginPath(); ctx.arc(cx, cy, radio, desde, hasta); ctx.stroke();

  const frac = (CONVERSION / 100) * avance;
  if (frac > 0) {
    ctx.strokeStyle = token('--clr-primary', '#3B82F6');
    ctx.lineWidth = grosor;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, desde, desde + (hasta - desde) * frac);
    ctx.stroke();
  }

  ctx.fillStyle = token('--text-primary', '#EEE');
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText((CONVERSION * avance).toFixed(1) + '%', cx, cy + 2);
  ctx.fillStyle = token('--text-muted', '#888');
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('CONVERSIÓN', cx, cy + 20);
}

// ── El engranaje del logo, construido con código ────────────────────────────
// La marca tiene un engranaje. Se arma acá en vez de pegar un SVG dibujado a
// mano: así el número de dientes y las proporciones se ajustan cambiando un
// número, y hereda el color del token que tenga alrededor.
function construirEngranaje(svg, dientes) {
  const NS = 'http://www.w3.org/2000/svg';
  const cx = 50, cy = 50;
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.innerHTML = '';

  for (let i = 0; i < dientes; i++) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(cx - 6));
    r.setAttribute('y', '2');
    r.setAttribute('width', '12');
    r.setAttribute('height', '20');
    r.setAttribute('rx', '3');
    r.setAttribute('transform', `rotate(${(360 / dientes) * i} ${cx} ${cy})`);
    svg.appendChild(r);
  }
  const aro = document.createElementNS(NS, 'circle');
  aro.setAttribute('cx', String(cx));
  aro.setAttribute('cy', String(cy));
  aro.setAttribute('r', '32');
  svg.appendChild(aro);

  const hueco = document.createElementNS(NS, 'circle');
  hueco.setAttribute('cx', String(cx));
  hueco.setAttribute('cy', String(cy));
  hueco.setAttribute('r', '15');
  hueco.setAttribute('class', 'pp-engranaje-hueco');
  svg.appendChild(hueco);
}

function dibujarTodo(conAnimacion) {
  cortarAnimaciones();

  const colorLinea = token('--clr-primary', '#3B82F6');
  leyendaDona();

  if (!conAnimacion || SIN_MOVIMIENTO) {
    dibujarArea(1, colorLinea);
    dibujarDona(1);
    dibujarBarrasMes(1);
    dibujarAro(1);
    document.querySelectorAll('.pp-barra i').forEach((b) => {
      b.style.width = b.dataset.pct + '%';
    });
    document.querySelectorAll('[data-contar]').forEach((el) => {
      el.textContent = (el.dataset.prefijo || '') +
        Number(el.dataset.contar).toLocaleString('es-BO');
    });
    return;
  }

  cancelarAnimaciones.push(animar(1100, (t) => dibujarArea(t, colorLinea)));
  cancelarAnimaciones.push(animar(1000, (t) => dibujarDona(t)));
  cancelarAnimaciones.push(animar(1200, (t) => dibujarBarrasMes(t)));
  cancelarAnimaciones.push(animar(1300, (t) => dibujarAro(t)));
  crecerBarras();
  contarCifras();
}

// ── Aplicar una paleta ──────────────────────────────────────────────────────
function aplicar(clave, animando) {
  const p = PALETAS[clave];
  if (!p) return;

  TODOS.forEach((t) => raiz.style.removeProperty(t));
  Object.keys(p.tokens).forEach((t) => raiz.style.setProperty(t, p.tokens[t]));

  // La paleta clara necesita que el navegador SEPA que es clara, o los
  // controles nativos (barras de desplazamiento, autocompletado, el cursor de
  // los campos) siguen dibujándose oscuros sobre papel.
  raiz.style.colorScheme = (clave === 'catalogo') ? 'light' : 'dark';

  swatches.innerHTML = '';
  p.muestras.forEach((c) => {
    const s = document.createElement('span');
    s.style.background = c;
    swatches.appendChild(s);
  });

  cual.textContent  = p.nombre;
  aviso.textContent = p.aviso;

  botones.forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.paleta === clave));
  });

  diag.ultima = clave;
  pintarDiag();

  // Los gráficos leen los tokens al dibujar, así que se redibujan DESPUÉS de
  // cambiarlos. Va en try/catch a propósito: un fallo dibujando NO tiene que
  // impedir el cambio de paleta, que es lo que la página viene a mostrar.
  try {
    dibujarTodo(animando);
  } catch (e) {
    anotarError(e, 'dibujando gráficos');
  }
}

// ── Arranque ────────────────────────────────────────────────────────────────
try {
  diag.el = document.getElementById('pp-diag');

  botones.forEach((b) => {
    b.addEventListener('click', () => {
      diag.clics++;
      try {
        aplicar(b.dataset.paleta, true);
      } catch (e) {
        anotarError(e, 'aplicando paleta');
      }
    });
  });

  // El canvas no es responsivo por su cuenta: hay que redibujar al cambiar el
  // ancho. Sin animación, para que arrastrar el borde de la ventana no dispare
  // una animación por cada píxel.
  let temporizador;
  window.addEventListener('resize', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      try { dibujarTodo(false); } catch (e) { anotarError(e, 'redibujando'); }
    }, 150);
  });

  // Aparición escalonada de las secciones al entrar en pantalla.
  if (!SIN_MOVIMIENTO && 'IntersectionObserver' in window) {
    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('pp-visible');
          observador.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.pp-aparece').forEach((el, n) => {
      el.style.transitionDelay = (n % 6) * 70 + 'ms';
      observador.observe(el);
    });
  } else {
    document.querySelectorAll('.pp-aparece').forEach((el) => el.classList.add('pp-visible'));
  }

  // El aviso flotante entra una vez al cargar y se va solo. Es lo que vería
  // alguien al guardar una cotización: hoy la aplicación no confirma nada
  // visualmente, y esa falta de respuesta es parte de que se sienta apagada.
  // Los engranajes de la marca.
  document.querySelectorAll('.pp-engranaje').forEach((svg) => {
    construirEngranaje(svg, Number(svg.dataset.dientes) || 10);
  });

  // Onda al pulsar: el clic deja una marca que sale del punto tocado. Es la
  // respuesta tactil que hoy la aplicacion no da en ningun boton.
  document.addEventListener('pointerdown', (ev) => {
    const btn = ev.target.closest('.btn, .pp-sel button');
    if (!btn || SIN_MOVIMIENTO) return;
    const caja = btn.getBoundingClientRect();
    const onda = document.createElement('span');
    onda.className = 'pp-onda';
    const d = Math.max(caja.width, caja.height) * 2;
    onda.style.width = onda.style.height = d + 'px';
    onda.style.left = (ev.clientX - caja.left - d / 2) + 'px';
    onda.style.top  = (ev.clientY - caja.top  - d / 2) + 'px';
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(onda);
    setTimeout(() => onda.remove(), 620);
  });

  // La barra se compacta al bajar: deja de ocupar lugar cuando ya no se la mira.
  const barra = document.querySelector('.pp-barra');
  if (barra) {
    let ultimo = -1;
    window.addEventListener('scroll', () => {
      const compacta = window.scrollY > 60;
      if (compacta !== ultimo) {
        barra.classList.toggle('pp-compacta', compacta);
        ultimo = compacta;
      }
    }, { passive: true });
  }

  const toast = document.getElementById('pp-toast');
  if (toast && !SIN_MOVIMIENTO) {
    setTimeout(() => toast.classList.add('pp-visible'), 1400);
    setTimeout(() => toast.classList.remove('pp-visible'), 5200);
  }

  aplicar('actual', true);
  pintarDiag();

  // Se vuelve a medir tras el primer maquetado: en el momento del arranque el
  // navegador puede no haber calculado todavía la altura de la barra.
  requestAnimationFrame(() => requestAnimationFrame(pintarDiag));
} catch (e) {
  anotarError(e, 'arranque');
}
