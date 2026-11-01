import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import noLiteralUiText from './scripts/eslint/no-literal-ui-text.mjs'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Type-aware rules need type information. The project service gives each
    // file the program of its nearest tsconfig: the root one for the web app,
    // functions/tsconfig.json for the Cloud Functions source in functions/src.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // Firebase is not part of the app's first load (lib/firebase.ts): only
    // lib/firebase-services.ts imports the SDK statically, and only lib/firebase.ts
    // loads that module, with a dynamic import. Everything else takes the started
    // services from loadFirebase() and SDK functions from `await import('firebase/...')`.
    // Type-only imports cost nothing at runtime and stay allowed.
    files: ['app/**/*.{ts,tsx}', 'components/**/*.tsx', 'hooks/**/*.ts', 'lib/**/*.{ts,mts}'],
    ignores: ['lib/firebase-services.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@?firebase(/|$)',
              allowTypeImports: true,
              message:
                "Firebase loads on demand: use loadFirebase() from lib/firebase.ts and `await import('firebase/...')`.",
            },
            {
              regex: '(^|/)firebase-services$',
              allowTypeImports: true,
              message: 'Only lib/firebase.ts loads this module (loadFirebase).',
            },
          ],
        },
      ],
    },
  },
  {
    // User-visible text comes from the message catalogues (messages/, docs/i18n/README.md).
    // The privacy policy and terms are legal documents written whole in each language
    // (ROADMAP item 46), and the UI harness and the dev panel are tools, not the app.
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    ignores: [
      'app/privacy/**',
      'app/terms/**',
      'app/es/privacy/**',
      'app/es/terms/**',
      'app/harness/**',
      'components/LegalDetail.tsx',
      'components/AnalyticsPreferenceControl.tsx',
      'components/DevPanel.tsx',
    ],
    plugins: { solara: { rules: { 'no-literal-ui-text': noLiteralUiText } } },
    rules: { 'solara/no-literal-ui-text': 'error' },
  },
  {
    files: ['**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Formatting is Prettier's job; turn off any stylistic rules that would fight it.
  prettier,
  globalIgnores([
    '.next/**',
    'out/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'public/firebase-messaging-sw.js',
    'functions/core/**',
    'functions/lib/**',
  ]),
])
