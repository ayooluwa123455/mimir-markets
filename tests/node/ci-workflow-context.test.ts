import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
// Exercise the actual workflow shell block so a regression in its event guard
// cannot be hidden by testing only the changed-path driver's PR parser.
const block = workflow.match(/      - id: paths\n[\s\S]*?        run: \|\n((?:          .*\n)+)/)?.[1];
assert.ok(block, "paths step must expose its shell block");
const command = block.replace(/^          /gm, "");

function fixture(t: { after: (callback: () => void) => void }) {
  const directory = mkdtempSync(path.join(tmpdir(), "mimir-ci-context-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "scripts/ci"), { recursive: true });
  mkdirSync(path.join(directory, "app"));
  copyFileSync(path.join(root, "scripts/ci/changed-paths.mjs"), path.join(directory, "scripts/ci/changed-paths.mjs"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=CI Fixture", "-c", "user.email=ci@example.invalid", "commit", "--quiet", "-m", "synthetic fixture");
    return git("rev-parse", "HEAD");
  };
  writeFileSync(path.join(directory, "app/fixture.ts"), "export const value = 1;\n");
  const base = commit();
  writeFileSync(path.join(directory, "app/fixture.ts"), "export const value = 2;\n");
  commit();
  const event = path.join(directory, "event.json");
  const output = path.join(directory, "output.txt");
  return {
    base,
    run(eventName: string, before: string, payload: unknown) {
      writeFileSync(event, JSON.stringify(payload));
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-e", "-c", command], {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, EVENT_NAME: eventName, BEFORE: before, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output },
      });
      return { ...result, output: readFileSync(output, "utf8") };
    },
  };
}

test("PR path detection ignores an unavailable push before commit", (t) => {
  const f = fixture(t);
  const result = f.run("pull_request", "f".repeat(40), { pull_request: { base: { sha: f.base, ref: "main" } } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /^tiers_json=\["app"\]$/m);
  assert.match(result.output, new RegExp(`^base=${f.base}$`, "m"));
  assert.doesNotMatch(result.output, /^unknown=1$/m);
});

test("push path detection uses the previous push commit", (t) => {
  const f = fixture(t);
  const result = f.run("push", f.base, {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /^tiers_json=\["app"\]$/m);
});

test("missing PR base still fails closed and enables all tiers", (t) => {
  const f = fixture(t);
  const result = f.run("pull_request", f.base, {});
  assert.equal(result.status, 1);
  assert.match(result.output, /^unknown=1$/m);
  assert.match(result.output, /^tiers_json=\["app","agents","contracts","tests"\]$/m);
});

test("driver parity CLI loads the TypeScript scope classifier on Node 22", () => {
  const result = spawnSync(process.execPath, ["scripts/ci/check-driver-parity.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /matches path-scope\.ts/);
});
