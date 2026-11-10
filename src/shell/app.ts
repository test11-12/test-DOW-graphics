/* The page shell: navigation between the wins, masthead transitions, keys, index,
   full screen and the source line. Films never touch anything in here. */
import * as K from '../core/kit.ts';
import { player } from '../core/player.ts';
import { projects } from '../projects.ts';
import { loaders } from '../scenes/registry.ts';
import { bindTransport, whenFontsReady } from './transport.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const app = $('app');
const els = {
  number: $('project-number'),
  category: $('project-category'),
  title: $('project-title'),
  description: $('project-description'),
  tabs: $('project-tabs'),
  filmTitle: $('film-title'),
  prompt: $('film-prompt'),
  stage: $('stage'),
  page: $('page-number'),
  meta: $('project-meta'),
  source: $<HTMLAnchorElement>('source-link'),
  sourceMore: $('source-more'),
  index: $('index'),
  viewAll: $('view-all'),
  present: $('present'),
};

for (const id in loaders) player.register(id, loaders[id]);

const fromHash = (): number => projects.findIndex((p) => p.id === location.hash.slice(1));
let active = Math.max(0, fromHash());
let filter = 'All';
let quiet = false; // true while tools drive the page: no masthead animation
let indicator: HTMLElement | null = null;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const still = (): boolean => quiet || reduced.matches;

/* ---- Text that changes: the old line slides out, the newest target slides in.
   The target is kept on the element, so rapid changes can never leave a stale line. */
const targets = new WeakMap<HTMLElement, { text: string; apply?: () => void }>();
function swap(el: HTMLElement, text: string, dir: number, apply?: () => void): void {
  const pending = targets.get(el);
  targets.set(el, { text, apply });
  const commit = (): void => {
    const t = targets.get(el)!;
    el.textContent = t.text;
    t.apply?.();
  };
  if (still() || !el.animate) {
    el.getAnimations?.().forEach((a) => a.cancel());
    return commit();
  }
  if (pending && el.getAnimations().some((a) => a.id === 'out')) return; // already leaving: it will pick up the new target
  if (el.textContent === text) return commit();
  el.getAnimations().forEach((a) => a.cancel());
  const out = el.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: `translateY(${-7 * dir}px)` }], { duration: 130, easing: 'ease-in', fill: 'forwards' });
  out.id = 'out';
  out.onfinish = () => {
    commit();
    out.cancel();
    el.animate([{ opacity: 0, transform: `translateY(${11 * dir}px)` }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, easing: 'cubic-bezier(.22,.72,.18,1)' });
  };
}

/* ---- Tabs ------------------------------------------------------------------ */
const visible = (): Array<{ i: number }> => projects.map((p, i) => ({ p, i })).filter(({ p }) => filter === 'All' || p.category === filter);

function drawTabs(): void {
  els.tabs.replaceChildren();
  visible().forEach(({ i }) => {
    const p = projects[i];
    const b = K.h('button', '', els.tabs);
    b.type = 'button';
    b.dataset.project = String(i);
    K.h('span', 'key', b, String((i + 1) % 10));
    b.append(p.short ?? p.name);
    b.setAttribute('aria-current', String(i === active));
    b.setAttribute('aria-label', `${p.name}, win ${i + 1} of ${projects.length}`);
    // Opening a tab plays its film; the open tab plays again from the top.
    b.addEventListener('click', () => (i === active ? player.replay() : go(i)));
    // Get the film ready before the click lands.
    const warm = (): void => void player.prewarm(p.id);
    b.addEventListener('pointerenter', warm);
    b.addEventListener('focus', warm);
  });
  indicator = K.h('span', 'tab-indicator', els.tabs);
  moveIndicator(true);
}
function moveIndicator(instant: boolean): void {
  const cur = els.tabs.querySelector<HTMLElement>('[aria-current="true"]');
  if (!indicator) return;
  if (!cur) {
    indicator.style.opacity = '0';
    return;
  }
  indicator.style.opacity = '1';
  if (instant || still()) indicator.style.transition = 'none';
  indicator.style.transform = `translateX(${cur.offsetLeft}px) scaleX(${cur.offsetWidth})`;
  if (instant || still()) {
    void indicator.offsetWidth;
    indicator.style.transition = '';
  }
  const pad = 24;
  const row = els.tabs;
  if (cur.offsetLeft < row.scrollLeft + pad) row.scrollLeft = cur.offsetLeft - pad;
  else if (cur.offsetLeft + cur.offsetWidth > row.scrollLeft + row.clientWidth - pad) row.scrollLeft = cur.offsetLeft + cur.offsetWidth - row.clientWidth + pad;
}

