// Rule: flag hardcoded secrets, API keys, tokens, passwords.
// Agent prompt: "Never hardcode credentials. Use environment variables or a secret manager."

// Bare token shapes. These match the *contents* of a string (a Literal's
// value never includes its own quote characters).
const TOKEN_PATTERNS = [
  { regex: /\b(?:sk|pk)-[a-zA-Z0-9]{20,}/, label: 'API key (sk-/pk- prefix)' },
  { regex: /\bghp_[a-zA-Z0-9]{36}/, label: 'GitHub personal access token' },
  { regex: /\bgho_[a-zA-Z0-9]{36}/, label: 'GitHub OAuth token' },
  { regex: /\bAKIA[0-9A-Z]{16}/, label: 'AWS access key ID' },
  { regex: /\bxox[baprs]-[0-9a-zA-Z-]{10,}/, label: 'Slack token' },
  // Whole assignments embedded inside one string (e.g. config blobs).
  { regex: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i, label: 'Hardcoded password' },
  { regex: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}['"]/i, label: 'Hardcoded API key value' },
];

const CREDENTIAL_NAME = /\b(?:password|passwd|pwd|secret|token|apikey)\b|\b(?:api|access|private|secret) key\b/;

function matchesTokenPattern(value) {
  return TOKEN_PATTERNS.some((pattern) => pattern.regex.test(value));
}

// "apiKeyLabel" -> "api key label"; "tokenizer" stays "tokenizer" so it
// won't word-match "token".
function isCredentialName(name) {
  if (typeof name !== 'string' || !name) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ');
  return CREDENTIAL_NAME.test(words);
}

// A value only counts as a credential if it plausibly is one: non-trivial
// length and no spaces (so `password = ""` and `apiKeyLabel = "API key"`
// stay clean), or a known token shape.
function looksLikeCredentialValue(value) {
  if (typeof value !== 'string') return false;
  return matchesTokenPattern(value) || (value.length >= 8 && !/\s/.test(value));
}

function staticKeyName(keyNode, computed) {
  if (!keyNode || computed) return null;
  if (keyNode.type === 'Identifier') return keyNode.name;
  if (keyNode.type === 'Literal' && typeof keyNode.value === 'string') return keyNode.value;
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Prevent hardcoded secrets and credentials in source code.' },
    schema: [],
    messages: {
      default: [
        'SECURITY [no-leaked-secrets]: Hardcoded secret detected.',
        '',
        'Do NOT commit this value. Instead:',
        '  1. Move the secret to an environment variable (e.g., process.env.API_KEY).',
        '  2. If using a frontend framework, use a build-time env var (NEXT_PUBLIC_*, VITE_*, etc.).',
        '  3. For backend services, inject via your secret manager or .env file (added to .gitignore).',
        '',
        'If this is a test fixture, wrap it in: if (__DEV__ || process.env.NODE_ENV === "test").',
      ].join('\n'),
    },
  },

  create(context) {
    function checkNamedAssignment(name, valueNode) {
      if (!valueNode || valueNode.type !== 'Literal' || typeof valueNode.value !== 'string') return;
      if (!isCredentialName(name)) return;
      // Token-shaped values are already reported by the Literal visitor —
      // skip them here so each secret is reported exactly once.
      if (matchesTokenPattern(valueNode.value)) return;
      if (!looksLikeCredentialValue(valueNode.value)) return;
      context.report({ node: valueNode, messageId: 'default' });
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (matchesTokenPattern(node.value)) {
          context.report({ node, messageId: 'default' });
        }
      },

      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          const text = quasi.value.cooked ?? quasi.value.raw ?? '';
          if (matchesTokenPattern(text)) {
            context.report({ node, messageId: 'default' });
            return;
          }
        }
      },

      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') return;
        checkNamedAssignment(node.id.name, node.init);
      },

      Property(node) {
        checkNamedAssignment(staticKeyName(node.key, node.computed), node.value);
      },

      AssignmentExpression(node) {
        let name = null;
        if (node.left.type === 'Identifier') {
          name = node.left.name;
        } else if (node.left.type === 'MemberExpression') {
          name = staticKeyName(node.left.property, node.left.computed);
        }
        checkNamedAssignment(name, node.right);
      },
    };
  },
};
