import { Header } from './components/Header.js';
import { TelegramLogin } from './components/TelegramLogin.js';
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Me, Workspace } from '../../shared/contracts.js';
import { api, setCsrf, send } from './api.js';
const Landing = lazy(() =>
  import('./components/Landing.js').then((module) => ({ default: module.Landing })),
);
import { legacyCatalogUrl } from '../../shared/navigation.js';
import './style.css';

const Editor = lazy(() =>
  import('./components/Editor.js').then((module) => ({ default: module.Editor })),
);
const Publication = lazy(() =>
  import('./components/Publication.js').then((module) => ({ default: module.Publication })),
);
const Catalog = lazy(() =>
  import('./components/Catalog.js').then((module) => ({ default: module.Catalog })),
);
const Proposals = lazy(() =>
  import('./components/Proposals.js').then((module) => ({ default: module.Proposals })),
);
const Users = lazy(() =>
  import('./components/Users.js').then((module) => ({ default: module.Users })),
);
const Profile = lazy(() =>
  import('./components/Profile.js').then((module) => ({ default: module.Profile })),
);
const TipsModeration = lazy(() =>
  import('./components/CardTips.js').then((module) => ({ default: module.TipsModeration })),
);
const Achievements = lazy(() =>
  import('./components/Achievements.js').then((module) => ({ default: module.Achievements })),
);
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
function WorkspaceApp({ path }: { path: string }) {
  const [me, setMe] = useState<Me | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState('');
  const admin = path === '/admin',
    publish = new URLSearchParams(location.search).get('view') === 'publish';
  useEffect(() => {
    document.title =
      path === '/catalog'
        ? 'Карточки и правила — Бункер'
        : path === '/profile'
          ? 'Личный профиль — Бункер'
          : 'Мастерская — Бункер';
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
    path === '/catalog' ||
    (path === '/profile'
      ? Boolean(me.user)
      : admin || path === '/users' || path === '/tips' || path === '/achievements'
        ? me.user?.role === 'admin'
        : path === '/proposals'
          ? ['trusted', 'admin'].includes(me.user?.role || '')
          : false);
  return (
    <>
      <Header
        user={me.user}
        path={path}
        publish={publish}
        onLogout={async () => {
          try {
            await send('/auth/logout', {});
            location.href = '/';
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      <main>
        {error && <p role="alert">{error}</p>}
        {!allowed ? (
          <section className="panel">
            <h1>Доступ ограничен</h1>
            {me.authMode === 'local' ? (
              <>
                <p>Локальный редактор доступен только в режиме разработки на этом компьютере.</p>
                <button
                  onClick={async () => {
                    try {
                      await send('/auth/local', {});
                      location.reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Открыть локальный редактор
                </button>
              </>
            ) : (
              <>
                <p>
                  Войдите через Telegram, чтобы открыть свой профиль. Права на советы и
                  редактирование выдаёт администратор.
                </p>
                {!me.user && <TelegramLogin />}
              </>
            )}
          </section>
        ) : path === '/catalog' ? (
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
        ) : path === '/profile' ? (
          <Profile onNameChange={(name) => setMe({ ...me, user: { ...me.user!, name } })} />
        ) : path === '/achievements' ? (
          <Achievements />
        ) : path === '/tips' ? (
          <TipsModeration />
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
const legacyCatalog = legacyCatalogUrl(location.pathname, location.search, location.hash);
if (legacyCatalog) history.replaceState(null, '', legacyCatalog);
const root = document.getElementById('root')!;
const app = (
  <ErrorBoundary>
    {location.pathname === '/' ? (
      <Suspense fallback={<main>Загружаем…</main>}>
        <Landing />
      </Suspense>
    ) : (
      <Suspense
        fallback={
          <main>
            <p role="status">Загружаем раздел…</p>
          </main>
        }
      >
        <WorkspaceApp path={location.pathname} />
      </Suspense>
    )}
  </ErrorBoundary>
);
// The production landing is complete HTML and never loads this application entry.
createRoot(root).render(app);
