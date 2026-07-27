// =============================================================================
// tests/unit/quotationFilters.test.js
// Red de seguridad del parseo de filtros de GET /api/cotizaciones.
//
// Son ~90 líneas de validación que no tenían ningún test. Lo que protegen no es
// cosmético: los valores que pasan de acá van directo al array de parámetros del
// prepared statement, y `sort_by` se interpola en el ORDER BY — por eso la lista
// blanca de claves de orden es la barrera contra inyección SQL en ese punto.
// =============================================================================

'use strict';

const {
  parseQuotationFilters,
  VALID_SORT_KEYS,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} = require('../../src/controllers/quotation/quotationFilters');

describe('parseQuotationFilters — sin filtros', () => {
  test('una query vacía da filtros vacíos y los valores por defecto', () => {
    const r = parseQuotationFilters({});

    expect(r.error).toBeUndefined();
    expect(r.filters).toEqual({});
    expect(r.pagination).toEqual({ page: 1, limit: DEFAULT_LIMIT });
    expect(r.sort).toEqual({ by: 'creado_en', order: 'DESC' });
  });

  test('sin argumentos tampoco rompe', () => {
    expect(parseQuotationFilters().error).toBeUndefined();
  });
});

describe('parseQuotationFilters — búsqueda de texto', () => {
  test('pasa q, razon_social y nit como string', () => {
    const { filters } = parseQuotationFilters({ q: 'filtro', razon_social: 'Minera', nit: '102345' });

    expect(filters).toEqual({ q: 'filtro', razon_social: 'Minera', nit: '102345' });
  });

  test('los textos vacíos no generan filtro', () => {
    expect(parseQuotationFilters({ q: '', razon_social: '', nit: '' }).filters).toEqual({});
  });
});

describe('parseQuotationFilters — estado', () => {
  test('acepta un estado válido', () => {
    expect(parseQuotationFilters({ estado: 'Pendiente' }).filters.estado).toBe('Pendiente');
  });

  test('acepta el estado legado Aceptada', () => {
    expect(parseQuotationFilters({ estado: 'Aceptada' }).filters.estado).toBe('Aceptada');
  });

  test('rechaza un estado inventado con 422 y lista los válidos', () => {
    const { error } = parseQuotationFilters({ estado: 'Inventado' });

    expect(error.status).toBe(422);
    expect(error.message).toContain('Inventado');
    expect(error.message).toContain('Pendiente');
  });

  test('la comparación es sensible a mayúsculas', () => {
    expect(parseQuotationFilters({ estado: 'pendiente' }).error).toBeDefined();
  });
});

describe('parseQuotationFilters — claves foráneas', () => {
  test.each(['id_cliente', 'id_ejecutivo', 'id_licitacion'])('%s acepta un entero positivo', (campo) => {
    expect(parseQuotationFilters({ [campo]: '7' }).filters[campo]).toBe(7);
  });

  test.each(['id_cliente', 'id_ejecutivo', 'id_licitacion'])('%s rechaza cero y negativos', (campo) => {
    expect(parseQuotationFilters({ [campo]: '0' }).error.status).toBe(422);
    expect(parseQuotationFilters({ [campo]: '-3' }).error.status).toBe(422);
  });

  test.each(['id_cliente', 'id_ejecutivo', 'id_licitacion'])('%s rechaza texto', (campo) => {
    const { error } = parseQuotationFilters({ [campo]: 'abc' });

    expect(error.status).toBe(422);
    expect(error.message).toContain(campo);
  });

  test('convierte a número, no deja el string (el prepared statement exige el tipo)', () => {
    expect(typeof parseQuotationFilters({ id_cliente: '7' }).filters.id_cliente).toBe('number');
  });
});

