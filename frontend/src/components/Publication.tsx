import { useEffect, useState } from 'react';
import type { Workspace, PdfJob, Release } from '../../../shared/contracts.js';
import { changes, changeStamp, summary } from '../../../shared/model.js';
import { api, send, downloadDraft } from '../api.js';
export function Publication({ initial }: { initial: Workspace }) {
  const [recovery] = useState<{ revision: number; title: string; log: string } | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('bunker-publication-v1') || 'null');
      return value &&
        typeof value.title === 'string' &&
        typeof value.log === 'string' &&
        typeof value.revision === 'number'
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const restored = recovery?.revision === initial.revision ? recovery : null;
  const [revision, setRevision] = useState(initial.revision),
    [title, setTitle] = useState(restored?.title || initial.release),
    [log, setLog] = useState(restored?.log ?? initial.changelog),
    [reviewed, setReviewed] = useState(
      !restored &&
        initial.changelogStamp === changeStamp(changes(initial.base, initial.cards)) &&
        Boolean(initial.changelog),
    ),
    [dirty, setDirty] = useState(Boolean(restored)),
    [job, setJob] = useState<PdfJob | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [releases, setReleases] = useState<Release[]>([]);
  useEffect(() => {
    if (!dirty) return;
    try {
      localStorage.setItem('bunker-publication-v1', JSON.stringify({ revision, title, log }));
    } catch {}
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, revision, title, log]);
  const diff = changes(initial.base, initial.cards);
  useEffect(() => {
    api<{ releases: Release[] }>('/api/releases')
      .then((v) => setReleases(v.releases))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (job?.status !== 'running') return;
    let cancelled = false;
    const timer = setInterval(() => {
      api<PdfJob>('/api/pdf/jobs/' + job.jobId)
        .then((j) => {
          if (!cancelled) setJob(j);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.jobId, job?.status]);
  async function build() {
    setBusy(true);
    setError('');
    try {
      const saved = await send<{ revision: number }>(
        '/api/workspace/meta',
        {
          revision,
          release: title,
          changelog: log,
          changelogStamp: reviewed ? changeStamp(diff) : '',
        },
        'PATCH',
      );
      setRevision(saved.revision);
      setDirty(false);
      localStorage.removeItem('bunker-publication-v1');
      const j = await send<PdfJob>('/api/pdf/build', { revision: saved.revision });
      setJob(await api<PdfJob>('/api/pdf/jobs/' + j.jobId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!job) return;
    setBusy(true);
    setError('');
    try {
      await send('/api/releases', { jobId: job.jobId, revision });
      window.location.href = '/admin?view=publish';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="heading">
        <div>
          <small>ВЕРСИИ ПРАВИЛ</small>
          <h1>Готовим новый выпуск.</h1>
          <p>{diff.length} карточек изменено. После публикации обновится каталог игроков.</p>
        </div>
      </div>
      {recovery && (
        <aside className="notice">
          Сохранена копия незавершённой сводки.{' '}
          <button onClick={() => downloadDraft(recovery)}>Скачать копию</button>
        </aside>
      )}
      <div className="publication">
        <section className="panel">
          <label>
            Название выпуска
            <input
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <button
            onClick={() => {
              if (log && !window.confirm('Заменить текущую сводку?')) return;
              setLog(summary(diff));
              setReviewed(false);
              setDirty(true);
            }}
          >
            Составить сводку изменений
          </button>
          <label>
            Сводка для игроков
            <textarea
              rows={19}
              value={log}
              onChange={(e) => {
                setLog(e.target.value);
                setReviewed(false);
                setDirty(true);
              }}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => {
                setReviewed(e.target.checked);
                setDirty(true);
              }}
            />
            Сводка проверена и готова для игроков
          </label>
          <button disabled={busy || job?.status === 'running' || !title.trim()} onClick={build}>
            Собрать PDF текущей версии
          </button>
          {job && (
            <div className="notice" role="status">
              {job.status === 'running' ? (
                'Собираем PDF…'
              ) : job.status === 'ready' ? (
                <>
                  <strong>PDF готов · {job.pages} страниц</strong>
                  <p>
                    <a href={job.url} target="_blank" rel="noreferrer">
                      Открыть PDF ↗
                    </a>{' '}
                    ·{' '}
                    <a
                      href={'/api/pdf/jobs/' + job.jobId + '/html'}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Печатный шаблон ↗
                    </a>
                  </p>
                </>
              ) : (
                job.error
              )}
            </div>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              dirty ||
              !reviewed ||
              !log.trim() ||
              job?.status !== 'ready' ||
              job.revision !== revision
            }
            onClick={publish}
          >
            Опубликовать для игроков
          </button>
          {error && <p role="alert">{error}</p>}
        </section>
        <section className="panel changelog">
          <small>ТАК УВИДЯТ ИГРОКИ</small>
          <h1>{title}</h1>
          {log.split(/\n\s*\n/).map((p, i) =>
            p.startsWith('### ') ? (
              <h3 key={i}>{p.slice(4)}</h3>
            ) : p.startsWith('## ') ? (
              <h2 key={i}>{p.slice(3)}</h2>
            ) : (
              <p className="description" key={i}>
                {p}
              </p>
            ),
          )}
        </section>
      </div>
      <section className="panel">
        <h2>Опубликованные версии</h2>
        {releases.length ? (
          releases.map((r) => (
            <p key={r.id}>
              <a href={'/releases/' + r.id} target="_blank" rel="noreferrer">
                {r.title}
              </a>{' '}
              ·{' '}
              <a href={'/releases/' + r.id + '/pdf'} target="_blank" rel="noreferrer">
                PDF
              </a>
            </p>
          ))
        ) : (
          <p>Первый выпуск ещё не опубликован.</p>
        )}
      </section>
    </>
  );
}
