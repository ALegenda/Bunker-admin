import React, { useEffect, useState } from 'react';
import type { Workspace, PdfJob, Release } from '../../../shared/contracts.js';
import { changes, changeStamp, summary } from '../../../shared/model.js';
import { publicationBlocker } from '../publication-state.js';
import { api, send, downloadDraft } from '../api.js';
export function Publication({ initial }: { initial: Workspace }) {
  const [recovery] = useState<{
    revision: number;
    title: string;
    log: string;
    reviewed?: boolean;
  } | null>(() => {
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
    [log, setLog] = useState(
      restored?.log ?? (initial.changelog || summary(changes(initial.base, initial.cards))),
    ),
    [reviewed, setReviewed] = useState(
      restored
        ? Boolean(restored.reviewed)
        : initial.changelogStamp === changeStamp(changes(initial.base, initial.cards)) &&
            Boolean(initial.changelog),
    ),
    [dirty, setDirty] = useState(Boolean(restored)),
    [job, setJob] = useState<PdfJob | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [releases, setReleases] = useState<Release[]>([]),
    [savedContent, setSavedContent] = useState({ title: initial.release, log: initial.changelog }),
    [loadingJob, setLoadingJob] = useState(true);
  const contentChanged = title !== savedContent.title || log !== savedContent.log;
  const blocker = publicationBlocker({
    busy,
    loadingJob,
    title,
    log,
    reviewed,
    contentChanged,
    revision,
    job,
  });
  useEffect(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(
        'bunker-publication-v1',
        JSON.stringify({ revision, title, log, reviewed }),
      );
    } catch {}
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, revision, title, log, reviewed]);
  const diff = changes(initial.base, initial.cards);
  useEffect(() => {
    let cancelled = false;
    api<{ job: PdfJob | null }>('/api/pdf/current')
      .then(({ job }) => {
        if (!cancelled) setJob(job);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingJob(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    api<{ releases: Release[] }>('/api/releases')
      .then((v) => setReleases(v.releases))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (job?.status !== 'running') return;
    let cancelled = false;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      api<PdfJob>('/api/pdf/jobs/' + job.jobId)
        .then((j) => {
          if (!cancelled) {
            setJob(j);
            setError('');
          }
        })
        .catch((e) => {
          if (!cancelled)
            setError('Не удалось проверить готовность PDF. Повторяем автоматически. ' + e.message);
        })
        .finally(() => {
          pending = false;
        });
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.jobId, job?.status]);
  async function saveMeta() {
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
    setSavedContent({ title, log });
    setDirty(false);
    try {
      localStorage.removeItem('bunker-publication-v1');
    } catch {}
    return saved.revision;
  }
  async function build() {
    setBusy(true);
    setError('');
    try {
      const savedRevision = await saveMeta();
      const j = await send<Pick<PdfJob, 'jobId' | 'status'>>('/api/pdf/build', {
        revision: savedRevision,
      });
      // Keep the ID immediately so polling can recover even if the first GET fails.
      setJob({ ...j, revision: savedRevision });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!job || blocker) return;
    setBusy(true);
    setError('');
    try {
      const savedRevision = await saveMeta();
      await send('/api/releases', { jobId: job.jobId, revision: savedRevision });
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
          <p>
            Правки карточек сохраняются автоматически в редакторе. Здесь вы выпускаете версию для
            игроков.
          </p>
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
              disabled={busy}
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <p>
            Сводка составляется автоматически после каждого изменения карточек. Текст можно
            отредактировать перед выпуском; следующая правка карточек составит его заново.
          </p>
          <label>
            Сводка для игроков
            <textarea
              disabled={busy}
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
              disabled={busy}
              type="checkbox"
              checked={reviewed}
              onChange={(e) => {
                setReviewed(e.target.checked);
                setDirty(true);
              }}
            />
            Сводка проверена и готова для игроков
          </label>
          <button
            disabled={
              busy ||
              loadingJob ||
              (job?.status === 'running' && job.revision === revision) ||
              !title.trim()
            }
            onClick={build}
          >
            Собрать PDF текущей версии
          </button>
          {job && (
            <div className="notice" role="status">
              {job.status === 'running' ? (
                'Собираем PDF…'
              ) : job.status === 'ready' ? (
                <>
                  <strong>PDF готов{job.pages ? ` · ${job.pages} страниц` : ''}</strong>
                  <p>
                    <a
                      href={job.url || `/api/pdf/jobs/${job.jobId}/file`}
                      target="_blank"
                      rel="noreferrer"
                    >
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
            disabled={Boolean(blocker)}
            aria-describedby="publication-status"
            onClick={publish}
          >
            Опубликовать для игроков
          </button>
          <p id="publication-status" role="status">
            {blocker || 'Всё готово. Можно опубликовать версию для игроков.'}
          </p>
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
