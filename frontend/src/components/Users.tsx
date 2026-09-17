import { useEffect, useState } from 'react';
import { ManageProfile } from './Profile.js';
import { Modal } from './Catalog.js';
import { api, send } from '../api.js';
type Member = {
  id: string;
  telegram_id: string;
  display_name: string;
  username: string;
  role: 'player' | 'trusted' | 'admin';
  disabled: boolean;
};
export function Users() {
  const [users, setUsers] = useState<Member[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [selected, setSelected] = useState<Member | null>(null);
  const load = () =>
    api<{ users: Member[] }>('/api/users')
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function update(u: Member, changes: Partial<Member>) {
    if (
      !confirm(
        'Изменить доступ пользователя «' + u.display_name + '»? Ему потребуется войти снова.',
      )
    )
      return;
    setBusy(u.id);
    try {
      await send(
        '/api/users/' + u.id,
        { role: changes.role ?? u.role, disabled: changes.disabled ?? u.disabled },
        'PATCH',
      );
      await load();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <h1>Игроки и доступ.</h1>
      <p>
        Игрок сначала входит через Telegram. После этого здесь можно разрешить ему вычитку или
        администрирование.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="panel">
        {users.length ? (
          users.map((u) => (
            <div className="member" key={u.id}>
              <div>
                <strong>{u.display_name}</strong>
                <small>
                  {u.username ? '@' + u.username : 'Telegram'} · ID {u.telegram_id}
                </small>
              </div>
              <button onClick={() => setSelected(u)}>Профиль и начисления</button>
              <select
                aria-label={'Роль ' + u.display_name}
                disabled={busy === u.id}
                value={u.role}
                onChange={(e) => update(u, { role: e.target.value as Member['role'] })}
              >
                <option value="player">Игрок</option>
                <option value="trusted">Опытный игрок</option>
                <option value="admin">Администратор</option>
              </select>
              <button disabled={busy === u.id} onClick={() => update(u, { disabled: !u.disabled })}>
                {u.disabled ? 'Восстановить доступ' : 'Отключить доступ'}
              </button>
            </div>
          ))
        ) : (
          <p>Пока никто не вошёл через Telegram.</p>
        )}
      </div>
      {selected && (
        <Modal title="Профиль и начисления" close={() => setSelected(null)}>
          <ManageProfile key={selected.id} userId={selected.id} />
        </Modal>
      )}
    </>
  );
}
