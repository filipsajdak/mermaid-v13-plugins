/**
 * Runs a parser export in a worker thread, so a parse that never ends fails the test instead of
 * hanging the run: the worker loads the TypeScript source with Node's type stripping and is
 * terminated at `hangLimitMs`.
 */
import { Worker } from 'node:worker_threads';

/** What a bounded parse reports: its time inside the worker and its diagnostics' codes. */
export interface BoundedParse {
  readonly ms: number;
  readonly codes: readonly string[];
  readonly model: unknown;
}

const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.module).then((m) => {
  const start = performance.now();
  const r = m[workerData.fn](workerData.text);
  const ms = performance.now() - start;
  parentPort.postMessage({ ms, codes: r.diagnostics.map((d) => d.code), model: r.model });
});
`;

/**
 * Parses `text` with the export `fn` of the module at `moduleUrl`. Rejects when the worker has
 * not answered within `hangLimitMs`, or when it fails.
 */
export function boundedParse(
  moduleUrl: string,
  fn: string,
  text: string,
  hangLimitMs: number,
): Promise<BoundedParse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      eval: true,
      execArgv: ['--experimental-strip-types', '--no-warnings'],
      workerData: { module: moduleUrl, fn, text },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`${fn} did not finish within ${String(hangLimitMs)} ms`));
    }, hangLimitMs);
    worker.once('message', (m: BoundedParse) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(m);
    });
    worker.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
