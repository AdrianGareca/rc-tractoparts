// =============================================================================
// public/js/shared/quotationTotals.js
// SINGLE source of truth for the quotation form's money math (browser side).
//
// Mirrors the backend's src/utils/quotationTotals.js EXACTLY: round each line to
// 2 decimals BEFORE summing (round-per-line-then-sum). Keeping the browser
// preview identical to the server's stored monto_total prevents the on-screen
// total from silently disagreeing with what gets saved by a rounding cent — a
// real bug that shipped when the form summed raw products and rounded only once.
//
// A cross-check unit test (tests/unit/quotationTotalsFront.test.js) asserts this
// module and the backend produce the same total for every valid input, so the
// two can never drift apart again.
// =============================================================================

/** Round a number to 2 decimals (monetary precision). Non-finite → 0. */
export function round2(n) {
  // `Number()` y no `parseFloat()` acá a propósito: parseFloat('12abc') da 12,
  // y un campo con basura debe caer a 0 y no colarse como un importe válido.
  const x = Number(n);

  // El no-finito cae a 0 en vez de propagar NaN: un solo NaN en una fila
  // contaminaría el total entero y la pantalla mostraría «NaN» donde va la
  // plata. Cero es incorrecto también, pero se ve y se corrige; NaN paraliza.
  if (!Number.isFinite(x)) return 0;

  // ── El medio centavo va PARA ARRIBA, como en toda factura ──────────────────
  // Acá había `parseFloat(x.toFixed(2))`, y toFixed no es una función de
  // redondeo monetario: trabaja sobre el número binario que realmente guarda la
  // máquina, no sobre el decimal que la persona escribió.
  //
  //     (49.995).toFixed(2)  ===  '49.99'   y debería ser 50.00
  //     (1.005).toFixed(2)   ===  '1.00'    y debería ser 1.01
  //
  // El binario más cercano a 49.995 es 49.994999999999998863…, o sea un pelo
  // por debajo. Math.round(x * 100) / 100 tampoco sirve: mueve el error de
  // lugar, porque 1.005 * 100 da 100.49999999999999.
  //
  // toPrecision(15) borra ese ruido —un `double` guarda entre 15 y 17 dígitos
  // significativos confiables— y devuelve el decimal que se tecleó. Recién ahí
  // se redondea.
  //
  // ES LA MISMA CUENTA que redondearCentavos() en src/utils/quotationTotals.js,
  // y tiene que seguir siéndolo: acá se calcula lo que el vendedor VE mientras
  // carga, allá lo que se GUARDA y se imprime. Si difieren, el vendedor arma la
  // cotización mirando un total y el cliente recibe un PDF con otro.
  // Lo exige tests/unit/redondeoDeCentavos.test.js.
  return Math.round(Number((x * 100).toPrecision(15))) / 100;
}

/**
 * Live-preview subtotal: round each line to 2 decimals, THEN sum, THEN round the
 * total — the exact order the backend uses. Non-throwing so a half-typed row
 * (empty/NaN quantity or price) contributes 0 instead of breaking the preview.
 * @param {Array<{cantidad:*, precio_unitario:*}>} items
 * @returns {number}
 */
export function sumSubtotals(items) {
  // Guarda de entrada: el formulario puede llamar antes de que el Subject se
  // haya inicializado, y `undefined.reduce` rompería la vista previa entera.
  if (!Array.isArray(items)) return 0;

  const total = items.reduce((acc, it) => {
    // `it?.` porque una fila recién agregada puede ser null mientras el usuario
    // todavía no escribió nada en ella.
    const q = parseFloat(it?.cantidad);
    const p = parseFloat(it?.precio_unitario);

    // Fila que todavía no es un importe: se saltea devolviendo el acumulador
    // intacto. Nótese `p < 0` y no `p <= 0`: un repuesto bonificado a precio
    // cero es un caso real del negocio y tiene que poder cotizarse.
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) return acc;

    // EL ORDEN ES LA REGLA: se redondea CADA línea antes de sumar.
    //
    // Sumar los productos crudos y redondear una sola vez al final da un
    // resultado distinto —por centavos— del que guarda el backend, que redondea
    // por línea. Ese desacuerdo ya se produjo una vez: la pantalla mostraba un
    // total y la proforma impresa salía con otro. El cliente ve los dos.
    return acc + round2(q * p);
  }, 0);

  // Se vuelve a redondear el acumulado: sumar cien valores ya redondeados
  // igual arrastra el error binario del punto flotante (0.1 + 0.2 no da 0.3).
  return round2(total);
}

/**
 * A manual cash discount is only ever a positive reduction. Negative or NaN → 0,
 * matching the submit rule (`discountRaw > 0 ? discountRaw : null`) so the live
 * preview can never show a total LARGER than the subtotal.
 * @param {*} raw
 * @returns {number}
 */
export function clampDiscount(raw) {
  const d = parseFloat(raw);

  // Estrictamente `> 0`, así que un descuento negativo cae a 0 en vez de
  // restarse en negativo — que sería SUMARLE al total. Un cero tipeado por
  // error tampoco es un descuento, y cae igual.
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/**
 * Final total shown/saved: subtotal minus the clamped discount, never below 0.
 * @param {number} subtotal
 * @param {*} discountRaw
 * @returns {number}
 */
export function computeTotal(subtotal, discountRaw) {
  return round2(          // 4. y se vuelve a redondear: la resta reintroduce error binario
    Math.max(0,           // 3. nunca por debajo de cero: un descuento mayor al subtotal
                          //    daría un total negativo, y una proforma en negativo es
                          //    una nota de crédito, que este sistema no emite
      round2(subtotal)    // 1. se normaliza el subtotal por si llega sin redondear
      - clampDiscount(discountRaw)  // 2. el descuento ya viene saneado y positivo
    )
  );
}

/**
 * Validate a submittable line item (one that carries a description). cantidad
 * must be > 0 and precio_unitario >= 0 — the same rule the backend Zod schema
 * enforces, surfaced client-side so the user gets immediate per-field feedback.
 * @param {{cantidad:*, precio_unitario:*}} item
 * @returns {Array<{field:string, message:string}>} empty when valid
 */
export function validateDetalle(item) {
  const errors = [];
  const q = parseFloat(item?.cantidad);
  const p = parseFloat(item?.precio_unitario);
  if (!Number.isFinite(q) || q <= 0) {
    errors.push({ field: 'cantidad', message: 'La cantidad debe ser mayor a 0.' });
  }
  if (!Number.isFinite(p) || p < 0) {
    errors.push({ field: 'precio_unitario', message: 'El precio no puede ser negativo.' });
  }
  return errors;
}
