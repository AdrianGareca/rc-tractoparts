// =============================================================================
// babel.config.js
// Used ONLY by babel-jest during the test run, so Jest can parse the frontend's
// native ES modules (public/js/**, which use `import`/`export`). The application
// itself runs unmodified via `node src/server.js` — Babel never touches runtime
// code. Targeting the current Node keeps the transform minimal (ESM → CJS only).
// =============================================================================

'use strict';

module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
  ],
};
