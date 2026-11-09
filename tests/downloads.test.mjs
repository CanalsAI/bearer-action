import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const actionPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bearer-action-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const runner = join(root, 'runner');
  mkdirSync(runner);
  const output = join(root, 'output');
  const requests = join(root, 'requests');
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
set -eu
echo request >> "$FAKE_REQUESTS"
if [[ "\${FAKE_HTTP_FAILURE:-false}" == true ]]; then exit 22; fi
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then output="$2"; shift 2; else shift; fi
done
cp "$FAKE_DOWNLOAD" "$output"
`, { mode: 0o755 });
  const source = join(root, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'bearer'), '#!/usr/bin/env bash\necho fixture-bearer\n', { mode: 0o755 });
  const archive = join(root, 'fixture.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', source, 'bearer']).status, 0);
  const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TEMP: runner,
    GITHUB_OUTPUT: output,
    GITHUB_TOKEN: '',
    BEARER_ARCHIVE: join(runner, 'downloads', 'bearer.tar.gz'),
    BEARER_URL: 'https://github.com/Bearer/bearer/releases/download/v2.1.3/bearer_2.1.3_linux_amd64.tar.gz',
    BEARER_CHECKSUM: checksum,
    BEARER_RELEASE_FILE: join(runner, 'release.json'),
    BEARER_RELEASE_URL: 'https://api.github.com/repos/Bearer/bearer/releases/latest',
    BEARER_PLATFORM: 'linux_amd64',
    BEARER_RELEASE_CACHE_HIT: '',
    BEARER_RULES_DIRECTORY: join(root, 'rules'),
    FAKE_REQUESTS: requests,
    FAKE_DOWNLOAD: archive,
  };
  return {
    root, runner, archive, env,
    run(script, overrides = {}) {
      writeFileSync(output, '');
      return spawnSync('bash', [join(actionPath, 'scripts', script)], {
        env: { ...env, ...overrides }, encoding: 'utf8',
      });
    },
    outputs() {
      return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => {
        const split = line.indexOf('=');
        return [line.slice(0, split), line.slice(split + 1)];
      }));
    },
    requestCount() {
      return existsSync(requests) ? readFileSync(requests, 'utf8').trim().split('\n').length : 0;
    },
    releaseData(version = '2.1.3', digest = checksum, ageDays = 30) {
      return {
        tag_name: `v${version}`,
        draft: false,
        prerelease: false,
        published_at: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        assets: [{ name: `bearer_${version}_linux_amd64.tar.gz`, digest: `sha256:${digest}` }],
      };
    },
    release(version = '2.1.3', digest = checksum) {
      const file = join(root, `release-${version}.json`);
      writeFileSync(file, JSON.stringify(this.releaseData(version, digest)));
      return file;
    },
  };
}

test('installs a verified download and reuses it with the network unavailable', t => {
  const f = fixture(t);
  assert.equal(f.run('install.sh').status, 0);
  assert.equal(f.requestCount(), 1);
  assert.equal(spawnSync(join(f.runner, 'bearer'), [], { encoding: 'utf8' }).stdout.trim(), 'fixture-bearer');
  assert.equal(f.run('install.sh', { FAKE_HTTP_FAILURE: 'true' }).status, 0);
  assert.equal(f.requestCount(), 1);
});

test('repairs a corrupt restored binary archive before executing it', t => {
  const f = fixture(t);
  mkdirSync(dirname(f.env.BEARER_ARCHIVE), { recursive: true });
  writeFileSync(f.env.BEARER_ARCHIVE, 'bad cache entry');
  assert.equal(f.run('install.sh').status, 0);
  assert.deepEqual(readFileSync(f.env.BEARER_ARCHIVE), readFileSync(f.archive));
  assert.equal(f.requestCount(), 1);
});

for (const failure of ['http', 'checksum']) {
  test(`does not cache or execute a download with a ${failure} failure`, t => {
    const f = fixture(t);
    const result = f.run('install.sh', failure === 'http'
      ? { FAKE_HTTP_FAILURE: 'true' }
      : { BEARER_CHECKSUM: '0'.repeat(64) });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(f.env.BEARER_ARCHIVE), false);
    assert.equal(existsSync(join(f.runner, 'bearer')), false);
  });
}

test('caches release lookup, then selects a newly published release on refresh', t => {
  const f = fixture(t);
  assert.equal(f.run('download-info.sh', { FAKE_DOWNLOAD: f.release() }).status, 0);
  const previousKey = f.outputs()['binary-key'];
  assert.equal(f.run('download-info.sh', { BEARER_RELEASE_CACHE_HIT: 'true', FAKE_HTTP_FAILURE: 'true' }).status, 0);
  assert.equal(f.requestCount(), 1);
  assert.equal(f.run('download-info.sh', { FAKE_DOWNLOAD: f.release('2.1.4', 'a'.repeat(64)) }).status, 0);
  assert.notEqual(f.outputs()['binary-key'], previousKey);
  assert.match(f.outputs().url, /\/v2\.1\.4\/bearer_2\.1\.4_linux_amd64\.tar\.gz$/);
});

test('retains a previously validated release when refresh fails', t => {
  const f = fixture(t);
  writeFileSync(f.env.BEARER_RELEASE_FILE, readFileSync(f.release()));
  const result = f.run('download-info.sh', { FAKE_HTTP_FAILURE: 'true' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /last validated cached release/);
  assert.match(f.outputs().url, /\/v2\.1\.3\//);
});

test('selects the highest eligible version while quarantining new releases and drafts', t => {
  const f = fixture(t);
  const candidates = [
    f.releaseData('2.1.9'),
    f.releaseData('2.1.10', 'a'.repeat(64), 8),
    f.releaseData('2.1.11', 'b'.repeat(64), 1),
    { ...f.releaseData('3.0.0'), draft: true },
    { ...f.releaseData('4.0.0'), prerelease: true },
  ];
  const response = join(f.root, 'releases.json');
  writeFileSync(response, JSON.stringify(candidates));
  assert.equal(f.run('download-info.sh', { FAKE_DOWNLOAD: response }).status, 0);
  assert.match(f.outputs().url, /\/v2\.1\.10\//);
});

test('rejects a quarantined release even when its daily cache key matches', t => {
  const f = fixture(t);
  const response = join(f.root, 'young-release.json');
  writeFileSync(response, JSON.stringify(f.releaseData('2.1.4', 'a'.repeat(64), 1)));
  writeFileSync(f.env.BEARER_RELEASE_FILE, readFileSync(response));
  assert.notEqual(f.run('download-info.sh', {
    BEARER_RELEASE_CACHE_HIT: 'true', FAKE_DOWNLOAD: response,
  }).status, 0);
  assert.deepEqual(f.outputs(), {});
});

test('fails closed when neither the response nor the cached release is valid', t => {
  const f = fixture(t);
  const badResponse = join(f.root, 'response');
  writeFileSync(badResponse, '<html>upstream error</html>');
  assert.notEqual(f.run('download-info.sh', { FAKE_DOWNLOAD: badResponse }).status, 0);
  assert.equal(existsSync(f.env.BEARER_RELEASE_FILE), false);
  assert.deepEqual(f.outputs(), {});
});

test('removes a poisoned rule download while preserving a valid cached archive', t => {
  const f = fixture(t);
  mkdirSync(f.env.BEARER_RULES_DIRECTORY);
  const valid = join(f.env.BEARER_RULES_DIRECTORY, 'valid.tar.gz');
  const poisoned = join(f.env.BEARER_RULES_DIRECTORY, 'poisoned.tar.gz');
  writeFileSync(valid, readFileSync(f.archive));
  writeFileSync(poisoned, '<html>upstream error</html>');
  assert.equal(f.run('validate-rules.sh').status, 0);
  assert.equal(existsSync(poisoned), false);
  assert.deepEqual(readFileSync(valid), readFileSync(f.archive));
});
