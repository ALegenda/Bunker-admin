import type { PdfJob } from '../../shared/contracts.js';

export function publicationBlocker(state: {
  busy: boolean;
  loadingJob: boolean;
  title: string;
  log: string;
  reviewed: boolean;
  contentChanged: boolean;
  revision: number;
  job: PdfJob | null;
}) {
  if (state.busy) return 'Сохраняем данные…';
  if (state.loadingJob) return 'Проверяем готовность последней сборки…';
  if (!state.title.trim()) return 'Укажите название выпуска.';
  if (!state.log.trim()) return 'Заполните сводку изменений для игроков.';
  if (!state.reviewed) return 'Подтвердите, что сводка проверена и готова для игроков.';
  if (state.contentChanged) return 'Название или сводка изменились. Соберите PDF текущей версии.';
  if (!state.job) return 'Соберите PDF текущей версии.';
  if (state.job.revision !== state.revision)
    return 'Правки изменились после сборки. Соберите PDF текущей версии.';
  if (state.job.status === 'running') return 'Дождитесь завершения сборки PDF.';
  if (state.job.status === 'failed') return 'Сборка PDF завершилась ошибкой. Повторите сборку.';
  return '';
}
