// Rule: ensure fetch calls have timeouts/retries.
// Agent prompt: "All network requests must use the project's retry/timeout helper."
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Ensure all fetch calls are wrapped with timeout and retry logic.' },
    schema: [],
    messages: {
      missingTimeout: [
        'RELIABILITY [fetch-needs-timeout]: This fetch call has no timeout.',
        '',
        'Fetch calls must be wrapped in our internal retry/timeout helper.',
        "Import it from @utils/network (or your project's equivalent).",
        '',
        'Example:',
        "  import { fetchWithTimeout } from '@utils/network';",
        '  const data = await fetchWithTimeout(url, { timeoutMs: 5000, retries: 2 });',
      ].join('\n'),
    },
  },

  create(context) {
    const TIMEOUT_KEYS = new Set(['timeout', 'signal', 'abortController']);

    // The global fetch: bare `fetch(...)` or `window/globalThis/self/this.fetch(...)`.
    function isGlobalFetchCallee(callee) {
      if (callee.type === 'Identifier') return callee.name === 'fetch';
      if (callee.type === 'MemberExpression' && !callee.computed) {
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'fetch') return false;
        if (callee.object.type === 'ThisExpression') return true;
        return (
          callee.object.type === 'Identifier' &&
          ['window', 'globalThis', 'self'].includes(callee.object.name)
        );
      }
      return false;
    }

    // Only report when we can PROVE the timeout/signal is absent. Identifiers,
    // spreads, and computed keys may carry a signal we cannot see — stay quiet.
    function provablyMissingTimeout(args) {
      if (args.some((arg) => arg.type === 'SpreadElement')) return false;
      if (args.length < 2) return true;

      const options = args[1];
      if (options.type !== 'ObjectExpression') return false;

      let opaque = false;
      for (const prop of options.properties) {
        if (prop.type === 'SpreadElement') {
          opaque = true;
          continue;
        }
        if (prop.computed) {
          opaque = true;
          continue;
        }
        const keyName = prop.key.name ?? prop.key.value;
        if (TIMEOUT_KEYS.has(keyName)) return false;
      }
      return !opaque;
    }

    return {
      CallExpression(node) {
        if (!isGlobalFetchCallee(node.callee)) return;

        if (provablyMissingTimeout(node.arguments)) {
          context.report({ node, messageId: 'missingTimeout' });
        }
      },
    };
  },
};
