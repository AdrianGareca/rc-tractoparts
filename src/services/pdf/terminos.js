// =============================================================================
// src/services/pdf/terminos.js
// El TEXTO de las Condiciones Generales de la Oferta.
//
// POR QUÉ ESTÁ SEPARADO DEL DIBUJANTE
// Esto es texto legal redactado por la abogada de la empresa, no contenido de
// la aplicación. Vive en su propio archivo para que se pueda comprobar palabra
// por palabra contra el original (tests/unit/pdfTerminos.test.js) sin que la
// prueba tenga que atravesar la maquinaria de dibujo del PDF.
//
// Si alguna vez hay que cambiar una cláusula, se cambia ACÁ y la prueba avisa
// que el texto ya no coincide con el que se aprobó. Ese rojo es el punto: un
// cambio en las condiciones que salen impresas al cliente tiene que ser una
// decisión consciente, no un renglón que se coló en otro commit.
//
// EL MARCADOR {EMISOR}
// El documento original de la abogada nombra a «ROCA IMPORTACIONES S.R.L.»
// quince veces. Pero el sistema emite cotizaciones con DOS entidades distintas
// (ver bankData.js), y la predeterminada es la empresa unipersonal — así que
// pegar el nombre fijo haría que la mayoría de las cotizaciones saliera con
// condiciones que obligan a otra persona jurídica.
//
// Por eso el nombre no se escribe: se marca con {EMISOR} y lo reemplaza
// textoClausula() con la entidad que emite esa cotización.
// =============================================================================

'use strict';

// El marcador que se sustituye por la razón social de quien emite. Se exporta
// para que la prueba pueda verificar que ninguna cláusula trae un nombre de
// empresa escrito a mano.
const MARCADOR_EMISOR = '{EMISOR}';

// Las 24 cláusulas, en el orden del documento original. Cada una es
// [título, cuerpo]: el título se imprime en negrita seguido del cuerpo, igual
// que en el papel que redactó la abogada.
const CLAUSULAS = Object.freeze([
  ['Vigencia de la Oferta', 'La presente oferta tendrá una vigencia de tres (3) días calendario desde su emisión. Vencido dicho plazo sin aceptación escrita, deberá solicitarse una nueva cotización.'],
  ['Aceptación de la Oferta', 'La emisión de una orden de compra, contrato, correo electrónico o cualquier aceptación escrita implicará la aceptación íntegra de la presente oferta y de estas Condiciones Generales.'],
  ['Alcance', 'La oferta comprende únicamente los bienes y/o servicios expresamente descritos en la proforma.'],
  ['Precios', 'Los precios cotizados podrán ser modificados antes de la aceptación de la oferta cuando existan variaciones extraordinarias en el tipo de cambio, costos de importación, transporte, tributos, aranceles o condiciones del mercado.'],
  ['Moneda de Pago', 'Los pagos deberán efectuarse en la moneda cotizada o conforme a las condiciones comerciales establecidas en la oferta.'],
  ['Forma de Pago', 'El incumplimiento de las condiciones de pago suspenderá las obligaciones de suministro hasta su regularización.'],
  ['Inicio del Plazo', 'El plazo de entrega comenzará a computarse una vez cumplidas todas las condiciones comerciales, técnicas, documentales y de pago establecidas.'],
  ['Plazos de Entrega', `Los plazos de entrega son referenciales y podrán modificarse por causas no atribuibles a ${MARCADOR_EMISOR}.`],
  ['Fuerza Mayor', `${MARCADOR_EMISOR} no será responsable por retrasos ocasionados por fuerza mayor, caso fortuito o hechos fuera de su control.`],
  ['Causas Ajenas', 'Se consideran causas ajenas, entre otras, retrasos de fabricantes, proveedores, transporte, navieras, aerolíneas, aduanas, autoridades, conflictos laborales, restricciones comerciales o disponibilidad en origen.'],
  ['Disponibilidad', 'La disponibilidad de los bienes estará sujeta a confirmación al momento de la aceptación del pedido.'],
  ['Suspensión de Plazos', 'Los plazos de entrega quedarán suspendidos cuando el cliente no proporcione oportunamente información, documentación, aprobaciones, autorizaciones o pagos requeridos.'],
  ['Recepción', 'El cliente deberá verificar los bienes al momento de su recepción. La recepción sin observaciones constituirá aceptación de los bienes.'],
  ['Garantía', 'La garantía cubre únicamente defectos de fabricación y se sujetará a las condiciones del fabricante.'],
  ['Exclusiones de Garantía', 'La garantía no cubre daños ocasionados por instalación incorrecta, uso inadecuado, modificaciones, reparaciones no autorizadas, negligencia o desgaste normal.'],
  ['Reserva de Propiedad', `La propiedad de los bienes permanecerá en ${MARCADOR_EMISOR} hasta el pago total del precio.`],
  ['Cancelación del Pedido', `La cancelación o desistimiento imputable al cliente facultará a ${MARCADOR_EMISOR} a cobrar los costos y gastos efectivamente incurridos.`],
  ['Almacenaje', 'Cuando los bienes no sean retirados o recibidos oportunamente por causas atribuibles al cliente, podrán generarse gastos de almacenaje, manipuleo y custodia.'],
  ['Modificaciones', `Ninguna modificación de la presente oferta tendrá validez si no consta por escrito y cuenta con la aceptación expresa de ${MARCADOR_EMISOR}.`],
  ['Errores Materiales', `${MARCADOR_EMISOR} podrá corregir errores tipográficos, aritméticos o materiales contenidos en la oferta antes de su aceptación.`],
  ['Confidencialidad', `La información contenida en la presente oferta es confidencial y no podrá ser reproducida, divulgada o utilizada sin autorización escrita de ${MARCADOR_EMISOR}.`],
  ['Cesión', `El cliente no podrá ceder los derechos u obligaciones derivados de la presente oferta sin autorización escrita de ${MARCADOR_EMISOR}.`],
  ['Prelación Documental', `Las presentes Condiciones Generales forman parte integrante de la oferta y prevalecerán sobre cualquier condición de compra del cliente, salvo aceptación expresa y escrita de ${MARCADOR_EMISOR}.`],
  ['Legislación Aplicable', 'La presente oferta se regirá por las leyes del Estado Plurinacional de Bolivia.'],
].map(Object.freeze));

const TITULO_TERMINOS = 'CONDICIONES GENERALES DE LA OFERTA';

// ---------------------------------------------------------------------------
// textoClausula — cambia {EMISOR} por la razón social de quien emite.
//
// Va en MAYÚSCULAS como en el documento original, donde el nombre de la parte
// se destaca del resto de la frase.
// ---------------------------------------------------------------------------
function textoClausula(cuerpo, emisor) {
  const nombre = String(emisor || '').trim().toUpperCase();
  return String(cuerpo).split(MARCADOR_EMISOR).join(nombre);
}

module.exports = { CLAUSULAS, TITULO_TERMINOS, MARCADOR_EMISOR, textoClausula };