describe('parseQuotationFilters — fechas', () => {
  test('acepta un rango con formato YYYY-MM-DD', () => {
    const { filters } = parseQuotationFilters({ fecha_desde: '2026-01-01', fecha_hasta: '2026-12-31' });

    expect(filters.fecha_desde).toBe('2026-01-01');
    expect(filters.fecha_hasta).toBe('2026-12-31');
  });

  test('rechaza otros formatos', () => {
    expect(parseQuotationFilters({ fecha_desde: '01/01/2026' }).error.status).toBe(422);
    expect(parseQuotationFilters({ fecha_hasta: '2026-1-1' }).error.status).toBe(422);
  });

  test('rechaza un rango invertido', () => {
    const { error } = parseQuotationFilters({ fecha_desde: '2026-12-31', fecha_hasta: '2026-01-01' });

    expect(error.status).toBe(422);
    expect(error.message).toMatch(/later than/);
  });

  test('un rango de un solo día es válido', () => {
    expect(parseQuotationFilters({ fecha_desde: '2026-07-26', fecha_hasta: '2026-07-26' }).error)
      .toBeUndefined();
  });
});

describe('parseQuotationFilters — moneda', () => {
  test('acepta BOB y USD', () => {
    expect(parseQuotationFilters({ moneda: 'BOB' }).filters.moneda).toBe('BOB');
    expect(parseQuotationFilters({ moneda: 'USD' }).filters.moneda).toBe('USD');
  });

  test('normaliza a mayúsculas', () => {
    expect(parseQuotationFilters({ moneda: 'bob' }).filters.moneda).toBe('BOB');
  });

  test('rechaza cualquier otra', () => {
    expect(parseQuotationFilters({ moneda: 'EUR' }).error.status).toBe(422);
  });
});

describe('parseQuotationFilters — tiene_pdf', () => {
  test("'true' y 'false' se convierten a booleano", () => {
    expect(parseQuotationFilters({ tiene_pdf: 'true' }).filters.tiene_pdf).toBe(true);
    expect(parseQuotationFilters({ tiene_pdf: 'false' }).filters.tiene_pdf).toBe(false);
  });

  test('ausente no genera filtro', () => {
    expect(parseQuotationFilters({}).filters.tiene_pdf).toBeUndefined();
  });

  test('rechaza cualquier otro valor', () => {
    expect(parseQuotationFilters({ tiene_pdf: '1' }).error.status).toBe(422);
    expect(parseQuotationFilters({ tiene_pdf: '' }).error.status).toBe(422);
  });
});

describe('parseQuotationFilters — atajo hoy=true', () => {
  test('fija ambas fechas al mismo día', () => {
    const { filters } = parseQuotationFilters({ hoy: 'true' });

    expect(filters.fecha_desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filters.fecha_desde).toBe(filters.fecha_hasta);
  });

  test('usa la fecha de Bolivia, no la UTC del servidor', () => {
    const { filters } = parseQuotationFilters({ hoy: 'true' });
    const enBolivia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

    expect(filters.fecha_desde).toBe(enBolivia);
  });

  test('pisa las fechas explícitas', () => {
    const { filters } = parseQuotationFilters({
      hoy: 'true', fecha_desde: '2020-01-01', fecha_hasta: '2020-12-31',
    });

    expect(filters.fecha_desde).not.toBe('2020-01-01');
    expect(filters.fecha_desde).toBe(filters.fecha_hasta);
  });

  test("hoy distinto de 'true' no hace nada", () => {
    expect(parseQuotationFilters({ hoy: '1' }).filters.fecha_desde).toBeUndefined();
    expect(parseQuotationFilters({ hoy: 'false' }).filters.fecha_desde).toBeUndefined();
  });
});

