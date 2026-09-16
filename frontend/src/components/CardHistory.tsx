import React, { useState } from 'react';
import type { CardHistoryEntry } from '../../../shared/contracts.js';
import { descriptionText } from '../../../shared/rich-text.js';
import { historyChanges, historyTitle, historyValue, textChanges } from '../card-history.js';
import { RichDescription } from './RichDescription.js';

function SnapshotValue({ field, value }: { field: string; value: unknown }) {
  if (field === 'description' && value) return <RichDescription value={String(value)} />;
  if (field === 'image' && typeof value === 'string' && /^(\/[^/]|https?:\/\/)/i.test(value))
    return (
      <a href={value} target="_blank" rel="noreferrer">
        <img className="history-image" src={value} alt="Изображение карточки" loading="lazy" />
      </a>
    );
  return <div className="description">{historyValue(value)}</div>;
}

export function HistoryDetails({ entry }: { entry: CardHistoryEntry }) {
  const changes = historyChanges(entry);
  return (
    <div className="history-details">
      {changes.length ? (
        changes.map((change) => (
          <section key={change.field} className="history-field">
            <h3>{change.label}</h3>
            {change.field === 'description' &&
            !change.formatOnly &&
            entry.before_data &&
            entry.after_data ? (
              <>
                <p className="history-legend">Удалённое зачёркнуто, добавленное подчёркнуто.</p>
                <div className="history-text-diff">
                  {textChanges(
                    descriptionText(String(change.before ?? '')),
                    descriptionText(String(change.after ?? '')),
                  ).map((part, i) =>
                    part.kind === 'removed' ? (
                      <del key={i}>{part.text}</del>
                    ) : part.kind === 'added' ? (
                      <ins key={i}>{part.text}</ins>
                    ) : (
                      <React.Fragment key={i}>{part.text}</React.Fragment>
                    ),
                  )}
                </div>
                <details>
                  <summary>Полные версии с оформлением</summary>
                  <div className="history-comparison">
                    <div className="history-before">
                      <strong>Было</strong>
                      <SnapshotValue field={change.field} value={change.before} />
                    </div>
                    <div className="history-after">
                      <strong>Стало</strong>
                      <SnapshotValue field={change.field} value={change.after} />
                    </div>
                  </div>
                </details>
              </>
            ) : (
              <>
                {change.formatOnly && (
                  <p className="history-legend">
                    Изменено только оформление. Текст остался прежним.
                  </p>
                )}
                <div className="history-comparison">
                  {entry.before_data && (
                    <div className="history-before">
                      <strong>{entry.after_data ? 'Было' : 'До архивации'}</strong>
                      <SnapshotValue field={change.field} value={change.before} />
                    </div>
                  )}
                  {entry.after_data && (
                    <div className="history-after">
                      <strong>{entry.before_data ? 'Стало' : 'При добавлении'}</strong>
                      <SnapshotValue field={change.field} value={change.after} />
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        ))
      ) : (
        <p>Изменений полей карточки не зафиксировано.</p>
      )}
    </div>
  );
}

function HistoryItem({ entry }: { entry: CardHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const system = entry.action.startsWith('source.');
  return (
    <details className="history-entry" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <strong>{historyTitle(entry)}</strong>
        <span className="history-meta">
          {entry.display_name || (system ? 'Система' : 'Автор не указан')} ·{' '}
          <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('ru')}</time>
        </span>
        {entry.after_data?.kind && <span className="history-kind">{entry.after_data.kind}</span>}
        {entry.after_data?.note?.trim() && (
          <span className="history-note">Комментарий для сводки: {entry.after_data.note}</span>
        )}
      </summary>
      {open && <HistoryDetails entry={entry} />}
    </details>
  );
}

export function CardHistory({
  entries,
  error,
  onRetry,
}: {
  entries: CardHistoryEntry[] | null;
  error: string;
  onRetry: () => void;
}) {
  return (
    <section aria-label="История правок">
      <h2>История правок</h2>
      <p className="history-help">
        Сохранённые изменения карточки, от новых к старым. Раскройте запись для сравнения.
      </p>
      {error ? (
        <div role="alert">
          Не удалось загрузить историю: {error} <button onClick={onRetry}>Повторить</button>
        </div>
      ) : entries === null ? (
        <p role="status">Загружаем историю…</p>
      ) : entries.length ? (
        <>
          {entries.map((entry) => (
            <HistoryItem key={entry.id} entry={entry} />
          ))}
          {entries.length >= 100 && (
            <p className="history-help">Показаны последние 100 сохранений.</p>
          )}
        </>
      ) : (
        <p>Сохранённых правок пока нет. Они появятся после изменения карточки.</p>
      )}
    </section>
  );
}
