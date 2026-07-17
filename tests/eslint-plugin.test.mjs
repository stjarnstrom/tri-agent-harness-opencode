// Tests for the harness ESLint plugin (harness/eslint-plugin-harness).
// Run with: node --test tests/eslint-plugin.test.mjs
/* eslint-disable harness/no-leaked-secrets -- fixture strings below are fake secrets used to test the rule itself */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import { RuleTester } from "eslint";

const require = createRequire(import.meta.url);
const plugin = require("../harness/eslint-plugin-harness");
const { isTestPath, matchesGlobPattern } = require("../harness/eslint-plugin-harness/utils");

// Wire ESLint's RuleTester into node:test.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const lines = (n, prefix = "v") =>
  Array.from({ length: n }, (_, i) => `const ${prefix}${i} = ${i};`).join("\n");

// ---------------------------------------------------------------------------
// utils.isTestPath
// ---------------------------------------------------------------------------
describe("utils.isTestPath", () => {
  it("does not classify non-test files whose names merely contain 'test'/'spec'", () => {
    assert.equal(isTestPath("src/inspector.ts"), false);
    assert.equal(isTestPath("src/contest-page.ts"), false);
    assert.equal(isTestPath("src/latest.ts"), false);
    assert.equal(isTestPath("src/protest-utils.ts"), false);
    assert.equal(isTestPath("src/respect.js"), false);
  });

  it("classifies real test files", () => {
    assert.equal(isTestPath("src/foo.test.ts"), true);
    assert.equal(isTestPath("a.spec.js"), true);
    assert.equal(isTestPath("src/__tests__/x.ts"), true);
    assert.equal(isTestPath("tests/setup.ts"), true);
    assert.equal(isTestPath("test/foo.js"), true);
    assert.equal(isTestPath("jest.setup.js"), true);
  });
});

// ---------------------------------------------------------------------------
// utils.matchesGlobPattern
// ---------------------------------------------------------------------------
describe("utils.matchesGlobPattern", () => {
  it("escapes dots and anchors the pattern", () => {
    assert.equal(matchesGlobPattern("src/latest.ts", "**/*.test.*"), false);
    assert.equal(matchesGlobPattern("fooXts", "*.ts"), false);
    assert.equal(matchesGlobPattern("a/foo.ts", "*.ts"), false);
    assert.equal(matchesGlobPattern("foo.ts", "*.ts"), true);
  });

  it("lets **/ match at the start of the path (zero directories)", () => {
    assert.equal(matchesGlobPattern("a.test.js", "**/*.test.*"), true);
    assert.equal(matchesGlobPattern("src/a.test.js", "**/*.test.*"), true);
    assert.equal(matchesGlobPattern("/abs/path/a.test.js", "**/*.test.*"), true);
  });

  it("matches directory segments exactly", () => {
    assert.equal(matchesGlobPattern("src/scripts/x.js", "**/scripts/**"), true);
    assert.equal(matchesGlobPattern("scripts/x.js", "**/scripts/**"), true);
    assert.equal(matchesGlobPattern("src/scriptsy/x.js", "**/scripts/**"), false);
  });
});