describe('parseQuotationFilters — paginación', () => {
  test('acepta página y límite', () => {
    expect(parseQuotationFilters({ page: '3', limit: '50' }).pagination)
      .toEqual({ page: 3, limit: 50 });
  });

  test('la página nunca baja de 1', () => {
    expect(parseQuotationFilters({ page: '0' }).pagination.page).toBe(1);
    expect(parseQuotationFilters({ page: '-5' }).pagination.page).toBe(1);
    expect(parseQuotationFilters({ page: 'abc' }).pagination.page).toBe(1);
  });

  test('el límite se topea para que nadie pida la tabla entera', () => {
    expect(parseQuotationFilters({ limit: '9999' }).pagination.limit).toBe(MAX_LIMIT);
  });

  test('un límite negativo se lleva a 1', () => {
    expect(parseQuotationFilters({ limit: '-10' }).pagination.limit).toBe(1);
  });

  test('limit=0 cae al valor por defecto, no a 1', () => {
    // Sutileza heredada: 0 es falsy, así que `parseInt('0') || 20` da 20 antes
    // de que el Math.max(1, …) llegue a actuar. Pedir "cero resultados" no tiene
    // sentido, así que devolver la página por defecto es razonable — pero queda
    // fijado acá para que nadie lo cambie sin querer al tocar la expresión.
    expect(parseQuotationFilters({ limit: '0' }).pagination.limit).toBe(DEFAULT_LIMIT);
  });

  test('un límite no numérico cae al valor por defecto', () => {
    expect(parseQuotationFilters({ limit: 'abc' }).pagination.limit).toBe(DEFAULT_LIMIT);
  });
});

describe('parseQuotationFilters — orden', () => {
  test('acepta las claves de la lista blanca', () => {
    VALID_SORT_KEYS.forEach((k) => {
      expect(parseQuotationFilters({ sort_by: k }).error).toBeUndefined();
    });
  });

  test('rechaza una clave fuera de la lista blanca', () => {
    const { error } = parseQuotationFilters({ sort_by: 'password' });

    expect(error.status).toBe(422);
    expect(error.message).toContain('password');
  });

  test('bloquea un intento de inyección por sort_by', () => {
    // sort_by se interpola en el ORDER BY, así que la lista blanca es lo único
    // que separa este parámetro de una inyección SQL.
    expect(parseQuotationFilters({ sort_by: 'id; DROP TABLE cotizaciones--' }).error.status).toBe(422);
    expect(parseQuotationFilters({ sort_by: '(SELECT 1)' }).error.status).toBe(422);
  });

  test('ASC y asc dan ASC; cualquier otra cosa da DESC', () => {
    expect(parseQuotationFilters({ sort_order: 'ASC' }).sort.order).toBe('ASC');
    expect(parseQuotationFilters({ sort_order: 'asc' }).sort.order).toBe('ASC');
    expect(parseQuotationFilters({ sort_order: 'DESC' }).sort.order).toBe('DESC');
    expect(parseQuotationFilters({ sort_order: 'lo-que-sea' }).sort.order).toBe('DESC');
  });
});

describe('parseQuotationFilters — combinaciones', () => {
  test('una query completa se parsea entera', () => {
    const r = parseQuotationFilters({
      q: 'filtro', estado: 'Confirmada', id_cliente: '4', moneda: 'usd',
      fecha_desde: '2026-01-01', fecha_hasta: '2026-06-30', tiene_pdf: 'true',
      page: '2', limit: '10', sort_by: 'monto_total', sort_order: 'asc',
    });

    expect(r.error).toBeUndefined();
    expect(r.filters).toEqual({
      q: 'filtro', estado: 'Confirmada', id_cliente: 4, moneda: 'USD',
      fecha_desde: '2026-01-01', fecha_hasta: '2026-06-30', tiene_pdf: true,
    });
    expect(r.pagination).toEqual({ page: 2, limit: 10 });
    expect(r.sort).toEqual({ by: 'monto_total', order: 'ASC' });
  });

  test('corta en el PRIMER error y no sigue parseando', () => {
    const { error } = parseQuotationFilters({ estado: 'Inventado', id_cliente: 'abc' });

    expect(error.message).toContain('Inventado');
  });
});
