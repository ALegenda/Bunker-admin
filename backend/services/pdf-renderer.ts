import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import type { PdfLog } from './pdf-log.js';
import { config } from '../config.js';
export async function renderPdf(html: string, log?: PdfLog) {
  const measure = <T>(name: string, action: () => Promise<T>) =>
    log ? log.stage(name, action) : action();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunker-pdf-'));
  try {
    const input = path.join(dir, 'rules.html'),
      output = path.join(dir, 'rules.pdf');
    await measure('pdf.write_html', () => writeFile(input, html));
    await measure(
      'chromium.print',
      () =>
        new Promise<void>((resolve, reject) => {
          let done = false,
            lastSize = 0,
            stable = 0;
          log?.event('chromium.launch', { timeoutMs: 120000, virtualTimeBudgetMs: 5000 });
          const child = spawn(
            config.CHROME_PATH,
            [
              '--headless',
              '--disable-gpu',
              '--disable-dev-shm-usage',
              '--renderer-process-limit=2',
              '--disable-extensions',
              '--disable-background-networking',
              '--no-first-run',
              '--no-default-browser-check',
              ...(process.getuid?.() === 0 || config.CHROMIUM_NO_SANDBOX === 'true'
                ? ['--no-sandbox']
                : []),
              `--user-data-dir=${path.join(dir, 'profile')}`,
              '--no-pdf-header-footer',
              '--virtual-time-budget=5000',
              `--print-to-pdf=${output}`,
              `file://${input}`,
            ],
            {
              stdio: 'ignore',
              env: {
                ...process.env,
                XDG_CONFIG_HOME: path.join(dir, 'config'),
                XDG_CACHE_HOME: path.join(dir, 'cache'),
              },
            },
          );
          const finish = (error?: Error) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            clearInterval(poll);
            child.kill('SIGTERM');
            setTimeout(() => {
              if (child.exitCode === null) child.kill('SIGKILL');
            }, 1500).unref();
            error ? reject(error) : resolve();
          };
          const timeout = setTimeout(() => {
            log?.event('chromium.timeout', { lastPdfBytes: lastSize, stablePolls: stable });
            finish(Error('Время сборки PDF истекло'));
          }, 120000);
          let fileSeen = false;
          // Chrome can leave background processes alive after writing the PDF. Wait for a
          // complete, stable file rather than relying on the browser's lifetime.
          const poll = setInterval(async () => {
            try {
              const info = await stat(output);
              if (!fileSeen) {
                fileSeen = true;
                log?.event('chromium.output_detected', { bytes: info.size });
              }
              stable = info.size === lastSize ? stable + 1 : 0;
              lastSize = info.size;
              if (stable >= 2) {
                const bytes = await readFile(output);
                if (bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) finish();
              }
            } catch {}
          }, 500);
          child.on('spawn', () => log?.event('chromium.spawned', { pid: child.pid }));
          child.on('error', (e) => finish(e));
          child.on('exit', (code, signal) => {
            log?.event('chromium.exit', { code, signal, completionHandled: done });
            if (code !== 0 && !done) finish(Error('Не удалось запустить печать PDF'));
          });
        }),
    );
    const data = await measure('pdf.read', () => readFile(output));
    const doc = await measure('pdf.validate', () => PDFDocument.load(data));
    if (doc.getPageCount() < 1) throw Error('Пустой PDF');
    log?.event('pdf.validated', { bytes: data.length, pages: doc.getPageCount() });
    return { data, pages: doc.getPageCount() };
  } finally {
    await measure('pdf.cleanup', () =>
      rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }),
    );
  }
}
