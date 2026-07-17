// Rule: flag UI components that exceed a line-count threshold.
// Agent prompt: "Components must be under N lines. Extract stateless child components."
const { isGeneratedPath, isTestPath } = require('../utils');

module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Warn when a component exceeds the maximum allowed line count.' },
    schema: [
      {
        type: 'object',
        properties: {
          maxLines: { type: 'integer', minimum: 50, default: 150 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLarge:
        'COMPONENT SIZE [component-too-large]: This component is {{maxLines}}+ lines.\n\n' +
        'Break this into smaller, stateless child components. Target: each file should be <= {{maxLines}} lines.\n\n' +
        'Guidelines:\n' +
        '  1. Extract reusable UI pieces (buttons, cards, forms) into their own files.\n' +
        '  2. Separate data-fetching logic from rendering — use a custom hook for state/effects.\n' +
        '  3. If the component has multiple responsibilities, split by concern (not just by length).',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const maxLines = options.maxLines ?? 150;
    const filename = context.filename ?? context.getFilename();

    if (isGeneratedPath(filename) || isTestPath(filename)) return {};

    // Detect JSX from the AST, not a regex — `i<len` and `Map<string, T>`
    // must never count as JSX.
    let hasJsx = false;

    return {
      JSXElement() {
        hasJsx = true;
      },
      JSXFragment() {
        hasJsx = true;
      },
      'Program:exit'(node) {
        if (!node.body.length || !hasJsx) return;

        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const lineCount = sourceCode.getText().split('\n').length;

        if (lineCount > maxLines) {
          context.report({ node, messageId: 'tooLarge', data: { maxLines } });
        }
      },
    };
  },
};
