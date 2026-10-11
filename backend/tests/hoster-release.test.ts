import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const previous = 'a'.repeat(40);
const release = 'b'.repeat(40);
const image = (sha: string) => `bunker-production:${sha}`;
const run = promisify(execFile);

// Execute the real release script in a temporary filesystem. Only Docker,
// HTTPS and backup are replaced; Compose edits, traps and manifests stay real.
// Each fixture has its own root, so its lock cannot contend with another test.
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bunker-release-test-'));
  const bin = path.join(root, 'bin');
  const source = path.join(root, 'releases', release, 'source');
  await mkdir(bin);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'Dockerfile'), 'FROM scratch\n');
  const compose = `x-app:\n  image: ${image(previous)}\nservices: {}\n`;
  await writeFile(path.join(root, 'compose.yaml'), compose);
  await writeFile(path.join(root, 'active.json'), JSON.stringify({ release: previous }));
  const statePath = path.join(root, 'state.json');
  await writeFile(
    statePath,
    JSON.stringify({
      events: [],
      containers: Object.fromEntries(
        ['api', 'worker'].map((service) => [
          service,
          { Config: { Image: image(previous) }, State: { Running: true }, RestartCount: 0 },
        ]),
      ),
    }),
  );
  const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.RELEASE_TEST_ROOT;
