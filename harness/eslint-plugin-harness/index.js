// Harness ESLint plugin — agent-prompt lint rules.
// Loaded directly from .eslintrc.harness.cjs via require() — no npm publish needed.
module.exports = {
  rules: {
    'no-leaked-secrets': require('./rules/no-leaked-secrets'),
    'fetch-needs-timeout': require('./rules/fetch-needs-timeout'),
    'component-too-large': require('./rules/component-too-large'),
    'file-too-large': require('./rules/file-too-large'),
    'no-console-in-prod': require('./rules/no-console-in-prod'),
    'one-canonical-pattern': require('./rules/one-canonical-pattern'),
  },
};
