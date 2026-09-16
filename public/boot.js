import('./app.js').catch((error) => {
  const root = document.querySelector('#app');
  const box = document.createElement('div');
  box.style.cssText = 'max-width:640px;margin:80px auto;padding:30px;font:18px/1.6 system-ui';
  const title = document.createElement('h1');
  title.textContent = 'Не удалось открыть редактор';
  const text = document.createElement('p');
  text.textContent = error.message;
  const retry = document.createElement('button');
  retry.textContent = 'Повторить';
  retry.onclick = () => location.reload();
  box.append(title, text, retry);
  root.replaceChildren(box);
});
