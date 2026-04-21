# Contributing

## Release & versioning

Claude Bridge is versioned via the `version` field in `package.json` and the `CHANGELOG.md`. Every merge to `main` that bumps the version:

1. Builds the `.vsix` (`npm run package`)
2. Creates a GitHub Release tagged `v{VERSION}` with the `.vsix` attached as a release asset and the merged PR body as release notes
3. Publishes to the VS Code Marketplace via `vsce publish`

Pipeline: `pipeline.yml` (push to main) → `step-release.yml`.

### Required secret

`VSCE_PAT` — Azure DevOps Personal Access Token with **Marketplace → Manage** scope, scoped to publisher `Daniel-Manea`. Set via:

```bash
gh secret set VSCE_PAT
```

The release pipeline fails fast with a clear error if this secret is missing.

### Version bump rules

Pick the bump from the PR title prefix (Conventional Commits):

| Prefix                    | Bump     | Examples                          |
| ------------------------- | -------- | --------------------------------- |
| `feat(scope):`            | MINOR    | New command, new lightbulb action |
| `fix(scope):` `perf:`     | PATCH    | Bug fix, performance improvement  |
| `feat!(scope):` / `BREAKING CHANGE:` in body | MAJOR | Removing a setting, breaking config |
| `chore:` `docs:` `ci:` `test:` `refactor:` `build:` | none | Apply `no-release` label |

### Required edits for any release PR

1. Bump `package.json` → `version`.
2. Add a `## <version>` section to `CHANGELOG.md` (Keep a Changelog format: Added / Changed / Fixed / Removed).

The `validate-pr.yml` workflow fails the PR if either is skipped. Apply the `no-release` label to waive both checks for chore/docs/ci-only PRs.

## PR title

Enforced by `pr-title-lint.yml` (Conventional Commits). Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `release`. Subject must start lowercase.

## Squash merge

Always squash. The commit title = PR title (required for release notes to tie back to the PR).

## Local development

```bash
npm install
npm run compile
npm test
npm run package    # produces claude-vscode-bridge-<version>.vsix
```

## Branch protection (Settings → Branches → main)

Required checks: `Compile & Test` (ci), `Require version bump + CHANGELOG entry` (validate-pr), `Validate PR title` (pr-title-lint). Linear history. Squash-merge only.
