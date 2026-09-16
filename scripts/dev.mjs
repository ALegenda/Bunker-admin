import { spawn } from 'node:child_process';
const children = ['backend/http/server.ts', 'backend/worker.ts'].map((file) =>
  spawn(process.execPath, ['--import', 'tsx', file], { stdio: 'inherit' }),
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const c of children)
  c.on('exit', (code) => {
    stop();
    process.exitCode = code || 0;
  });
