/** Called by Playwright or the browser console on a loaded, public candidate page. */
export function checkShell() {
  const require = (value, message) => { if (!value) throw Error(message); };
  const header = document.querySelector('.atlas-shell');
  const links = [...header.querySelectorAll('nav[aria-label="Atlas navigation"] a')];
  const names = links.map(a=>a.textContent.trim());
  require(names.join('|') === 'Explorer|What is proved|Chapters|History|Editions|Structured proofs|Method and sources', 'Wrong global destinations');
  require(links.filter(a=>a.getAttribute('aria-current')==='page').length===1,'Current page marker');
  const css = [...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href);
  require(css.every(h=>/\.[a-f0-9]{16}\.css$/.test(h)), 'A page requested an unversioned stylesheet');
  require(getComputedStyle(document.documentElement).getPropertyValue('--font-code').includes('Atlas Lean Mono'),'Code font missing');
  require(document.documentElement.scrollWidth<=innerWidth+1, 'Horizontal page overflow');
  require(document.querySelector('.site-skip') && document.querySelector('main#page-main') && document.querySelector('h1,main.navigation'), 'Page landmarks');
  require(![...document.querySelectorAll('link[rel=stylesheet],script[src]')].some(t=>(t.href||t.src).includes('?v=')),'Query cache key');
  return {page:document.body.dataset.sitePage, current:links.find(a=>a.hasAttribute('aria-current')).textContent,
    sites:names.length, width:innerWidth, scrollWidth:document.documentElement.scrollWidth, sharedHeaderHeight:header.getBoundingClientRect().height,
    menu:!header.querySelector('.site-menu').hidden,styles:css.map(h=>new URL(h).pathname.split('/').pop())};
}
