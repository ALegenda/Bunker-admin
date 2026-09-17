import { performance } from 'node:perf_hooks';

type Fields = Record<string, unknown>;
export type PdfLog = ReturnType<typeof createPdfLog>;

// Never pass document content, credentials or image data as log fields.
export function pdfError(error: unknown) {
  const e = error as { name?: string; message?: string; code?: string } | null;
  return {
    errorName: e?.name || 'Error',
    errorMessage: String(e?.message || error)
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@')
      .slice(0, 1000),
    errorCode: e?.code,
  };
}

export function createPdfLog(context: Fields, write: (line: string) => void = console.log) {
  const started = performance.now();
  const event = (name: string, fields: Fields = {}) =>
    write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        component: 'pdf',
        ...context,
        event: name,
        elapsedMs: Math.round(performance.now() - started),
        ...fields,
      }),
    );
  async function stage<T>(name: string, action: () => Promise<T>, fields: Fields = {}): Promise<T> {
    const start = performance.now();
    const duration = () => Math.round(performance.now() - start);
    event(`${name}.started`, fields);
    const timer = setInterval(
      () => event(`${name}.waiting`, { ...fields, durationMs: duration() }),
      15000,
    );
    timer.unref();
    try {
      const result = await action();
      event(`${name}.completed`, { ...fields, durationMs: duration() });
      return result;
    } catch (error) {
      event(`${name}.failed`, { ...fields, durationMs: duration(), ...pdfError(error) });
      throw error;
    } finally {
      clearInterval(timer);
    }
  }
  return { event, stage };
}
