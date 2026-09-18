# El formulario de cotización — `public/js/views/quotationForm/`

[Volver al índice](README.md) · [Las pantallas](pantallas.md)

## En pocas palabras

Es **la pantalla donde más se trabaja**: la que usa el vendedor para armar una
cotización, a veces de cincuenta ítems o más. Por eso tiene ayudas que otras
pantallas no necesitan:

- **Pegar desde Excel:** se copia la planilla que el vendedor ya tenía y los
  ítems se cargan solos.
- **Autoguardado:** si se corta la luz o se cierra el navegador sin querer, al
  volver se ofrece recuperar lo que se estaba escribiendo.
- **Aviso en tiempo real:** si otra persona está redactando la próxima
  cotización, se ve quién, antes de que dos personas trabajen sobre el mismo
  número.
- **Fusión de ítems repetidos:** si se carga dos veces el mismo código con la
  misma marca, se suman las cantidades en vez de duplicar la fila.

## Cómo funciona

### El coordinador — `public/js/views/quotationForm.js`

`mountQuotationForm(container, opciones)` monta el formulario. Con `quotation`
edita una cotización existente; con `prefill` crea una ya vinculada a un
cliente o a una licitación. Devuelve una función para desmontarlo que además
responde `isDirty()`: el tablero la usa para preguntar «¿descartar los
cambios?» antes de cerrar.

Por dentro, `FormMediator` **coordina** las piezas de esta carpeta. Ninguna
conoce a las otras: la grilla le avisa al mediador que cambió un ítem, y el
mediador decide qué más actualizar.

### Los ítems y los totales — `observers.js`

| Clase | Qué hace |
|---|---|
| `LineItemsSubject` | Es **el dueño** de la lista de ítems. Nadie la modifica directamente: se pide agregar, quitar o cambiar, y avisa a todos. |
| `RowSubtotalObserver` | Al enterarse de un cambio, escribe cantidad × precio en cada fila. |
| `TotalsObserver` | Recalcula el subtotal y el total con el descuento. |

### Las piezas

| Archivo | Qué hace | Funciones principales |
|---|---|---|
| `formTemplate.js` | El HTML del formulario. Es una función pura: recibe datos y devuelve texto. | `buildFormHTML` |
| `lineItemsComponent.js` | Cada fila de ítem: su HTML, sus eventos y la regla de fusión. | `appendRow`, `buildRowHtml`, `findDuplicateRow` |
| `clientSearch.js` | El buscador de clientes con autocompletado, y el alta rápida. | `wireClientSearch` |
| `brandModal.js` | El alta rápida de marca desde el «+» de cada fila. | `openBrandModal`, `aplicarMarcaAFilas` |
| `marcasParecidas.js` | Reconoce una marca escrita a mano contra el catálogo y avisa si se parece a una existente. | `resolverMarcas`, `marcasParecidas` |
| `excelPaste.js` | Lee lo pegado desde Excel: separa filas y celdas, reconoce las columnas por su título y entiende los números en cualquier formato. | `parseExcelPaste`, `parseNumero`, `dividirFilasTSV` |
| `revisionImportacion.js` | Muestra lo que el pegado no pudo resolver solo (marcas desconocidas, columnas ignoradas) para decidirlo. | `abrirRevisionImportacion` |
| `fileUpload.js` | El Excel de respaldo opcional, arrastrado o elegido. | `wireFileUpload`, `validateExcelFile` |
| `autosaveDraft.js` | El borrador en el navegador, uno por persona. | `saveDraft`, `loadDraft`, `clearDraft` |
| `draftLock.js` | La reserva en tiempo real del próximo número. | `DraftLockController` |
| `editHydration.js` | Al editar, vuelca la cotización guardada en los campos. | `populateHeaderForEdit`, `populateLicitaciones` |
| `submitPayload.js` | Revisa los campos, arma el pedido y lo envía. | `submitQuotation`, `buildRequestBody`, `validateHeaderFields` |
| `helpers.js` | Formato de números y el cálculo del próximo correlativo a mostrar. | `fmt`, `nextCorrelativoOf` |

### Qué pasa al guardar

1. `submitPayload.js` revisa la cabecera y cada ítem, y marca junto a cada
   campo lo que falta.
2. Arma el pedido y lo manda al servidor, que **vuelve a validar todo** y
   recalcula el total por su cuenta.
3. Apenas el servidor confirma, se libera la reserva del número (para que el
   aviso desaparezca en las pantallas de los demás) y se borra el borrador
   local.
4. Si hay un Excel de respaldo, se sube a continuación. Si esa subida falla, la
   cotización ya está creada: se avisa que el Excel no subió, sin perder nada.
5. Se avisa al tablero para que recargue.

Si el servidor rechaza algún dato, cada error se muestra junto a su campo y lo
que no tiene un campo propio (por ejemplo, un ítem) va al aviso general.

## Por qué es así

- **El autoguardado es solo para cotizaciones nuevas.** Una edición ya vive en
  el servidor; mezclar un borrador local con una cotización real sería
  peligroso. Guarda cada cuatro segundos, y solo si algo cambió.
- **Un borrador por persona, con su llave propia.** Dos vendedores que comparten
  computadora nunca ven el borrador del otro.
- **Sin marca no se fusiona, nunca.** Antes, dos filas del mismo código sin
  marca se tomaban como la misma pieza y **se borraba una fila**. La fusión
  ahora exige una marca conocida y coincidente.
- **Los números pegados se leen con cuidado.** «6.800,00» y «6,800.00» son el
  mismo número; un valor ambiguo o con un signo de más no se adivina: se avisa.
  Antes, «1e10» se leía como 110 sin ningún aviso.
- **Las marcas parecidas se preguntan.** El servidor solo rechaza nombres
  idénticos: aceptaba «CAT» cuando ya existía «Caterpillar», y el catálogo
  llegó a tener cinco entradas que empezaban con CAT.
- **Las piezas son funciones puras donde se pudo.** El HTML, la regla de fusión
  y el armado del pedido reciben datos y devuelven datos, y por eso se prueban
  sin abrir un navegador.

## Dónde está probado

Pruebas quotationFormTemplate, quotationFormObservers, quotationFormLineItems,
fusionItemsMarca, quotationFormClientSearch, quotationFormBrandModal,
marcasParecidas, excelPaste, quotationFormPegadoExcel,
quotationFormFileUpload, quotationFormDraftLock, draftLockRelease,
quotationFormEditHydration, quotationFormSubmit, quotationFormMountRace y
quotationFormHelpers.
