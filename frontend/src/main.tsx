import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Me, Workspace } from '../../shared/contracts.js';
import { api, setCsrf, send } from './api.js';
import { Editor } from './components/Editor.js';
import { Publication } from './components/Publication.js';
import { Catalog } from './components/Catalog.js';
import { Proposals } from './components/Proposals.js';
import { Users } from './components/Users.js';
import './style.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main>
        <h1>Не удалось открыть страницу</h1>
        <p>Браузерные копии черновика сохранены.</p>
        <button onClick={() => location.reload()}>Повторить</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState('');
  const path = location.pathname,
    admin = path === '/admin',
    publish = new URLSearchParams(location.search).get('view') === 'publish';
  useEffect(() => {
    api<Me>('/api/me')
      .then(async (m) => {
        setCsrf(m.csrf);
        setMe(m);
        if (admin && m.user?.role === 'admin') setWorkspace(await api<Workspace>('/api/workspace'));
      })
      .catch((e) => setError(e.message));
  }, []);
  if (!me)
    return (
      <main>
        <h1>Бункер</h1>
        <p role={error ? 'alert' : 'status'}>{error || 'Загружаем…'}</p>
        {error && <button onClick={() => location.reload()}>Повторить</button>}
      </main>
    );
  const allowed =
    path === '/' ||
    (admin || path === '/users'
      ? me.user?.role === 'admin'
      : path === '/proposals'
        ? ['trusted', 'admin'].includes(me.user?.role || '')
        : false);
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          Б<span>•</span> <b>БУНКЕР</b>
        </a>
        <nav>
          <a href="/" aria-current={path === '/' ? 'page' : undefined}>
            Каталог
          </a>
          {me.user?.role === 'admin' && (
            <>
              <a href="/admin" aria-current={admin && !publish ? 'page' : undefined}>
                Редактор
              </a>
              <a href="/admin?view=publish" aria-current={publish ? 'page' : undefined}>
                Публикация
              </a>
              <a href="/users">Доступ</a>
            </>
          )}
          {['admin', 'trusted'].includes(me.user?.role || '') && (
            <a href="/proposals">Предложения</a>
          )}
        </nav>
        <div>
          {me.user ? (
            <>
              <span className="user-name">{me.user.name}</span>
              {me.authMode === 'telegram' && (
                <button
                  onClick={async () => {
                    await send('/auth/logout', {});
                    location.href = '/';
                  }}
                >
                  Выйти
                </button>
              )}
            </>
          ) : (
            <a className="telegram" href="/auth/telegram">
              Войти через Telegram
            </a>
          )}
        </div>
      </header>
      <main>
        {error && <p role="alert">{error}</p>}
        {!allowed ? (
          <section className="panel">
            <h1>Доступ ограничен</h1>
            <p>
              Войдите через Telegram. Для вычитки и редактирования нужны права, выданные
              администратором.
            </p>
            <a className="telegram" href="/auth/telegram">
              Войти через Telegram
            </a>
          </section>
        ) : path === '/' ? (
          <Catalog user={me.user} />
        ) : admin ? (
          workspace ? (
            publish ? (
              <Publication initial={workspace} />
            ) : (
              <Editor initial={workspace} />
            )
          ) : (
            <p>Загружаем черновик…</p>
          )
        ) : path === '/users' ? (
          <Users />
        ) : (
          <Proposals user={me.user!} />
        )}
      </main>
      <footer>
        Бункер · мастерская правил{' '}
        <span>
          {me.authMode === 'local'
            ? 'Локальная разработка'
            : 'Правила для всех. Редактирование по доверию.'}
        </span>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
