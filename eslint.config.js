const globals = require('globals');

module.exports = [
    // ── Backend (Node.js / CommonJS) ──────────────────────────────────────────
    // Applies to all JS files NOT under public/. Keeps require/module/exports
    // available and does not enforce ES Module syntax.
    {
        ignores: ["public/**"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "commonjs",
            globals: {
                process: "readonly",
                module: "readonly",
                require: "readonly",
                __dirname: "readonly",
                console: "readonly",
                exports: "readonly",
                Buffer: "readonly",
                setTimeout: "readonly",
                setImmediate: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    },

    // ── Frontend (Browser / ES Modules) ──────────────────────────────────────
    // All files under public/ use import/export syntax. globals.browser provides
    // the full standard browser global list: atob/btoa, window, document,
    // localStorage, fetch, AbortController, URLSearchParams, etc.
    {
        files: ["public/**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    }
];
