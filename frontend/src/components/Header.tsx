import React from 'react';
import { Brand } from './Brand.js';
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
    <header className={`topbar${user ? ' is-authenticated' : ''}`}>
      <Brand />
      {!user && (
        <nav aria-label="Разделы сайта">
          <a href="/catalog" aria-current={path === '/catalog' ? 'page' : undefined}>
            Каталог
          </a>
          <a className="telegram" href="/profile">
            Войти
          </a>
        </nav>
      )}
      {user && (
        <>
          <nav aria-label="Разделы сайта">
            <a href="/catalog" aria-current={path === '/catalog' ? 'page' : undefined}>
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
                <a href="/users" aria-current={path === '/users' ? 'page' : undefined}>
                  Игроки
                </a>
                <a
                  href="/achievements"
                  aria-current={path === '/achievements' ? 'page' : undefined}
                >
                  Достижения
                </a>
                <a href="/tips" aria-current={path === '/tips' ? 'page' : undefined}>
                  Советы
                </a>
              </>
            )}
            {['admin', 'trusted'].includes(user.role) && (
              <a href="/proposals" aria-current={path === '/proposals' ? 'page' : undefined}>
                Предложения
              </a>
            )}
            <a href="/profile" aria-current={path === '/profile' ? 'page' : undefined}>
              Мой профиль
            </a>
          </nav>
          <div className="user-menu">
            <span className="user-name">{user.name}</span>
            <button onClick={onLogout}>Выйти</button>
          </div>
        </>
      )}
    </header>
  );
}
