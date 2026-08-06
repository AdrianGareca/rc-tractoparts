// =============================================================================
// tests/unit/quotationFormTemplate.test.js
// Red de seguridad de public/js/views/quotationForm/formTemplate.js.
//
// El resto del formulario localiza TODO por id/clase con querySelector. Si la
// plantilla pierde un id, el cableado se rompe en silencio (`?.` por todos
// lados) y el campo simplemente deja de guardarse. Estos tests fijan el
// contrato: los ids que el Mediator busca tienen que existir en el markup.
// =============================================================================

'use strict';

import { buildFormHTML } from '../../public/js/views/quotationForm/formTemplate.js';

describe('buildFormHTML — contrato de ids con el Mediator', () => {
  const html = buildFormHTML();

  // Ids que quotationForm.js consulta explícitamente. Si alguno desaparece,
  // ese campo deja de leerse/escribirse sin ningún error visible.
  const IDS_REQUERIDOS = [
    'quotation-form', 'qf-lock-banner', 'qf-alert',
    'cliente-search', 'id_cliente', 'client-dropdown', 'btn-nuevo-cliente',
    'err-cliente', 'err-descripcion', 'err-fecha', 'err-validez',
    'id_licitacion', 'descripcion', 'fecha_emision', 'fecha_validez',
    'moneda', 'entidad_emisora', 'tipo_pedido', 'observaciones', 'tiempo_entrega',
    'solicitante_nombre', 'solicitante_no_solicitud', 'solicitante_area',
    'solicitante_celular', 'solicitante_correo',
    'equipo_marca', 'equipo_tipo', 'equipo_modelo', 'equipo_serie', 'equipo_motor',
    'items-body', 'btn-add-item',
    'totals-subtotal', 'totals-total', 'totals-discount',
    'forma_pago', 'forma_pago_custom', 'forma_pago_custom_group', 'mostrar_codigos',
    'excel-drop-zone', 'excel-input', 'excel-file-name',
    'btn-cancel', 'btn-submit',
  ];

  test.each(IDS_REQUERIDOS)('conserva el id "%s"', (id) => {
    expect(html).toContain(`id="${id}"`);
  });

  test('el submit trae las clases que el spinner de envío manipula', () => {
    expect(html).toContain('btn-label');
    expect(html).toContain('btn-spinner');
  });

  test('la clase correlativo-preview existe para _updateCorrelativoPreview', () => {
    expect(buildFormHTML({ nextCorrelativo: 'SC-2026/000042' }))
      .toContain('correlativo-preview');
  });
});

describe('buildFormHTML — modo creación vs edición', () => {
  test('en creación el botón dice "Crear cotización"', () => {
    expect(buildFormHTML({ isEdit: false })).toContain('Crear cotización');
    expect(buildFormHTML({ isEdit: false })).not.toContain('Guardar cambios');
  });

  test('en edición el botón dice "Guardar cambios"', () => {
    expect(buildFormHTML({ isEdit: true })).toContain('Guardar cambios');
    expect(buildFormHTML({ isEdit: true })).not.toContain('Crear cotización');
  });

  test('sin argumentos no explota y asume creación', () => {
    expect(() => buildFormHTML()).not.toThrow();
    expect(buildFormHTML()).toContain('Crear cotización');
  });
});

describe('buildFormHTML — vista previa del correlativo', () => {
  test('sin correlativo no se emite el bloque de vista previa', () => {
    expect(buildFormHTML({ nextCorrelativo: '' })).not.toContain('correlativo-preview');
    expect(buildFormHTML()).not.toContain('Próximo Nº');
  });

  test('con correlativo lo muestra', () => {
    const html = buildFormHTML({ nextCorrelativo: 'SC-2026/000042' });
    expect(html).toContain('Próximo Nº');
    expect(html).toContain('SC-2026/000042');
  });

  test('escapa el correlativo (no puede inyectar markup)', () => {
    const html = buildFormHTML({ nextCorrelativo: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('buildFormHTML — opciones de negocio', () => {
  test('mantiene las dos entidades emisoras válidas', () => {
    const html = buildFormHTML();
    expect(html).toContain('Empresa unipersonal de Ronald Roca Cartagena');
    expect(html).toContain('Roca Importaciones S.R.L.');
  });

  test('mantiene las monedas BOB y USD', () => {
    const html = buildFormHTML();
    expect(html).toContain('value="BOB"');
    expect(html).toContain('value="USD"');
  });

  test('mantiene la opción "Otro" de forma de pago que revela el campo libre', () => {
    expect(buildFormHTML()).toContain('value="__otro__"');
  });

  test('el grupo de forma de pago personalizada arranca oculto', () => {
    // Con la clase .hidden y no con style="display:none".
    //
    // No es lo mismo: para MOSTRARLO el JS hacía `style.display = ''`, que no
    // muestra nada — apenas deja que gane la hoja de estilos. Mientras el
    // display viviera en el atributo inline funcionaba de casualidad, porque
    // ninguna regla del CSS tocaba ese elemento. En cuanto una lo hiciera, el
    // campo «Otro (Personalizado)» dejaba de aparecer y el ejecutivo no podía
    // escribir una forma de pago fuera de las predefinidas.
    const html = buildFormHTML();

    expect(html).toMatch(/id="forma_pago_custom_group"|class="[^"]*\bhidden\b/);
    expect(html).toMatch(
      /class="[^"]*\bhidden\b[^"]*"[^>]*id="forma_pago_custom_group"|id="forma_pago_custom_group"[^>]*class="[^"]*\bhidden\b/
    );
    expect(html).not.toMatch(/id="forma_pago_custom_group"[^>]*display:none/);
  });

  test('mostrar_codigos viene tildado por defecto', () => {
    expect(buildFormHTML()).toMatch(/id="mostrar_codigos"[^>]*checked|checked[^>]*id="mostrar_codigos"/);
  });

  test('la tabla de ítems trae las 10 columnas del detalle', () => {
    const html = buildFormHTML();
    const encabezados = (html.match(/<th[\s>]/g) ?? []).length;
    expect(encabezados).toBe(10);
  });
});
