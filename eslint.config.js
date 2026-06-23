module.exports = [
    {
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
    }
];
