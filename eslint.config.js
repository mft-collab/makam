import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'functions/**/*']
  },
  // ─── Firebase Security Rules ──────────────────────────────────────────────
  {
    files: ['**/*.rules'],
    languageOptions: {
      sourceType: 'script',
    },
    plugins: {
      '@firebase/security-rules': firebaseRulesPlugin
    },
    rules: {
      ...firebaseRulesPlugin.configs['flat/recommended'].rules
    }
  },
  // ─── JSX Accessibility ────────────────────────────────────────────────────
  {
    files: ['src/**/*.{tsx,jsx}'],
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // Kritik erişilebilirlik kuralları
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'warn',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/no-aria-hidden-on-focusable': 'error',
      'jsx-a11y/no-redundant-roles': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'error',
    },
  },
];
