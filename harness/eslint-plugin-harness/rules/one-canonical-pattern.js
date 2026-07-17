// Rule: enforce one canonical way to do common things in the codebase.
// Agent prompt: "Use only the project's approved patterns — don't invent your own."
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: "Enforce that code uses only the project's canonical patterns." },
    schema: [
      {
        type: 'object',
        properties: {
          approvedImports: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                concept: { type: 'string' },
                allowedPaths: { type: 'array', items: { type: 'string' } },
                disallowedPatterns: { type: 'array', items: { type: 'string' } },
              },
              required: ['concept'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      disallowedImport:
        'PATTERN [one-canonical-pattern]: This file uses a non-approved import for "{{concept}}".\n\n' +
        'The project has one canonical way to handle this. Use only the approved imports instead.',
      noPatternDefined:
        'PATTERN [one-canonical-pattern]: The concept "{{concept}}" has no approved pattern defined in your lint config.\n\n' +
        "Either add an entry to \"approvedImports\" in .eslintrc.harness.cjs, or use the project's canonical approach (document it there).",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const approvedImports = options.approvedImports || [];

    const conceptMap = new Map();
    for (const entry of approvedImports) {
      if (entry.concept && !conceptMap.has(entry.concept)) {
        conceptMap.set(entry.concept, {
          allowedPaths: entry.allowedPaths || [],
          disallowedPatterns: entry.disallowedPatterns || [],
        });
      }
    }

    if (conceptMap.size === 0) return {};

    // Word-boundary concept matching: "log" must match "@app/log" or
    // "my-log-lib", but never "dialog" or "logout".
    function sourceMentionsConcept(source, concept) {
      const words = source
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      return words.includes(concept.toLowerCase());
    }

    // local binding name -> import source, so calls can be traced to imports.
    const importSources = new Map();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;

        for (const specifier of node.specifiers) {
          if (specifier.local) importSources.set(specifier.local.name, source);
        }

        for (const [concept, config] of conceptMap) {
          if (config.disallowedPatterns.some((p) => source.includes(p))) {
            context.report({ node, messageId: 'disallowedImport', data: { concept } });
          }
        }

        for (const [concept, config] of conceptMap) {
          if (config.allowedPaths.length === 0) continue;
          if (config.allowedPaths.includes(source)) continue;
          const isConceptImport =
            sourceMentionsConcept(source, concept) ||
            config.allowedPaths.some((path) => source.includes(path));
          if (isConceptImport) {
            context.report({ node, messageId: 'disallowedImport', data: { concept } });
          }
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'Identifier') return;

        for (const [concept, config] of conceptMap) {
          if (callee.name !== concept) continue;

          // Concept is configured but no canonical path is defined for it.
          if (config.allowedPaths.length === 0) {
            context.report({ node, messageId: 'noPatternDefined', data: { concept } });
            continue;
          }

          // Allowed only when this call site's binding was imported from a
          // canonical path — a bare global (or off-list import) is flagged.
          const importedFrom = importSources.get(callee.name);
          if (!importedFrom || !config.allowedPaths.includes(importedFrom)) {
            context.report({ node, messageId: 'disallowedImport', data: { concept } });
          }
        }
      },
    };
  },
};
