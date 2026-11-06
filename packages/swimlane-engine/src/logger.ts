/**
 * The engine's logger. v12 logged through mermaid's global logger, which a v13 plugin does not
 * have; here `warn` hands each message to the collector of the running `collectWarnings` call,
 * and every other level is dropped.
 */
type LogFn = (...args: unknown[]) => void;

let sink: ((message: string) => void) | undefined;

const ignore: LogFn = () => undefined;

const text = (args: unknown[]): string =>
  args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

export const log: Record<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', LogFn> = {
  trace: ignore,
  debug: ignore,
  info: ignore,
  warn: (...args) => sink?.(text(args)),
  error: ignore,
  fatal: ignore,
};

/**
 * Runs `run` and returns its result with every warning the engine logged meanwhile, in order.
 * Calls do not nest: an inner call takes the warnings until it returns.
 */
export function collectWarnings<T>(run: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const outer = sink;
  sink = (message) => warnings.push(message);
  try {
    return { result: run(), warnings };
  } finally {
    sink = outer;
  }
}