/* ---- Navigation ------------------------------------------------------------ */
function go(i: number, opts: { instant?: boolean; autoplay?: boolean; force?: boolean } = {}): Promise<void> {
  const dir = i >= active ? 1 : -1;
  const changed = i !== active || player.state.id !== projects[i].id;
  active = i;
  const p = projects[i];
  const wasQuiet = quiet;
  quiet = quiet || !!opts.instant;

  swap(els.number, `Win ${K.pad(i + 1)}`, dir);
  swap(els.category, p.category, dir);
  swap(els.meta, `${p.maker} · ${p.place} · ${p.when}`, dir);
  // Long names step down in size so the title always sits on one line.
  swap(els.title, p.name, dir, () => {
    els.title.classList.toggle('is-long', p.name.length > 15 && p.name.length <= 18);
    els.title.classList.toggle('is-xlong', p.name.length > 18);
  });
  swap(els.description, p.description, dir);
  swap(els.filmTitle, p.title, dir);
  swap(els.prompt, p.prompt, dir);
  swap(els.page, `${K.pad(i + 1)} / ${K.pad(projects.length)}`, dir);
  // Where the figures come from: the first source is named, the rest follow as links.
  els.source.textContent = p.sources[0].label;
  els.source.href = p.sources[0].url;
  els.sourceMore.replaceChildren();
  p.sources.slice(1).forEach((src) => {
    const a = K.h('a', '', els.sourceMore, src.label);
    a.href = src.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });

  els.tabs.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.project) === i)));
  moveIndicator(false);
  try {
    history.replaceState(null, '', `#${p.id}`);
  } catch {
    /* sandboxed previews cannot rewrite the URL; navigation still works */
  }
  document.title = `${p.name} · Ten Wins in Motion`;
  quiet = wasQuiet;
  if (!changed && !opts.force) return Promise.resolve();
  return player.mount(p.id, { instant: opts.instant || reduced.matches, autoplay: opts.autoplay });
}
player.on('mount', (def: { alt: string }) => {
  els.stage.setAttribute('aria-label', `Animated graphic: ${projects[active].name}. ${def.alt}`);
});

function move(dir: number): void {
  const ids = visible().map(({ i }) => i);
  const pos = ids.indexOf(active);
  void go(ids[(pos + dir + ids.length) % ids.length]);
}
$('previous').addEventListener('click', () => move(-1));
$('next').addEventListener('click', () => move(1));

function setFilter(name: string, target?: number): void {
  filter = name;
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === name)));
  let to = target ?? active;
  if (name !== 'All' && projects[to].category !== name) to = projects.findIndex((p) => p.category === name);
  const prev = active;
  active = to; // so the new row is drawn with the right tab current
  drawTabs();
  active = prev;
  void go(to);
}
document.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter!)));

/* ---- Project index --------------------------------------------------------- */
function closeIndex(focus: boolean): void {
  els.index.hidden = true;
  els.viewAll.setAttribute('aria-expanded', 'false');
  if (focus) els.viewAll.focus();
}
function openIndex(): void {
  els.index.replaceChildren();
  const panel = K.h('div', 'index-panel', els.index);
  const head = K.h('div', 'index-head', panel);
  K.h('span', '', head, 'Ten wins · December 2024 to November 2026');
  const close = K.h('button', 'tool', head);
  close.type = 'button';
  close.setAttribute('aria-label', 'Close the index');
  close.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
  close.addEventListener('click', () => closeIndex(true));
  const grid = K.h('div', 'index-grid', panel);
  projects.forEach((p, i) => {
    const b = K.h('button', '', grid);
    b.type = 'button';
    b.style.setProperty('--i', String(i));
    b.setAttribute('aria-current', String(i === active));
    const meta = K.h('span', 'index-meta', b);
    K.h('span', '', meta, p.maker);
    K.h('span', '', meta, p.category);
    K.h('span', 'index-number', b, K.pad(i + 1));
    K.h('span', 'index-name', b, p.name);
    K.h('span', 'index-line', b, p.title);
    b.addEventListener('pointerenter', () => void player.prewarm(p.id));
    b.addEventListener('click', () => {
      closeIndex(false);
      if (filter !== 'All') setFilter('All', i);
      else void go(i);
    });
  });
  els.index.hidden = false;
  els.viewAll.setAttribute('aria-expanded', 'true');
  (grid.querySelector<HTMLElement>('[aria-current="true"]') ?? close).focus();
}
els.viewAll.addEventListener('click', () => (els.index.hidden ? openIndex() : closeIndex(true)));
els.index.addEventListener('click', (e) => {
  if (e.target === els.index) closeIndex(true);
});

