// Shared helpers for harness ESLint rules.

function isTestPath(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  const segments = normalized.split('/');
  const basename = segments[segments.length - 1] || '';

  return (
    /\.(test|spec)\./i.test(basename) ||
    basename.startsWith('jest.setup') ||
    // A whole path segment named for tests — never a bare substring match,
    // so "inspector.ts" and "contest-page.ts" stay non-test files.
    segments.some((segment) => /^(__tests__|tests?|specs?)$/i.test(segment))
  );
}

function isGeneratedPath(filePath) {
  return (
    filePath.includes('__generated__') ||
    filePath.includes('__mocks__') ||
    filePath.includes('.generated.') ||
    filePath.includes('node_modules/') ||
    filePath.includes('/dist/') ||
    filePath.includes('/build/')
  );
}

function matchesGlobPattern(filePath, pattern) {
  if (!filePath || !pattern) return false;

  let source = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      // Zero or more whole directories — must also match at the path start.
      source += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      source += '[^/]*';
      i += 1;
    } else {
      // Escape regex metacharacters (".", "+", etc.) so they match literally.
      source += pattern[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }

  return new RegExp(`^${source}$`).test(filePath);
}

module.exports = {
  isTestPath,
  isGeneratedPath,
  matchesGlobPattern,
};
