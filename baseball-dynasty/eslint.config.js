import security from 'eslint-plugin-security';

export default [
  {
    plugins: {
      security,
    },
    rules: {
      ...security.configs.recommended.rules,
      'no-console': 'off', // Server uses console.log/warn/error
    },
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
];
