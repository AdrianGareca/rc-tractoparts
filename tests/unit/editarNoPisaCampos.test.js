// =============================================================================
// tests/unit/editarNoPisaCampos.test.js
// Editar una parte no borra el resto.
//
// EL BUG, QUE YA HABÍA PASADO UNA VEZ
// En cotizaciones, el esquema de actualización reusaba el de creación, donde
// `moneda` lleva `.default('BOB')`. Zod rellena los `.default()` cuando el campo
// NO viene, y `validate()` reemplaza `req.body` con el resultado — así que el
// controlador recibía siempre un valor y su respaldo `|| existente.moneda` era
// código muerto.
//
// Consecuencia real: una cotización en dólares editada sin tocar la moneda
// pasaba a bolivianos, y el PDF que recibía el cliente salía con el importe en
// la moneda equivocada y la cuenta bancaria de la otra entidad.
//
// Ese se arregló. Después apareció EL MISMO esquema en licitaciones:
//
//     const updateLicitacionSchema = z.object(licitacionShape);
//
// con el mismo `.default('BOB')` adentro, y el mismo controlador que escribe
// todos los campos aunque no hayan venido. Una licitación presupuestada en
// dólares se convierte en bolivianos, y de paso se borran la descripción, el
// presupuesto y la fecha límite.
//
// POR QUÉ NO SE NOTA
// La pantalla del sistema manda SIEMPRE los seis campos, así que por ahí no
// pasa. Se dispara con cualquier cliente que mande una actualización parcial —
// que es lo normal en una API REST, y lo que hace cualquiera que integre algo
// contra ella.
//
// LA GUARDIA
// El último bloque recorre TODOS los validadores y prohíbe `.default()` en
// cualquier esquema de actualización. Es la forma que tiene el error, no el
// caso: así no aparece una tercera vez en el próximo módulo.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { updateLicitacionSchema } = require('../../src/validators/licitacionValidator');
const { updateQuotationSchema }  = require('../../src/validators/quotationValidator');

const RAIZ = path.resolve(__dirname, '../../src/validators');

