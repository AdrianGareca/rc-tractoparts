// =============================================================================
// src/services/pdf/drawers/brandStrip.js
// Franja de logos de marcas debajo del encabezado.
//
// Extraido de pdfService.js sin cambios de comportamiento.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { BRANDS_DIR, BRAND_DEFS, C, PW, MARGIN, CW } = require('../constants');

// ---------------------------------------------------------------------------
// drawBrandStrip
// Full-width partner-brand row. Each brand occupies an equal-width slot
// (flexbox "space-between" equivalent).
//
// DUPLICATED-LOGO FIX:
//   The previous implementation used `doc.image(path, x, y, { fit, align,
//   valign })`. The combination of `fit` with `align/valign` made certain
//   wide PNGs (notably John Deere and CAT) render duplicated / tiled inside
//   their slot. The robust fix is to NOT rely on `fit`+alignment at all:
//   we open each image once, compute the EXACT contained width/height that
//   preserves the original aspect ratio (object-fit: contain, by hand), then
//   issue a SINGLE doc.image() call with explicit { width, height }. Exact
//   dimensions + one draw call = no scaling ambiguity and no tiling artifacts.
// Returns Y immediately below the strip.
// ---------------------------------------------------------------------------
function drawBrandStrip(doc, startY) {
  const STRIP_H  = 30;                       // uniform max height for every logo
  const SLOT_PAD = 8;                        // horizontal breathing room per slot
  const slotW    = CW / BRAND_DEFS.length;   // ≈ 87.2 pt — equal slots
  const maxImgW  = slotW - SLOT_PAD * 2;     // max width available inside a slot

  // Hairline rule above the strip to separate it from the header block
  doc
    .moveTo(MARGIN, startY)
    .lineTo(PW - MARGIN, startY)
    .lineWidth(0.4)
    .strokeColor(C.BORDER_GRAY)
    .stroke();

  const rowY = startY + 6;

  BRAND_DEFS.forEach(({ file, label }, i) => {
    const slotX   = MARGIN + i * slotW;
    const imgPath = path.join(BRANDS_DIR, file);

    if (fs.existsSync(imgPath)) {
      // Open the image once to read its intrinsic pixel dimensions.
      const img   = doc.openImage(imgPath);
      const ratio = img.width / img.height;

      // object-fit: contain — scale to the uniform max height, then clamp the
      // width so ultra-wide logos (e.g. Komatsu 5:1) never spill past the slot.
      let drawH = STRIP_H;
      let drawW = drawH * ratio;
      if (drawW > maxImgW) {
        drawW = maxImgW;
        drawH = drawW / ratio;
      }

      // Centre the (correctly proportioned) image inside its slot.
      const drawX = slotX + (slotW - drawW) / 2;
      const drawY = rowY  + (STRIP_H - drawH) / 2;

      // Exactly one draw call, with explicit aspect-correct width AND height.
      doc.image(img, drawX, drawY, { width: drawW, height: drawH });
    } else {
      // Text fallback when an image asset is not yet deployed
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(C.NAVY)
        .text(label, slotX, rowY + (STRIP_H - 8) / 2,
          { width: slotW, align: 'center', lineBreak: false });
    }
  });

  return rowY + STRIP_H + 6;
}

module.exports = { drawBrandStrip };
