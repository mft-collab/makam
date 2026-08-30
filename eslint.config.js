import tseslint from 'typescript-eslint';
import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      'dist/**/*',
      'dev-dist/**/*',
      'node_modules/**/*',
      'functions/**/*',
      'playwright-report/**/*',
      'test-results/**/*',
      'coverage/**/*',
    ]
  },
  // ─── TypeScript / TSX Parsing ──────────────────────────────────────────────
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.{ts,tsx}', '*.{ts,tsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx}', '*.{ts,tsx}'],
    rules: {
      // TODO(Faz 1.3): CRUD sınırlarına Zod validasyonu eklendikçe 'error'a çekilecek.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // ─── Firebase Security Rules ──────────────────────────────────────────────
  {
    ...firebaseRulesPlugin.configs['flat/recommended'],
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
      // Klavye erişilebilirliği doğrudan işlevsellik anlamına geldiğinden
      // (bir mouse-only handler klavye kullanıcısı için tamamen erişilemez
      // olur) 'error'a yükseltildi — önceden 'warn' idi ve CI'da tek güvenlik
      // ağı Lighthouse'un genel a11y skoruydu (bkz. kod denetimi).
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-aria-hidden-on-focusable': 'error',
      'jsx-a11y/no-redundant-roles': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'error',
    },
  },
];
