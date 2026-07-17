// Rule: flag console.log/debug/error in production code paths.
// Agent prompt: "Use the project's logger instead of console.* for runtime output."
const { matchesGlobPattern } = require('../utils');

module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prevent bare console calls in production-bound files.' },
    schema: [
      {
        type: 'object',
        properties: {
          allowedIn: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noConsole: [
        'LOGGING [no-console-in-prod]: Replace console.* with the project logger.',
        '',
        "Import your app's logger and use it instead of console directly.",
        'Example:',
        "  import { log } from '@utils/logger';",
        '  log.info("User logged in", { userId });',
        '  log.error("Fetch failed", err, { url });',
        '',
        'console.* is acceptable only in test files and dev-only utilities.',
      ].join('\n'),
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const allowedIn = options.allowedIn || [];

    function isAllowed(filePath) {
      return allowedIn.some((pattern) => matchesGlobPattern(filePath, pattern));
    }

    return {
      // Visit calls directly so `.catch((e) => console.error(e))`,
      // `x && console.log(...)`, and `return console.log(...)` are caught too.
      CallExpression(node) {
        const callee = node.callee;
        const isConsole =
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'console' &&
          callee.property.name !== undefined;

        if (!isConsole) return;

        const filePath = context.filename ?? context.getFilename();
        if (isAllowed(filePath)) return;

        context.report({ node, messageId: 'noConsole' });
      },
    };
  },
};
