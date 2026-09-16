import React from 'react';
import type { User } from '../../../shared/contracts.js';
export function Header({
  user,
  path,
  publish,
  onLogout,
}: {
  user: User | null;
  path: string;
  publish: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        Б<span>•</span> <b>БУНКЕР</b>
      </a>
      {user && (
        <>
          <nav>
            <a href="/" aria-current={path === '/' ? 'page' : undefined}>
              Каталог
            </a>
            {user.role === 'admin' && (
              <>
                <a href="/admin" aria-current={path === '/admin' && !publish ? 'page' : undefined}>
                  Редактор
                </a>
                <a href="/admin?view=publish" aria-current={publish ? 'page' : undefined}>
                  Публикация
                </a>
                <a href="/users">Доступ</a>
              </>
            )}
            {['admin', 'trusted'].includes(user.role) && <a href="/proposals">Предложения</a>}
          </nav>
          <div>
            <span className="user-name">{user.name}</span>
            <button onClick={onLogout}>Выйти</button>
          </div>
        </>
      )}
    </header>
  );
}
