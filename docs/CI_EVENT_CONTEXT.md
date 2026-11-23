# CI event context and offline verification

The `paths` job in `.github/workflows/ci.yml` chooses the change set from the
event that triggered the run:

- On `pull_request`, `scripts/ci/changed-paths.mjs` reads the base commit from
  `GITHUB_EVENT_PATH`. A populated `github.event.before` does not override that
  PR base: a previous fork head may be absent after a rebase or force push.
- On `push`, the workflow passes a nonzero `github.event.before` as `--base`.
- When the base cannot be determined, the driver still exits unsuccessfully,
  emits `unknown=1`, and enables every tier. This fallback remains fail closed.

The shell passes arguments in an array and prints path outputs through
environment variables. JSON array quotes in `tiers_json` therefore remain data
instead of becoming shell syntax.

`check:driver-parity` runs the TypeScript classifier through `tsx` in the
repository's CommonJS context. This preserves Node 22 compatibility and compares
the same 43 probes against the plain JavaScript driver.

The trader journal rejection tests construct their synthetic seed-shaped value
at runtime. The source scan remains enabled, and the runtime signing-material
rejection remains covered.

Run the focused offline checks from the repository root after `npm ci`:

```sh
node --import tsx --test tests/node/ci-workflow-context.test.ts tests/node/ci-path-scope.test.ts tests/node/traders-policy.test.ts
npm run check:terms
npm run check:driver-parity
```

The context regression tests create temporary Git repositories. They exercise
the actual workflow shell block with a PR base plus a missing previous head,
a push before commit, and a missing PR base. The last case must still fail and
enable every tier. A separate check invokes the real driver-parity CLI.

These repairs do not establish that typechecking, contract compilation, the
dependency audit, or the full application build passes. Each gate reports its
own result and remains enabled.
