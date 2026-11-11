/* WinsMotion: the drop-in build. One script tag puts the animated stage inside any
   element of an existing page, such as an article. It renders in a shadow root, so the host site's
   styles and the widget's styles cannot affect each other.

     <div data-wins-motion data-follow="#project-title"></div>
     <script src="wins-motion.js"></script>

   or, from code:

     const demo = WinsMotion.mount('#demo', { project: 'fury' });
     demo.show('victus-haze');

   See docs/EMBED.md. The three constants below are filled in by the build. */
import { player } from '../core/player.ts';
import { projects } from '../projects.ts';
import { loaders } from '../scenes/registry.ts';
import { bindTransport, whenFontsReady } from './transport.ts';

declare const __EMBED_CSS__: string;
declare const __EMBED_FONTS__: string;
declare const __EMBED_SPRITE__: string;

export interface MountOptions {
  /** The project to open first: an id, a name, or a number from 1. */
  project?: string | number;
  /** An element (or selector) whose text names the current project; the stage follows it. */
  follow?: string | Element;
  /** Follow the page's #hash as well. */
  hash?: boolean;
  heading?: boolean;
  captions?: boolean;
  /** The line saying what the film cannot show, and its sources. Set false only if the
      article carries them itself: on a narrow column the instrument rail, where the
      film's own caveat sits, is not shown. */
  notes?: boolean;
  /** Set false if the host page already provides the fonts. */
  fonts?: boolean;
}

const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** Accepts an id ("victus-haze"), a name ("Victus Haze", "VICTUS HAZE") or a 1-based number. */
function resolve(v: unknown): string | null {
  if (typeof v === 'number') return projects[v - 1]?.id ?? null;
  const n = norm(v);
  if (!n) return null;
  const p = projects.find((q) => norm(q.id) === n || norm(q.name) === n || (q.short != null && norm(q.short) === n));
  return p ? p.id : /^([1-9]|10)$/.test(n) ? (projects[Number(n) - 1]?.id ?? null) : null;
}
const listing = () => projects.map((p) => ({ id: p.id, name: p.name, category: p.category }));

let instance: ReturnType<typeof create> | null = null;