// ---------------------------------------------------------------------------
// no-leaked-secrets
// ---------------------------------------------------------------------------
ruleTester.run("no-leaked-secrets", plugin.rules["no-leaked-secrets"], {
  valid: [
    'const password = "";',
    'const apiKeyLabel = "API key";',
    "const password = process.env.PASSWORD;",
    'const password = "short";',
    'const tokenizer = "abcdefghijk";',
    'const message = "Enter your password";',
    'const secretHint = "pick something long";',
    "const greeting = `hello ${name}`;",
  ],
  invalid: [
    {
      code: 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";',
      errors: [{ messageId: "default" }],
    },
    {
      code: 'const key = "pk-abcdefghijklmnopqrstuvwxyz123456";',
      errors: [{ messageId: "default" }],
    },
    {
      code: 'const password = "hunter22";',
      errors: [{ messageId: "default" }],
    },
    {
      code: 'const config = { apiKey: "abcd1234efgh5678" };',
      errors: [{ messageId: "default" }],
    },
    {
      code: 'settings.secret = "supersecretvalue";',
      errors: [{ messageId: "default" }],
    },
    {
      code: "const header = `Bearer sk-abcdefghijklmnopqrstuvwxyz123456`;",
      errors: [{ messageId: "default" }],
    },
    {
      code: 'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
      errors: [{ messageId: "default" }],
    },
    // Token-shaped value assigned to a credential name: exactly one report.
    {
      code: 'const password = "sk-abcdefghijklmnopqrstuvwxyz123456";',
      errors: [{ messageId: "default" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// component-too-large
// ---------------------------------------------------------------------------
const bigJsxComponent = `function Big() {\n${lines(55)}\n  return <div>hello</div>;\n}`;
const bigPlainCli = [
  "function scan(items) {",
  "  const out = new Map();",
  "  for (let i = 0, len = items.length; i<len; i++) { out.set(i, items[i]); }",
  "  return out;",
  "}",
  lines(55),
].join("\n");

ruleTester.run("component-too-large", plugin.rules["component-too-large"], {
  valid: [
    // Plain JS with `i<len` is not JSX — must not get "extract child components" advice.
    {
      code: bigPlainCli,
      filename: "sdk-orchestrator/cli.mjs",
      options: [{ maxLines: 50 }],
    },
    // Test files are exempt, like file-too-large.
    {
      code: bigJsxComponent,
      filename: "src/App.test.tsx",
      options: [{ maxLines: 50 }],
    },
    {
      code: bigJsxComponent,
      filename: "src/__generated__/App.tsx",
      options: [{ maxLines: 50 }],
    },
    // Small component is fine.
    {
      code: "function Small() { return <div>ok</div>; }",
      filename: "src/Small.tsx",
      options: [{ maxLines: 50 }],
    },
  ],
  invalid: [
    {
      code: bigJsxComponent,
      filename: "src/Big.tsx",
      options: [{ maxLines: 50 }],
      errors: [{ messageId: "tooLarge" }],
    },
    {
      code: `function Frag() {\n${lines(55)}\n  return <>{x}</>;\n}`,
      filename: "src/Frag.tsx",
      options: [{ maxLines: 50 }],
      errors: [{ messageId: "tooLarge" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// file-too-large
// ---------------------------------------------------------------------------
const bigPlainFile = [
  "function scan(items) {",
  "  const out = new Map();",
  "  for (let i = 0, len = items.length; i<len; i++) { out.set(i, items[i]); }",
  "  return out;",
  "}",
  lines(110),
].join("\n");
const bigJsxFile = `function Big() {\n${lines(110)}\n  return <div>hello</div>;\n}`;

ruleTester.run("file-too-large", plugin.rules["file-too-large"], {
  valid: [
    // JSX files are component-too-large's turf.
    {
      code: bigJsxFile,
      filename: "src/App.jsx",
      options: [{ maxLines: 100 }],
    },
    // Real test files stay exempt.
    {
      code: bigPlainFile,
      filename: "src/foo.test.ts",
      options: [{ maxLines: 100 }],
    },
    {
      code: "const small = 1;",
      filename: "src/small.ts",
      options: [{ maxLines: 100 }],
    },
  ],
  invalid: [
    // `i<len` is not JSX — the file must NOT be exempted from file-too-large.
    {
      code: bigPlainFile,
      filename: "src/utils/helpers.js",
      options: [{ maxLines: 100 }],
      errors: [{ messageId: "tooLarge" }],
    },
    // 'contest-page' is not a test file.
    {
      code: bigPlainFile,
      filename: "src/contest-page.ts",
      options: [{ maxLines: 100 }],
      errors: [{ messageId: "tooLarge" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// no-console-in-prod
// ---------------------------------------------------------------------------
ruleTester.run("no-console-in-prod", plugin.rules["no-console-in-prod"], {
  valid: [
    'logger.log("x");',
    "const c = console;",
    {
      code: 'console.log("ok in tests");',
      filename: "src/foo.test.ts",
      options: [{ allowedIn: ["**/*.test.*"] }],
    },
    {
      code: 'console.log("ok in scripts");',
      filename: "scripts/build.mjs",
      options: [{ allowedIn: ["**/scripts/**", "scripts/**"] }],
    },
  ],
  invalid: [
    {
      code: 'console.log("plain statement");',
      filename: "src/app.ts",
      errors: [{ messageId: "noConsole" }],
    },
    {
      code: "promise.catch((e) => console.error(e));",
      filename: "src/app.ts",
      errors: [{ messageId: "noConsole" }],
    },
    {
      code: 'flag && console.log("logical");',
      filename: "src/app.ts",
      errors: [{ messageId: "noConsole" }],
    },
    {
      code: 'function f() { return console.log("returned"); }',
      filename: "src/app.ts",
      errors: [{ messageId: "noConsole" }],
    },
    {
      code: 'const x = console.warn("assigned");',
      filename: "src/app.ts",
      errors: [{ messageId: "noConsole" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// fetch-needs-timeout
// ---------------------------------------------------------------------------
ruleTester.run("fetch-needs-timeout", plugin.rules["fetch-needs-timeout"], {
  valid: [
    "fetch(url, { signal: controller.signal });",
    "fetch(url, { signal });",
    "fetch(url, { timeout: 5000 });",
    // Options object we cannot see into: do NOT report.
    "fetch(url, opts);",
    "fetch(url, { ...baseOpts });",
    "fetch(url, { [key]: value });",
    "fetch(url, buildOptions());",
    "fetch(...args);",
    // Not the global fetch.
    "myApi.fetch(url);",
    "fetchWithTimeout(url);",
    "window.fetch(url, { signal });",
  ],
  invalid: [
    { code: "fetch(url);", errors: [{ messageId: "missingTimeout" }] },
    {
      code: "fetch(url, { headers: {} });",
      errors: [{ messageId: "missingTimeout" }],
    },
    { code: "window.fetch(url);", errors: [{ messageId: "missingTimeout" }] },
    {
      code: "globalThis.fetch(url, { method: 'POST' });",
      errors: [{ messageId: "missingTimeout" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// one-canonical-pattern
// ---------------------------------------------------------------------------
const canonicalOptions = [
  {
    approvedImports: [
      {
        concept: "log",
        allowedPaths: ["@utils/logger"],
        disallowedPatterns: ["loglevel"],
      },
    ],
  },
];

ruleTester.run("one-canonical-pattern", plugin.rules["one-canonical-pattern"], {
  valid: [
    // "log" must not substring-match "dialog".
    {
      code: 'import { Dialog } from "@ui/dialog";',
      options: canonicalOptions,
    },
    {
      code: 'import { log } from "@utils/logger";',
      options: canonicalOptions,
    },
    // Calling the concept function imported from the canonical path is fine.
    {
      code: 'import { log } from "@utils/logger";\nlog("hello");',
      options: canonicalOptions,
    },
    // Unrelated calls are fine.
    {
      code: "dialog(); logout();",
      options: canonicalOptions,
    },
  ],
  invalid: [
    {
      code: 'import { log } from "other-log-lib";',
      options: canonicalOptions,
      errors: [{ messageId: "disallowedImport" }],
    },
    {
      code: 'import level from "loglevel";',
      options: canonicalOptions,
      errors: [{ messageId: "disallowedImport" }],
    },
    // Bare global call to the concept, not imported from the canonical path.
    {
      code: 'log("hi");',
      options: canonicalOptions,
      errors: [{ messageId: "disallowedImport" }],
    },
    // Imported from a source the import checks cannot classify: flag the call.
    {
      code: 'import { log } from "weird-pkg";\nlog("hi");',
      options: canonicalOptions,
      errors: [{ messageId: "disallowedImport" }],
    },
    // Concept listed in config but with no canonical path defined.
    {
      code: 'track("event");',
      options: [{ approvedImports: [{ concept: "track", allowedPaths: [] }] }],
      errors: [{ messageId: "noPatternDefined" }],
    },
  ],
});
