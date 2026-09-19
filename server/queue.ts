// Separate bounded queues keep downloads moving while Gemini processes earlier images.
export function createLimiter(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function run<T>(
    task: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    if (active >= limit)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const i = waiters.indexOf(ready);
          if (i >= 0) waiters.splice(i, 1);
          reject(signal.reason);
        };
        waiters.push(ready);
        signal.addEventListener("abort", abort, { once: true });
      });
    else active++;
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active--;
    }
  };
}