const file = path.join(root, 'state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const fail = () => { save(); process.exit(1); };
if (command === 'curl') {
  if (state.failHealth) process.exit(22);
  process.stdout.write('{"status":"ok"}');
} else if (command === 'sleep' || command === 'flock') {
  // Health retries should not add wall-clock delays to a failing fixture.
} else if (command === 'backup') {
  state.events.push('backup'); save();
} else if (args[0] === 'build') {
  state.events.push('build'); save();
} else if (args[0] === 'inspect') {
  process.stdout.write(JSON.stringify([state.containers[args[1]]]));
} else if (args[0] === 'compose') {
  if (args[1] === 'exec' && args.at(-1) === 'scripts/check-mcp.mjs') {
    state.events.push('mcp-check');
    if (state.failMcp) fail();
    save();
  } else if (args[1] === 'run') {
    state.events.push('seed');
    if (state.failSeed) fail();
    save();
  } else if (args[1] === 'ps') {
    const service = args.at(-1);
    if (state.containers[service].State.Running) process.stdout.write(service);
  } else if (args[1] === 'stop') {
    state.containers.worker.State.Running = false; save();
  } else if (args[1] === 'up') {
    const image = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8').match(/^  image: (.+)$/m)[1];
    for (const service of args.filter(arg => ['api', 'worker'].includes(arg))) {
      state.events.push('up:' + service + ':' + image);
      if (state.failWorker && service === 'worker' && image.endsWith('${release}')) fail();
      state.containers[service] = { Config: { Image: image }, State: { Running: true }, RestartCount: 0 };
      save();
      if (state.interruptApi && service === 'api' && image.endsWith('${release}')) {
        process.kill(process.ppid, 'SIGTERM');
      }
    }
  } else fail();
} else fail();
`;
  for (const name of ['docker', 'curl', 'sleep', 'flock', 'backup']) {
    await writeFile(path.join(bin, name), mock, { mode: 0o755 });
  }
  await writeFile(path.join(root, 'backup.sh'), 'exec backup\n');
  const scriptPath = path.join(root, 'release.sh');
  const script = await readFile('deploy/hoster-release.sh', 'utf8');
  await writeFile(scriptPath, script.replace('root=/opt/bunker-production', `root='${root}'`));
  const state = async () => JSON.parse(await readFile(statePath, 'utf8'));
  return {
    root,
    compose,
    state,
    update: async (patch: object) =>
      writeFile(statePath, JSON.stringify({ ...(await state()), ...patch })),
    execute: () =>
      run('bash', [scriptPath, release], {
        env: {
          ...process.env,
          // Standalone command fixtures do not use the app's preload modules.
          NODE_OPTIONS: '',
          PATH: bin + path.delimiter + process.env.PATH,
          RELEASE_TEST_ROOT: root,
        },
        timeout: 20000,
      }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('Hoster release activates the verified image and safely rechecks an identical retry', async () => {
  const f = await fixture();
  try {
    await f.execute();
    assert.equal(
      JSON.parse(await readFile(path.join(f.root, 'active.json'), 'utf8')).release,
      release,
    );
    const first = await f.state();
    assert.deepEqual(first.events.slice(0, 3), ['build', 'backup', 'seed']);
    for (const service of ['api', 'worker']) {
      assert.equal(first.containers[service].Config.Image, image(release));
      assert.equal(first.containers[service].State.Running, true);
    }
    assert.match((await f.execute()).stdout, /Already deployed/);
    assert.deepEqual((await f.state()).events, [...first.events, 'mcp-check']);
  } finally {
    await f.cleanup();
  }
});

test('Hoster release rolls back both services if MCP cannot read production content', async () => {
  const f = await fixture();
  try {
    await f.update({ failMcp: true });
    await assert.rejects(f.execute(), (error: any) => {
      assert.match(error.stderr, /Previous application image restored/);
      return true;
    });
    assert.ok((await f.state()).events.includes('mcp-check'));
    assert.equal(await readFile(path.join(f.root, 'compose.yaml'), 'utf8'), f.compose);
    assert.equal(
      JSON.parse(await readFile(path.join(f.root, 'active.json'), 'utf8')).release,
      previous,
    );
    for (const service of ['api', 'worker'])
      assert.equal((await f.state()).containers[service].Config.Image, image(previous));
  } finally {
    await f.cleanup();
  }
});

test('Hoster release restores the previous image after failed seed and allows a corrected retry', async () => {
  const f = await fixture();
  try {
    await f.update({ failSeed: true });
    await assert.rejects(f.execute(), (error: any) => {
      assert.match(error.stderr, /Previous application image restored/);
      return true;
    });
    assert.equal((await f.state()).events.filter((e: string) => e === 'seed').length, 1);
    assert.equal(await readFile(path.join(f.root, 'compose.yaml'), 'utf8'), f.compose);
    assert.equal(
      JSON.parse(await readFile(path.join(f.root, 'active.json'), 'utf8')).release,
      previous,
    );
    for (const service of ['api', 'worker']) {
      assert.equal((await f.state()).containers[service].Config.Image, image(previous));
    }
    await f.update({ failSeed: false });
    await f.execute();
    assert.equal(
      JSON.parse(await readFile(path.join(f.root, 'active.json'), 'utf8')).release,
      release,
    );
  } finally {
    await f.cleanup();
  }
});

test('Hoster release rolls back both services if the worker fails to start', async () => {
  const f = await fixture();
  try {
    await f.update({ failWorker: true });
    await assert.rejects(f.execute(), (error: any) => {
      assert.match(error.stderr, /Previous application image restored/);
      return true;
    });
    assert.ok((await f.state()).events.includes('up:api:' + image(release)));
    assert.equal(await readFile(path.join(f.root, 'compose.yaml'), 'utf8'), f.compose);
    for (const service of ['api', 'worker']) {
      const container = (await f.state()).containers[service];
      assert.equal(container.Config.Image, image(previous));
      assert.equal(container.State.Running, true);
    }
  } finally {
    await f.cleanup();
  }
});

test('Hoster release rolls back on interruption after switching the API image', async () => {
  const f = await fixture();
  try {
    await f.update({ interruptApi: true });
    await assert.rejects(f.execute(), (error: any) => {
      assert.equal(error.code, 143);
      assert.match(error.stderr, /Previous application image restored/);
      return true;
    });
    assert.equal(await readFile(path.join(f.root, 'compose.yaml'), 'utf8'), f.compose);
    assert.equal(
      JSON.parse(await readFile(path.join(f.root, 'active.json'), 'utf8')).release,
      previous,
    );
    for (const service of ['api', 'worker']) {
      const container = (await f.state()).containers[service];
      assert.equal(container.Config.Image, image(previous));
      assert.equal(container.State.Running, true);
    }
  } finally {
    await f.cleanup();
  }
});
