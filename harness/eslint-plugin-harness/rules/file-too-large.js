// Rule: flag any source file that exceeds a line-count threshold.
// Agent prompt: "Source files must stay under N lines. Extract helpers/utilities."
const { isGeneratedPath, isTestPath } = require('../utils');

module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Warn when a non-component source file exceeds the maximum allowed line count.' },
    schema: [
      {
        type: 'object',
        properties: {
          maxLines: { type: 'integer', minimum: 100, default: 350 },
          excludePatterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'File patterns to skip (e.g., generated files, test fixtures)',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLarge:
        'FILE SIZE [file-too-large]: This source file is {{maxLines}}+ lines.\n\n' +
        'Source files should be <= {{maxLines}} lines. Break this into smaller, focused modules.\n\n' +
        'Guidelines:\n' +
        '  1. Extract utility functions into a sibling _utils.ts or a shared utils/ directory.\n' +
        '  2. Split by concern: types, constants, logic, and exports in separate files.\n' +
        '  3. If this is a barrel export file (index.ts), consider whether it truly needs to re-export everything.\n\n' +
        'If this is a generated file or test fixture, add it to the excludePatterns option.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const maxLines = options.maxLines ?? 350;
    const excludePatterns = options.excludePatterns || [];
    const filename = context.filename ?? context.getFilename();

    if (isGeneratedPath(filename) || isTestPath(filename)) return {};
    if (excludePatterns.some((pattern) => filename.includes(pattern))) return {};

    // Detect JSX from the AST, not a regex — `i<len` and `Map<string, T>`
    // must never count as JSX (that used to exempt big utility files).
    let hasJsx = false;

    return {
      JSXElement() {
        hasJsx = true;
      },
      JSXFragment() {
        hasJsx = true;
      },
      'Program:exit'(node) {
        if (!node.body.length) return;

        // Component files are handled by component-too-large.
        if (hasJsx) return;

        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const lineCount = sourceCode.getText().split('\n').length;

        if (lineCount > maxLines) {
          context.report({ node, messageId: 'tooLarge', data: { maxLines } });
        }
      },
    };
  },
};
