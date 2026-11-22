const root = document.querySelector('.atlas-shell');
const menu = root.querySelector('.site-menu');
const list = root.querySelector('.site-destinations');
const narrow = matchMedia('(max-width: 1040px)');
function setOpen(value) {
  menu.setAttribute('aria-expanded', String(value));
  list.hidden = narrow.matches && !value;
}
function applyWidth() {
  menu.hidden = !narrow.matches;
  setOpen(false);
}
function activeDestination() {
  const own = document.body.dataset.sitePage;
  if (own !== 'explorer') return own;
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('chapter')) return 'chapters';
  if (h.has('proof')) return 'proofs';
  if (h.has('statement') || h.has('component')) return 'statement';
  return 'explorer';
}
function markPage() {
  const active = activeDestination();
  for (const a of list.querySelectorAll('a')) {
    if (a.dataset.destination === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  setOpen(false);
}
menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') !== 'true'));
root.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { setOpen(false); menu.focus(); }
});
document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) setOpen(false); });
root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) setOpen(false); });
document.querySelector('.site-skip').addEventListener('click', event => {
  const main = document.getElementById('page-main');
  if (main) { event.preventDefault(); main.focus(); main.scrollIntoView({block:'nearest'}); }
});
narrow.addEventListener('change', applyWidth);
window.addEventListener('hashchange', markPage);
window.addEventListener('popstate', markPage);
window.addEventListener('atlas-address-change', markPage);
applyWidth();
markPage();
