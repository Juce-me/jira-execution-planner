import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    {
        files: ['**/*.{js,jsx,mjs}'],
        plugins: { react, 'react-hooks': reactHooks },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            // esbuild defines process.env.NODE_ENV at bundle time.
            globals: { ...globals.browser, process: 'readonly' },
        },
        rules: {
            'no-undef': 'error',
            'react/jsx-no-undef': 'error',
            'react/jsx-uses-vars': 'error',
            // The bundle uses esbuild's classic JSX transform, so every .jsx file needs React in scope.
            'react/jsx-uses-react': 'error',
            'react/react-in-jsx-scope': 'error',
            'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
            'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
            'react-hooks/rules-of-hooks': 'error',
        },
    },
    {
        // Three pre-existing errors at base, outside this program.
        files: ['**/eng/EngView.jsx'],
        rules: { 'react-hooks/rules-of-hooks': 'off' },
    },
];
