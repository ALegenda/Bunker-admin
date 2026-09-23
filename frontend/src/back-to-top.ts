/** Shared by the React application and the prerendered landing. */
export function initBackToTop() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'back-to-top';
  button.setAttribute('aria-label', 'Наверх');
  button.title = 'Наверх';
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 11 6-6 6 6M12 5v14"/></svg>';

  const sync = () => {
    button.hidden = window.scrollY < 600;
  };
  button.addEventListener('click', () => {
    document.querySelector<HTMLElement>('header a[aria-label="Бункер — главная"]')?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  });
  sync();
  document.body.append(button);
  window.addEventListener('scroll', sync, { passive: true });
}