/* ---- Full screen ----------------------------------------------------------- */
function setPresent(on: boolean): void {
  app.classList.toggle('is-presenting', on);
  els.present.setAttribute('aria-pressed', String(on));
  els.present.setAttribute('aria-label', on ? 'Exit full screen' : 'Enter full screen');
  const root = document.documentElement;
  try {
    if (on && !document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch {
    /* full screen can be blocked in embedded previews; the layout still expands */
  }
}
els.present.addEventListener('click', () => setPresent(!app.classList.contains('is-presenting')));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && app.classList.contains('is-presenting')) setPresent(false);
});

/* ---- Transport and keys ---------------------------------------------------- */
const transport = bindTransport(
  {
    play: $('play'),
    replay: $('replay'),
    speed: $('speed'),
    acts: $('acts'),
    fill: $('track-fill'),
    ticks: $('track-ticks'),
    scrub: $<HTMLInputElement>('scrub'),
    clock: $('clock'),
    caption: $('caption'),
    controls: $('controls'),
  },
  { animate: () => !still() },
);

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (e.key === 'Escape') {
    if (!els.index.hidden) closeIndex(true);
    else if (app.classList.contains('is-presenting')) setPresent(false);
    return;
  }
  if (!els.index.hidden || tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowRight') move(1);
  else if (e.key === 'ArrowLeft') move(-1);
  else if (e.key >= '0' && e.key <= '9' && projects[(Number(e.key) + 9) % 10]) {
    // 1 to 9 choose the first nine; 0 is the tenth.
    const i = (Number(e.key) + 9) % 10;
    if (filter !== 'All' && projects[i].category !== filter) setFilter('All', i);
    else if (i === active) player.replay();
    else void go(i);
  } else if ((e.key === ' ' || k === 'k') && (tag !== 'BUTTON' || (e.target as HTMLElement).closest('#project-tabs, .pager'))) {
    // After a click, focus rests on a tab: Space should still mean play or pause. Enter opens tabs.
    e.preventDefault();
    player.toggle();
  } else if (k === 'r') player.replay();
  else if (k === 's') transport.cycleSpeed();
  else if (k === 'f') setPresent(!app.classList.contains('is-presenting'));
});

window.addEventListener('hashchange', () => {
  const i = fromHash();
  if (i >= 0 && i !== active) {
    if (filter !== 'All' && projects[i].category !== filter) setFilter('All', i);
    else void go(i);
  }
});
window.addEventListener('resize', () => moveIndicator(true));

/* ---- Start ----------------------------------------------------------------- */
player.init(els.stage, $('controls'));
drawTabs();
const first = go(active, { force: true });

// Once the first film is on screen, get the others ready in idle time, nearest first,
// so that opening any tab afterwards costs a single frame.
const idle: (f: () => void) => void = (window as any).requestIdleCallback ? (f) => (window as any).requestIdleCallback(f, { timeout: 1500 }) : (f) => setTimeout(f, 120);
void first.then(() => {
  const order = projects.map((_, i) => i).sort((a, b) => Math.abs(a - active) - Math.abs(b - active)).slice(1);
  const next = (): void => {
    const i = order.shift();
    if (i == null) return;
    idle(() => void player.prewarm(projects[i].id).then(next));
  };
  next();
});

const ready = Promise.all([first, whenFontsReady()]).then(() => {
  moveIndicator(true);
  return true;
});

/* Deterministic hooks for the capture, test and export tools. */
(window as any).WINS = {
  player,
  projects,
  ready,
  go,
  get active() {
    return active;
  },
  debug: {
    /** Mount a project with no transitions, paused on an exact frame. */
    async show(id: string, t = 0, idleTime = 0) {
      const i = projects.findIndex((p) => p.id === id);
      if (i < 0) throw new Error('Unknown film: ' + id);
      quiet = true;
      if (filter !== 'All') {
        filter = 'All';
        document.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === 'All')));
        active = i;
        drawTabs();
      }
      await go(i, { instant: true, autoplay: false, force: true });
      player.seek(t, idleTime);
      return player.state.duration;
    },
    seek(t: number, idleTime = 0) {
      player.pause();
      player.seek(t, idleTime);
    },
    stats: () => player.stats(),
  },
};
