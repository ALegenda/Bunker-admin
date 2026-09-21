export function initLandingMenu() {
  const menu = document.querySelector<HTMLDetailsElement>('.landing-mobile-menu');
  const toggle = menu?.querySelector<HTMLElement>('summary');
  if (!menu || !toggle) return;

  const syncToggle = () => {
    toggle.setAttribute('aria-expanded', String(menu.open));
    toggle.setAttribute('aria-label', menu.open ? 'Закрыть меню' : 'Открыть меню');
  };
  const close = () => {
    menu.open = false;
    syncToggle();
  };
  const onToggleClick = (event: MouseEvent) => {
    // Handle mouse, touch-generated clicks and keyboard activation once.
    event.preventDefault();
    menu.open = !menu.open;
    syncToggle();
  };
  const onMenuClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('a[href]')) close();
  };
  const onOutsidePointer = (event: PointerEvent) => {
    if (event.target instanceof Node && !menu.contains(event.target)) close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && menu.open) {
      close();
      toggle.focus();
    }
  };
  syncToggle();
  toggle.addEventListener('click', onToggleClick);
  menu.addEventListener('click', onMenuClick);
  menu.addEventListener('toggle', syncToggle);
  document.addEventListener('pointerdown', onOutsidePointer);
  document.addEventListener('keydown', onKeyDown);
  return () => {
    toggle.removeEventListener('click', onToggleClick);
    menu.removeEventListener('click', onMenuClick);
    menu.removeEventListener('toggle', syncToggle);
    document.removeEventListener('pointerdown', onOutsidePointer);
    document.removeEventListener('keydown', onKeyDown);
  };
}
