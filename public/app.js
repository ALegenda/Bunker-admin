import {
  changes,
  summary,
  migrateImages,
  addImportedEntries,
  changeStamp,
  fieldChanges,
} from './model.js';
import { request, openWorkspace, createSaver, uploadImage } from './api.js';
const serverState = await openWorkspace();
const base = serverState.base;
const images = Object.fromEntries(
  base.filter((c) => c.image).map((c) => [c.id, { image: c.image }]),
);
const saved = serverState.recovery || serverState;
let cards = structuredClone(saved.cards),
  selected = cards.find((c) => c.name === 'Алиби')?.id || cards[0].id,
  screen = 'editor',
  category = 'Всё содержание',
  query = '',
  missingOnly = false,
  tab = 'text',
  changelog = saved.changelog || '',
  release = saved.release || 'Следующая редакция';
let changelogStamp = saved.changelogStamp || '';
const releaseHistory = (await request('/api/releases')).releases;
let saveLabel = '● Сохранено в базе';
const saver = createSaver(serverState.revision, (state, message) => {
  saveLabel = {
    saving: '● Сохраняем…',
    saved: '● Сохранено в базе',
    error: '● Нет связи — правки в резервной копии',
    conflict: '● Конфликт — скачайте черновик перед обновлением',
  }[state];
  document.querySelector('#save-state')?.replaceChildren(document.createTextNode(saveLabel));
  updatePublishButton();
  if (message) toast(message);
});
let pdfState;
try {
  pdfState = JSON.parse(localStorage.getItem('bunker-pdf-preview'));
} catch {}
if (pdfState?.mode !== 'html') {
  pdfState = null;
  localStorage.removeItem('bunker-pdf-preview');
}
let pdfPollTimer;
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const current = () => cards.find((c) => c.id === selected),
  diff = () => changes(base, cards);