// ---------------------------------------------------------------------------
describe('una edición parcial de licitación no inventa valores', () => {
  /** Lo mínimo que el esquema exige: nombre y cliente. */
  const MINIMO = { nombre: 'Provisión de repuestos 2026', id_cliente: 42 };

  test('sin moneda, NO la rellena con BOB', () => {
    // Éste es el que rompe datos: la licitación estaba en dólares y el esquema
    // la devuelve en bolivianos sin que nadie lo haya pedido.
    const res = updateLicitacionSchema.safeParse(MINIMO);
    expect(res.success).toBe(true);
    expect(res.data.moneda).toBeUndefined();
  });

  test('sin descripción, no la devuelve como null', () => {
    // `undefined` significa «no lo toques»; `null` significa «borralo». El
    // controlador tiene que poder distinguirlos, y para eso el validador no
    // puede convertir uno en otro.
    const res = updateLicitacionSchema.safeParse(MINIMO);
    expect('descripcion' in res.data).toBe(false);
  });

  test('sin presupuesto ni fecha límite, tampoco', () => {
    const res = updateLicitacionSchema.safeParse(MINIMO);
    expect('presupuesto_referencial' in res.data).toBe(false);
    expect('fecha_limite' in res.data).toBe(false);
  });

  test('lo que SÍ se manda se respeta', () => {
    const res = updateLicitacionSchema.safeParse({
      ...MINIMO,
      moneda: 'USD',
      presupuesto_referencial: 150000,
      descripcion: 'Repuestos de tren de rodaje',
    });
    expect(res.success).toBe(true);
    expect(res.data.moneda).toBe('USD');
    expect(res.data.presupuesto_referencial).toBe(150000);
    expect(res.data.descripcion).toBe('Repuestos de tren de rodaje');
  });

  test('un null explícito sigue significando «borralo»', () => {
    // La diferencia con el caso de arriba: acá el cliente PIDIÓ vaciarlo.
    const res = updateLicitacionSchema.safeParse({ ...MINIMO, descripcion: null });
    expect(res.success).toBe(true);
    expect(res.data.descripcion).toBeNull();
  });

  test('una moneda inválida se sigue rechazando', () => {
    const res = updateLicitacionSchema.safeParse({ ...MINIMO, moneda: 'EUR' });
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('el de cotizaciones, que fue el primero, sigue arreglado', () => {
  // Este esquema exige cliente, fecha y detalles: son los datos sin los cuales
  // una cotizacion no es una cotizacion. Lo que se prueba es que MONEDA y
  // ENTIDAD EMISORA, que no vienen, tampoco se inventen.
  const MINIMO = {
    id_cliente: 1,
    descripcion: 'Cotizacion de prueba',
    fecha_emision: '2026-08-17',
    detalles: [{ descripcion_item: 'Filtro', cantidad: 1, precio_unitario: 10 }],
  };

  test('sin moneda no la rellena', () => {
    const res = updateQuotationSchema.safeParse(MINIMO);
    expect(res.success).toBe(true);
    expect(res.data.moneda).toBeUndefined();
  });

  test('sin entidad emisora tampoco', () => {
    // La entidad emisora decide QUÉ CUENTA BANCARIA se imprime en el PDF.
    const res = updateQuotationSchema.safeParse(MINIMO);
    expect(res.data.entidad_emisora).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('nadie pone un .default() en un esquema de actualización', () => {
  // La guardia general. Vigila la FORMA del error, no los dos casos conocidos:
  // el bug ya apareció dos veces en dos módulos distintos, así que la tercera
  // es cuestión de tiempo.
  test('ningún updateXSchema construye sobre una forma con .default()', () => {
    const archivos = fs.readdirSync(RAIZ).filter((f) => f.endsWith('.js'));
    const culpables = [];

    /**
     * Saca los comentarios antes de buscar.
     *
     * SIN ESTO EL GUARDIA SE ACUSA A SÍ MISMO: el comentario que explica el
     * arreglo dice «sin .default()», y el detector lo lee como si fuera código.
     * Un guardián que se dispara con su propia documentación enseña a la gente
     * que ponerse rojo puede no significar nada — que es lo peor que le puede
     * pasar a una suite.
     */
    const sinComentarios = (src) => src
      .split(String.fromCharCode(10))
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join(String.fromCharCode(10));

    for (const archivo of archivos) {
      const texto = sinComentarios(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'));

      // Cada `const updateAlgoSchema = ...` y lo que le sigue hasta el `;`
      // final de la declaración.
      for (const m of texto.matchAll(/const\s+(update\w*Schema)\s*=([\s\S]*?)\n\n/g)) {
        const [, nombre, cuerpo] = m;

        // Un `.default()` DENTRO de la propia declaración es el caso directo.
        if (/\.default\(/.test(cuerpo)) {
          culpables.push(`${archivo} — ${nombre} usa .default() directamente`);
          continue;
        }

        // El caso indirecto, que es el que se coló las dos veces: hereda una
        // forma compartida que lo trae. Se acusa solo si esa forma tiene
        // `.default()` y el esquema no lo anula con un `.extend()`.
        const heredada = cuerpo.match(/z\.object\((\w+)\)/);
        if (heredada && !/\.extend\(/.test(cuerpo)) {
          const forma = texto.match(
            new RegExp(`const\\s+${heredada[1]}\\s*=[\\s\\S]*?\\n\\};`)
          );
          if (forma && /\.default\(/.test(forma[0])) {
            culpables.push(
              `${archivo} — ${nombre} hereda ${heredada[1]}, que trae .default()`
            );
          }
        }
      }
    }

    if (culpables.length > 0) {
      throw new Error(
        'Estos esquemas de actualización rellenan campos que el cliente no mandó:\n  ' +
        culpables.join('\n  ') +
        '\n\nZod completa los .default() cuando el campo NO viene, y validate() ' +
        'reemplaza req.body con el resultado — así que el controlador nunca puede ' +
        'distinguir «no lo toques» de «ponelo en este valor». Una edición parcial ' +
        'termina pisando datos que nadie pidió cambiar.\n\n' +
        'Solución: .extend() sobre la forma compartida, redeclarando esos campos ' +
        'como .optional() sin .default().'
      );
    }

    expect(culpables).toEqual([]);
  });
});
