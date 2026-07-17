#!/usr/bin/env bash
# Install harness git hooks and dependencies into the current repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# `[ -d .git ]` is false in git worktrees (.git is a file there); resolve the
# real hooks directory through git instead.
if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Not a git repository. Run 'git init' first." >&2
  exit 1
fi

HOOKS_DIR="$(git -C "$ROOT" rev-parse --git-path hooks)"
case "$HOOKS_DIR" in
  /*) ;;
  *) HOOKS_DIR="$ROOT/$HOOKS_DIR" ;;
esac

mkdir -p "$HOOKS_DIR"

for hook in pre-commit post-merge; do
  src="$ROOT/harness/hooks/$hook"
  dest="$HOOKS_DIR/$hook"
  cp "$src" "$dest"
  chmod +x "$dest"
  echo "Installed $hook → $dest"
done

# Install .cursorignore if the project doesn't have one yet
CURSORIGNORE_SRC="$ROOT/harness/templates/cursorignore"
CURSORIGNORE_DEST="$ROOT/.cursorignore"
if [[ -f "$CURSORIGNORE_SRC" ]]; then
  if [[ -f "$CURSORIGNORE_DEST" ]]; then
    echo "Keeping existing .cursorignore"
  else
    cp "$CURSORIGNORE_SRC" "$CURSORIGNORE_DEST"
    echo "Installed .cursorignore (secrets excluded from AI indexing)"
  fi
fi

echo ""
echo "Installing dependencies..."
cd "$ROOT"
if command -v bun >/dev/null 2>&1; then
  bun install
else
  npm install
fi

echo ""
echo "Combined harness installed. Next steps:"
echo "  1. Run 'bun lint:harness' to verify lint rules work"
echo "  2. Copy .env.example → .env.local and fill in real values (never commit .env.local)"
echo "  3. Optional: brew install gitleaks — enables full secret scan in pre-commit"
echo "  4. Read harness/AGENT-INSTRUCTIONS.md and docs/runtime-contract.md"
echo "  5. Run autonomous build: ./opencode-harness.sh \"your product prompt\""