function toast(s) {
  document.querySelector('#toast').textContent = s;
  document.querySelector('#toast').classList.add('show');
  setTimeout(() => document.querySelector('#toast').classList.remove('show'), 2600);
}
function draftSnapshot() {
  return { cards, changelog, release, changelogStamp };
}
function save() {
  saver.update(draftSnapshot());
  document.querySelectorAll('[data-count]').forEach((e) => (e.textContent = diff().length));
}
window.addEventListener('beforeunload', (e) => {
  if (saver.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
function button(action, label, cls = '') {
  return `<button class="${cls}" data-action="${action}">${label}</button>`;
}
let listScrollTop = 0;
function render({ resetList = false } = {}) {
  const oldList = document.querySelector('#card-list');
  if (oldList) listScrollTop = oldList.scrollTop;
  if (resetList) listScrollTop = 0;
  const pageScroll = window.scrollY;
  document.querySelector('#app').innerHTML =
    `<aside class="rail"><a class="brand" href="/">Б<span>•</span></a><div class="rail-label">BUNKER<br>STUDIO</div><button class="rail-btn ${screen === 'editor' ? 'active' : ''}" data-action="editor" title="Редактор">▤</button><button class="rail-btn ${screen === 'publish' ? 'active' : ''}" data-action="publish" title="Публикация">↗</button><div class="rail-bottom"><span class="avatar">А</span></div></aside><div class="shell"><header><div class="breadcrumb">Бункер <span>/</span> Правила игры <span>/</span> <strong>${screen === 'editor' ? 'Редактор' : 'Публикация'}</strong></div><div class="header-right"><span class="draft-badge">● Черновик</span><span class="avatar small">А</span></div></header><main><div class="page-heading"><div><div class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО АВТОРА</div><h1>${screen === 'editor' ? 'Правила живут здесь.' : 'Готовим новый выпуск.'}</h1><p>${screen === 'editor' ? 'Собирайте игру по одной хорошей идее.' : 'Все изменения — в одной истории для игроков.'}</p></div><div class="heading-actions">${localStorage.getItem('bunker-draft-v1') && !localStorage.getItem('bunker-legacy-merged-v1') ? button('merge-legacy', 'Перенести старый черновик', 'secondary') : ''}${serverState.conflictingBackup ? button('download-recovery', '↓ Несохранённые правки', 'secondary') : ''}${button('download', '↓ Черновик', 'secondary')}${button(screen === 'editor' ? 'publish' : 'editor', screen === 'editor' ? 'Подготовить публикацию ↗' : '← В редактор', 'primary')}</div></div><div class="version-strip"><div><span class="status-dot"></span><strong>Следующая редакция</strong><span class="muted">На основе базы из проекта</span></div><div><span><b data-count>${diff().length}</b> изменений</span><span id="save-state">${esc(saveLabel)}</span></div></div>${screen === 'editor' ? editor() : publication()}<footer><span>Бункер / мастерская правил</span><span>PostgreSQL · изображения в S3 · серверная сборка PDF</span></footer></main></div>`;
  bind();
  bindPdfActions();
  const nextList = document.querySelector('#card-list');
  if (nextList) nextList.scrollTop = listScrollTop;
  window.scrollTo({ top: pageScroll, behavior: 'instant' });
}
function editor() {
  let c = current();
  return `<div class="workspace"><nav class="content-nav"><div class="section-title">Содержание <span>${cards.length}</span></div><label class="search">⌕ <input id="search" placeholder="Найти правило или карточку…" value="${esc(query)}" aria-label="Найти карточку"></label><div class="categories">${['Всё содержание', 'правило', 'роль', 'умение', 'припас', 'мёртвый бонус', 'наёмник'].map((v, i) => `<button class="category ${category === v ? 'selected' : ''}" data-category="${v}"><span>${['▦', '▤', '♙', '✧', '▣', '♧', '♜'][i]} ${['Всё содержание', 'Правила', 'Роли', 'Умения', 'Припасы', 'Мёртвые бонусы', 'Наёмники'][i]}</span><small>${v === 'Всё содержание' ? cards.length : cards.filter((c) => c.cardType === v).length}</small></button>`).join('')}</div><label class="image-filter"><input type="checkbox" id="missing-images" ${missingOnly ? 'checked' : ''}> Без изображения <span>${cards.filter((c) => c.cardType !== 'правило' && !c.image).length}</span></label><div class="list-heading">${category === 'правило' ? 'РАЗДЕЛЫ' : 'СОДЕРЖАНИЕ'} ${button('new', '+ Добавить', 'text-button')}</div><div id="card-list">${list()}</div><div class="nav-note">Единый черновик правил<small>Правки разделов и карточек попадут в один выпуск.</small></div></nav><section class="editor-panel"><div class="editor-top"><span class="eyebrow">${esc(c.cardType)} <span class="separator">/</span> ${c.cardType === 'правило' ? 'РАЗДЕЛ' : 'КАРТОЧКА'}</span><span class="subtle">${Number(c.id) < 260 ? '№ ' + (Number(c.id) + 1) : c.source ? 'Из исходника' : 'Новый элемент'}</span></div><div class="title-row"><input class="card-title" aria-label="Название карточки" data-field="name" value="${esc(c.name)}"><span class="tiny-badge">Черновик</span></div><div class="tabs">${['text', 'preview', 'diff'].map((t, i) => `<button data-tab="${t}" class="${tab === t ? 'active' : ''}">${[c.cardType === 'правило' ? 'Текст раздела' : 'Текст и изображение', 'Печатный вид', 'Изменения'][i]}</button>`).join('')}</div>${
    tab === 'text'
      ? `${c.cardType === 'правило' ? `<div class="rule-source"><span>▤</span><div><strong>Раздел правил</strong><p>Текст перенесён из исходника Word с сохранением абзацев.</p></div></div>` : `<div class="card-hero"><div class="card-art">${c.image ? `<button class="image-zoom" data-action="zoom" aria-label="Увеличить изображение"><img src="${esc(c.image)}" alt="${esc(c.name)}"><span>⌕</span></button>` : '<div class="art-placeholder" title="В исходнике не найдено">✧</div>'}</div><div><div class="eyebrow">ИЗОБРАЖЕНИЕ КАРТОЧКИ</div><h3>${c.image ? 'Иллюстрация карточки' : 'Изображение не найдено'}</h3><p>${c.image ? (c.image !== images[c.id]?.image ? 'Загружено вами' : 'Из исходника правил Word') : 'Для этой карточки в исходнике<br>нет подтверждённого изображения.'}</p><label class="upload">↥ Заменить изображение<input type="file" id="upload" accept="image/png,image/jpeg,image/webp" hidden></label><small>PNG, JPG или WebP · до 2 МБ</small>${c.image && images[c.id] && c.image !== images[c.id].image ? button('restore-image', 'Вернуть исходную картинку', 'restore-image') : ''}</div></div>`}<div class="field-label">${c.cardType === 'правило' ? 'ТЕКСТ РАЗДЕЛА' : 'ОПИСАНИЕ'} <span>Текст правила</span></div><textarea id="description" data-field="description" aria-label="Описание карточки" spellcheck="true">${esc(c.description)}</textarea><div class="editor-tip">↳ Пишите правило так, чтобы его можно было понять за игровым столом.</div>`
      : tab === 'preview'
        ? `<div id="pdf-panel">${pdfControls()}</div><div class="preview-notice">Макет карточки · полный PDF доступен в сборке выше</div><div class="paper"><h3>${esc(c.name)}</h3>${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}<p>${esc(c.description)}</p><i>${esc(
            Object.values(c.attributes || {})
              .flat()
              .join(' / '),
          )}</i></div>`
        : diffPanel(c)
  }</section><aside class="inspector">${properties(c)}<hr><div class="section-title">Для ченжлога</div><label>Характер изменения<select data-field="kind">${['Уточнение', 'Механика и баланс', 'Исправление опечатки'].map((v) => `<option ${c.kind === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Что важно игрокам?<textarea data-field="note" placeholder="Объясните, что изменилось и почему…">${esc(c.note)}</textarea></label><div class="inspector-note"><span>↗</span> Пояснение попадёт в сводку новой версии. Его можно отредактировать перед выпуском.</div></aside></div>`;
}

function properties(c) {
  if (c.cardType === 'правило' || c.cardType === 'роль' || c.cardType === 'наёмник')
    return `<div class="section-title">${c.cardType === 'правило' ? 'О разделе' : c.cardType === 'роль' ? 'О роли' : 'О наёмнике'} <span>▤</span></div><div class="source-detail"><span class="eyebrow">ИСТОЧНИК</span><p>${esc(c.source?.file || 'Создано в редакторе')}</p><small>${c.source ? 'Импортировано из документа автора' : 'Новый элемент черновика'}</small></div>${c.cardType === 'наёмник' ? '<div class="inspector-note">Бесплатные действия, цены и условия найма сохранены в тексте описания.</div>' : ''}<label>Теги<input data-attr="tags" value="${esc((c.attributes?.tags || []).join(', '))}" placeholder="Через запятую"></label>`;
  return `<div class="section-title">Свойства карточки <span>☷</span></div><label>Тип карточки<select data-attr="cardType">${['умение', 'припас', 'мёртвый бонус', 'наёмник', 'роль', 'правило'].map((v) => `<option ${c.cardType === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Время применения</label><div class="chips">${['дневное', 'ночное'].map((v, i) => `<button data-time="${v}" class="chip ${(c.attributes?.activationTime || []).includes(v) ? 'on' : ''}">${i ? '☾ Ночью' : '☀ Днём'}</button>`).join('')}</div><label>Частота<select data-attr="usageFrequency"><option value="">Не указана</option>${['одноразовое', 'двухразовое', 'трёхразовое', 'многоразовое', 'пассивное'].map((v) => `<option ${c.attributes?.usageFrequency === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Место применения<select data-attr="usageLocation">${['', 'внутри бункера', 'на вылазке', 'внутри бункера, на вылазке'].map((v) => `<option value="${v}" ${(c.attributes?.usageLocation || []).join(', ') === v ? 'selected' : ''}>${v || 'Не указано'}</option>`).join('')}</select></label><label>Теги<input data-attr="tags" value="${esc((c.attributes?.tags || []).join(', '))}" placeholder="Через запятую"></label>`;
}

function list() {
  let found = cards.filter(
    (c) =>
      (category === 'Всё содержание' || c.cardType === category) &&
      (!missingOnly || (c.cardType !== 'правило' && !c.image)) &&
      c.name.toLowerCase().includes(query.toLowerCase()),
  );
  return found.length
    ? found
        .map(
          (c) =>
            `<button class="card-item ${c.id === selected ? 'active' : ''}" data-id="${c.id}"><span>${esc(c.name)}</span>${diff().some((d) => d.card.id === c.id) ? '<i class="changed-dot"></i>' : ''}</button>`,
        )
        .join('')
    : '<p class="empty">Карточек не найдено</p>';
}
function diffPanel(c) {
  const old = base.find((b) => b.id === c.id);
  const fields = fieldChanges(c, old);
  const fmt = (v) =>
    v == null || v === ''
      ? 'Не указано'
      : typeof v === 'object'
        ? Object.entries(v)
            .map(
              ([k, val]) =>
                `${{ activationTime: 'Время', usageFrequency: 'Частота', usageLocation: 'Место', tags: 'Теги' }[k] || k}: ${Array.isArray(val) ? val.join(', ') : val}`,
            )
            .join('\n')
        : String(v);
  return `<div class="diff-view">${fields.length ? fields.map((f) => `<h3>${esc(f.label)}</h3><div class="diff-columns"><div><div class="eyebrow">БЫЛО</div>${f.field === 'image' && f.before ? `<img src="${esc(f.before)}" alt="Прежнее изображение">` : `<p>${esc(fmt(f.before))}</p>`}</div><div><div class="eyebrow green">СТАЛО</div>${f.field === 'image' && f.after ? `<img src="${esc(f.after)}" alt="Новое изображение">` : `<p class="new-text">${esc(fmt(f.after))}</p>`}</div></div>`).join('') : '<div class="empty-state">Этот элемент пока не изменён.</div>'}</div>`;
}
function publication() {
  let items = diff();
  return `<div class="publish-grid"><section class="release-editor"><div class="section-title">Подготовка выпуска <span>01 / 02</span></div><label>Название выпуска<input id="release" value="${esc(release)}"></label><div class="release-count"><b>${items.length}</b><div>изменений в черновике<small>Относительно исходных правил и карточек</small></div></div><div class="change-list">${items.length ? items.map(({ card, before }) => `<button data-id="${card.id}"><span>${esc(card.name)}<small>${before ? esc(card.kind) : 'Добавлено'}</small></span><span>↗</span></button>`).join('') : '<div class="empty-state">✧<h3>Пока всё по-прежнему</h3><p>Измените карточку или раздел — правка появится здесь.</p></div>'}</div><div class="summary-heading"><h3>Сводка для игроков</h3>${button('generate', '↻ Собрать из изменений', 'secondary')}</div><p class="muted">Проверьте формулировки и добавьте главное об обновлении.</p><textarea id="changelog" aria-label="Сводка для игроков" placeholder="Здесь будет история нового выпуска…">${esc(changelog)}</textarea><div id="log-status">${logStatus()}</div>${button('export-log', '↓ Скачать сводку', 'secondary')}<div id="pdf-panel">${pdfControls()}</div><div class="publish-gate"><strong>Выпуск версии</strong><p>Выпуск сохранит PDF, карточки и сводку изменений одной неизменяемой версией.</p><button data-action="publish-release" ${pdfState?.status === 'ready' && !saver.dirty && pdfState.revision === saver.revision && changelog.trim() && changelogStamp === changeStamp(diff()) ? '' : 'disabled'}>Опубликовать версию ↗</button>${releaseHistory.map((r) => `<p><a href="/releases/${esc(r.id)}" target="_blank">${esc(r.title)} ↗</a> · <a href="/releases/${esc(r.id)}/pdf" target="_blank">PDF</a></p>`).join('')}</div></section><section class="release-preview"><div class="preview-label">ТАК СВОДКУ УВИДЯТ ИГРОКИ <span>Предпросмотр</span></div><article class="release-paper"><div class="release-brand">Б<span>•</span> <small>Бункер / журнал обновлений</small></div><div class="release-kicker">ИГРА МЕНЯЕТСЯ. ИСТОРИЯ ПРОДОЛЖАЕТСЯ.</div><h2 id="preview-title">${esc(release)}</h2><div class="release-meta">Черновик выпуска <span>•</span> ${items.length} изменений</div><div class="yellow-rule"></div><h3>Что нового</h3><div id="preview-log">${logHtml()}</div><div class="release-bottom">Увидимся в Бункере.<span>✳</span></div></article></section></div>`;
}
function logStatus() {
  return changelog.trim() && changelogStamp !== changeStamp(diff())
    ? `<div class="stale-log"><strong>После подготовки сводки правила изменились</strong><p>Обновите сводку или проверьте её вручную перед выпуском.</p>${button('review-log', '✓ Сводка проверена', 'secondary')}</div>`
    : changelog.trim()
      ? '<div class="fresh-log">✓ Черновик не менялся после подготовки сводки</div>'
      : '';
}
function logHtml() {
  return changelog
    ? changelog
        .split(/\n\s*\n/)
        .map((p) => {
          if (/^### /.test(p)) return `<h4>${esc(p.slice(4))}</h4>`;
          if (/^## /.test(p)) return `<h3 class="log-group">${esc(p.slice(3))}</h3>`;
          return `<p>${esc(p).replaceAll('\n', '<br>')}</p>`;
        })
        .join('')
    : '<p class="muted">Добавьте сводку слева, чтобы рассказать игрокам об обновлении.</p>';
}
function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bind() {
  document.querySelector('#missing-images')?.addEventListener('change', (e) => {
    missingOnly = e.target.checked;
    refreshList();
  });
  document.querySelectorAll('[data-action]').forEach(
    (b) =>
      (b.onclick = () => {
        let a = b.dataset.action;
        if (a === 'download-recovery') {
          download(
            'bunker-unsaved.json',
            JSON.stringify(serverState.conflictingBackup.draft, null, 2),
          );
          return;
        }
        if (a === 'merge-legacy') {
          mergeLegacy();
          return;
        }
        if (a === 'publish-release') {
          publishRelease();
          return;
        }
        if (a === 'zoom') {
          const d = document.createElement('dialog');
          d.className = 'image-dialog';
          d.innerHTML = `<form method="dialog"><strong>${esc(current().name)}</strong><button aria-label="Закрыть">×</button></form><img src="${esc(current().image)}" alt="${esc(current().name)}">`;
          d.addEventListener('close', () => d.remove());
          d.addEventListener('click', (e) => {
            if (e.target === d) d.close();
          });
          document.body.append(d);
          d.showModal();
        }
        if (a === 'restore-image') {
          current().image = images[current().id].image;
          save();
          render();
        }
        if (a === 'editor' || a === 'publish') {
          screen = a;
          render();
        }
        if (a === 'download')
          download(
            'bunker-draft.json',
            JSON.stringify({ schemaVersion: 1, cards, changelog, release }, null, 2),
          );
        if (a === 'generate') {
          if (!diff().length) return toast('Сначала измените хотя бы одну карточку');
          if (changelog && !confirm('Заменить отредактированную сводку автоматически собранной?'))
            return;
          changelog = summary(diff());
          changelogStamp = changeStamp(diff());
          save();
          render();
        }
        if (a === 'review-log') {
          if (!changelog.trim()) return toast('Сначала подготовьте сводку');
          changelogStamp = changeStamp(diff());
          save();
          render();
        }
        if (a === 'export-log') {
          if (!changelog.trim()) return toast('Сначала подготовьте сводку');
          download('bunker-changelog.md', `# ${release}\n\n${changelog}`, 'text/markdown');
        }
        if (a === 'new') {
          missingOnly = false;
          query = '';
          const c = {
            id: crypto.randomUUID(),
            name:
              category === 'правило'
                ? 'Новый раздел'
                : category === 'наёмник'
                  ? 'Новый наёмник'
                  : category === 'роль'
                    ? 'Новая роль'
                    : 'Новая карточка',
            cardType: ['правило', 'роль', 'наёмник', 'умение', 'припас', 'мёртвый бонус'].includes(
              category,
            )
              ? category
              : 'умение',
            description: '',
            attributes: {},
            kind: 'Уточнение',
            note: '',
            image: '',
          };
          cards.push(c);
          selected = c.id;
          tab = 'text';
          save();
          render();
        }
      }),
  );
  bindList();
  document.querySelectorAll('[data-category]').forEach(
    (b) =>
      (b.onclick = () => {
        category = b.dataset.category;
        render({ resetList: true });
      }),
  );
  document.querySelectorAll('[data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        render();
      }),
  );
  document.querySelector('#search')?.addEventListener('input', (e) => {
    query = e.target.value;
    refreshList();
  });
  document.querySelectorAll('[data-field]').forEach((e) =>
    e.addEventListener('input', () => {
      current()[e.dataset.field] = e.value;
      save();
      if (e.dataset.field === 'name') {
        refreshList();
      }
    }),
  );
  document.querySelectorAll('[data-attr]').forEach((e) =>
    e.addEventListener('change', () => {
      let key = e.dataset.attr,
        c = current();
      c.attributes ??= {};
      if (key === 'cardType') c.cardType = e.value;
      else
        c.attributes[key] = ['usageLocation', 'tags'].includes(key)
          ? e.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : e.value;
      save();
      render();
    }),
  );
  document.querySelectorAll('[data-time]').forEach(
    (b) =>
      (b.onclick = () => {
        let c = current();
        c.attributes ??= {};
        let v = c.attributes.activationTime || [],
          t = b.dataset.time;
        c.attributes.activationTime = v.includes(t) ? v.filter((x) => x !== t) : [...v, t];
        save();
        render();
      }),
  );
  document.querySelector('#upload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    )
      return toast('Выберите PNG, JPG или WebP до 2 МБ');
    const target = current();
    try {
      const result = await uploadImage(file);
      target.image = result.image;
      save();
      render();
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelector('#changelog')?.addEventListener('input', (e) => {
    if (!changelog.trim()) changelogStamp = changeStamp(diff());
    changelog = e.target.value;
    save();
    document.querySelector('#preview-log').innerHTML = logHtml();
    document.querySelector('#log-status').innerHTML = logStatus();
    document.querySelector('[data-action="review-log"]')?.addEventListener('click', () => {
      changelogStamp = changeStamp(diff());
      save();
      render();
    });
  });
  document.querySelector('#release')?.addEventListener('input', (e) => {
    release = e.target.value;
    save();
    document.querySelector('#preview-title').textContent = release;
  });
}
function refreshList() {
  const el = document.querySelector('#card-list');
  const top = el.scrollTop;
  el.innerHTML = list();
  el.scrollTop = top;
  bindList();
}
function bindList() {
  document.querySelectorAll('[data-id]').forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.id;
        screen = 'editor';
        render();
        document
          .querySelector(`[data-id="${CSS.escape(selected)}"]`)
          ?.focus({ preventScroll: true });
      }),
  );
}
render();