function create(host: Element, opts: MountOptions) {
  if (opts.fonts !== false && !document.getElementById('wins-motion-fonts')) {
    const st = document.createElement('style');
    st.id = 'wins-motion-fonts';
    st.textContent = __EMBED_FONTS__;
    document.head.appendChild(st);
  }
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    `<style>${__EMBED_CSS__}</style>${__EMBED_SPRITE__}` +
    `<div class="wins-motion">` +
    (opts.heading !== false ? `<div class="film-head"><h3 id="film-title"></h3><p id="film-prompt"></p></div>` : '') +
    `<div class="stage-frame"><div id="stage" class="stage" role="group" aria-label=""></div></div>` +
    `<div class="transport" aria-label="Playback">` +
    `<button id="play" class="play" type="button" aria-label="Pause"><svg class="icon"><use href="#i-pause"/></svg></button>` +
    `<div class="timeline"><div id="acts" class="acts"></div><div class="track"><div id="track-fill" class="track-fill"></div><div id="track-ticks" class="track-ticks"></div></div>` +
    `<input id="scrub" class="scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Scrub through the film"></div>` +
    `<output id="clock" class="clock">0:00</output>` +
    `<button id="speed" class="tool" type="button" aria-label="Playback speed: 1 times">1×</button>` +
    `<button id="replay" class="tool" type="button" aria-label="Replay from the start"><svg class="icon"><use href="#i-replay"/></svg></button>` +
    `</div>` +
    `<div class="film-foot"${opts.captions !== false ? '' : ' hidden'}><p id="caption" role="status" aria-live="polite"></p><div id="controls"></div></div>` +
    (opts.notes !== false ? `<div class="film-notes"><p><span class="notes-label">What this cannot show</span><span id="film-caveat"></span></p><p id="film-sources"></p></div>` : '') +
    `</div>`;
  const $ = <T extends HTMLElement>(id: string): T => root.getElementById(id) as T;
  const stage = $('stage');
  const title = root.getElementById('film-title');
  const prompt = root.getElementById('film-prompt');
  const caveat = root.getElementById('film-caveat');
  const sources = root.getElementById('film-sources');
  let current: string | null = null;

  player.init(stage, $('controls'));
  for (const id of Object.keys(loaders)) player.register(id, loaders[id]);
  bindTransport({
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
  });
  player.on('mount', (def: { id: string; alt: string }) => {
    const p = projects.find((q) => q.id === def.id);
    if (p) stage.setAttribute('aria-label', `Animated graphic: ${p.name}. ${def.alt}`);
  });

  /** Show a project and start its film. Showing the current one replays it. */
  function show(v: string | number): boolean {
    const id = resolve(v);
    if (!id) return false;
    if (id === current) {
      player.replay();
      return true;
    }
    current = id;
    const p = projects.find((q) => q.id === id)!;
    if (title) title.textContent = p.title;
    if (prompt) prompt.textContent = p.prompt;
    if (caveat) caveat.textContent = p.caveat;
    if (sources) {
      const label = document.createElement('span');
      label.className = 'notes-label';
      label.textContent = p.sources.length > 1 ? 'Sources' : 'Source';
      sources.replaceChildren(
        label,
        ...p.sources.map((src) => {
          const a = document.createElement('a');
          a.href = src.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = src.label;
          return a;
        }),
      );
    }
    void player.mount(id);
    host.dispatchEvent(new CustomEvent('wins-motion:change', { detail: { project: id } }));
    return true;
  }

  /* Follow the host page: when the element holding the project name changes, switch
     to that project. This is what makes it plug-and-play with an existing carousel. */
  const followEl = opts.follow ? (typeof opts.follow === 'string' ? document.querySelector(opts.follow) : opts.follow) : null;
  const named = (): string | null => (followEl ? resolve(followEl.getAttribute('data-project') || followEl.textContent) : null);
  if (followEl) {
    new MutationObserver(() => {
      const id = named();
      if (id && id !== current) show(id);
    }).observe(followEl, { childList: true, characterData: true, subtree: true, attributes: true });
  }
  if (opts.hash) {
    window.addEventListener('hashchange', () => {
      const id = resolve(location.hash.slice(1));
      if (id && id !== current) show(id);
    });
  }
  show(resolve(opts.project) || (opts.hash ? resolve(location.hash.slice(1)) : null) || named() || projects[0].id);
  void whenFontsReady();
  // Fetch the other films quietly so that switching is instant.
  const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 600));
  idle(() => projects.forEach((p) => void player.prewarm(p.id)));

  return {
    show,
    play: () => player.play(),
    pause: () => player.pause(),
    replay: () => player.replay(),
    /** Jump to a time in seconds. */
    seek: (t: number) => player.glideTo(t),
    get project() {
      return current;
    },
    get state() {
      const st = player.state;
      return { project: current, time: st.t, duration: st.duration, playing: st.playing, ended: st.ended };
    },
    projects: listing(),
    element: host,
  };
}

function mount(target: string | Element, opts: MountOptions = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error('WinsMotion.mount: target not found: ' + String(target));
  // One stage per page: a second call returns the first.
  return (instance ??= create(host, opts));
}

(window as any).WinsMotion = { version: '1.0.0', mount, projects: listing() };

// Declarative use: <div data-wins-motion data-project="..." data-follow="#selector">
const auto = (): void => {
  const el = document.querySelector('[data-wins-motion]');
  if (!el || instance) return;
  mount(el, {
    project: el.getAttribute('data-project') || undefined,
    follow: el.getAttribute('data-follow') || undefined,
    hash: el.hasAttribute('data-hash'),
    heading: el.getAttribute('data-heading') !== 'false',
    captions: el.getAttribute('data-captions') !== 'false',
    notes: el.getAttribute('data-notes') !== 'false',
    fonts: el.getAttribute('data-fonts') !== 'false',
  });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
else auto();