function pdfControls() {
  const stale = pdfState?.revision !== saver.revision || saver.dirty;
  const state = pdfState?.status;
  return `<section class="pdf-build"><div class="section-title">PDF правил <span>ИЗ ДАННЫХ РЕДАКТОРА</span></div><p>Названия, описания, характеристики и изображения собираются в единый документ. Длинный текст переносится на следующие страницы.</p>${state === 'running' ? '<div class="pdf-running"><span class="spinner"></span> Собираем PDF на сервере… Вкладку можно закрыть.</div>' : state === 'failed' ? `<div class="pdf-error">${esc(pdfState.error)}</div>` : state === 'ready' ? `<div class="pdf-ready"><strong>PDF готов · ${pdfState.pages} страниц</strong><small>${pdfState.appliedChanges?.length || 0} изменений · ${(pdfState.bytes / 1024 / 1024).toFixed(1)} МБ</small><a href="${esc(pdfState.url)}" target="_blank" rel="noopener">Открыть PDF ↗</a> <a href="/api/pdf/jobs/${esc(pdfState.jobId)}/html" target="_blank" rel="noopener">Печатный шаблон ↗</a></div>${stale ? '<div class="stale-log">Есть новые правки. Пересоберите PDF перед выпуском.</div>' : ''}` : ''}<button class="secondary" data-pdf-build ${state === 'running' ? 'disabled' : ''}>${state === 'ready' ? 'Пересобрать PDF' : 'Собрать PDF'}</button></section>`;
}
function updatePublishButton() {
  const b = document.querySelector('[data-action="publish-release"]');
  if (b)
    b.disabled = !(
      pdfState?.status === 'ready' &&
      !saver.dirty &&
      pdfState.revision === saver.revision &&
      changelog.trim() &&
      changelogStamp === changeStamp(diff())
    );
}
function updatePdfPanel() {
  updatePublishButton();
  const panel = document.querySelector('#pdf-panel');
  if (panel) {
    panel.innerHTML = pdfControls();
    bindPdfActions();
  }
}
function persistPdfState() {
  try {
    localStorage.setItem('bunker-pdf-preview', JSON.stringify(pdfState));
  } catch {}
}
function bindPdfActions() {
  document.querySelector('[data-pdf-build]')?.addEventListener('click', async () => {
    if (pdfState?.status === 'running') return;
    try {
      await saver.flush();
      pdfState = { status: 'running', mode: 'html', revision: saver.revision };
      persistPdfState();
      updatePdfPanel();
      const value = await request('/api/pdf/build', {
        method: 'POST',
        body: JSON.stringify({ revision: saver.revision }),
      });
      pdfState = { ...pdfState, ...value };
      persistPdfState();
      updatePdfPanel();
      pollPdf();
    } catch (e) {
      pdfState = { status: 'failed', mode: 'html', error: e.message };
      persistPdfState();
      updatePdfPanel();
    }
  });
}
async function publishRelease() {
  try {
    await saver.flush();
    if (!pdfState?.jobId) throw Error('Сначала соберите PDF');
    await request('/api/releases', {
      method: 'POST',
      body: JSON.stringify({ jobId: pdfState.jobId, revision: saver.revision }),
    });
    location.reload();
  } catch (e) {
    toast(e.message);
  }
}
async function pollPdf() {
  clearTimeout(pdfPollTimer);
  if (!pdfState?.jobId) return;
  try {
    const response = await fetch(`/api/pdf/jobs/${pdfState.jobId}`);
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'Сборка не найдена.');
    pdfState = { ...pdfState, ...value };
    persistPdfState();
    updatePdfPanel();
    if (pdfState.status === 'running') pdfPollTimer = setTimeout(pollPdf, 2000);
  } catch (e) {
    pdfState = { ...pdfState, status: 'failed', error: e.message };
    persistPdfState();
    updatePdfPanel();
  }
}
if (pdfState?.status === 'running') {
  if (pdfState.jobId) pollPdf();
  else {
    pdfState = { status: 'failed', error: 'Запуск сборки был прерван. Повторите попытку.' };
    persistPdfState();
    updatePdfPanel();
  }
}

if (serverState.recovery) save();
if (serverState.conflictingBackup)
  toast('На сервере более новая версия. Предыдущая резервная копия осталась в браузере.');

async function mergeLegacy() {
  try {
    await saver.flush();
    const legacy = JSON.parse(localStorage.getItem('bunker-draft-v1'));
    if (!legacy?.cards) throw Error('Браузерный черновик не найден');
    await request('/api/import/merge', {
      method: 'POST',
      body: JSON.stringify({ revision: saver.revision, draft: legacy }),
    });
    localStorage.setItem('bunker-legacy-merged-v1', 'true');
    location.reload();
  } catch (e) {
    toast(e.message);
  }
}
