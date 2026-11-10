/* The transport: play, timeline with acts, clock, speed, captions and the gate
   button. Shared by the full page and the drop-in embed. */
import * as K from '../core/kit.ts';
import { player } from '../core/player.ts';
import type { Frame, SceneDef } from '../core/types.ts';

export interface TransportEls {
  play: HTMLElement;
  replay: HTMLElement;
  speed?: HTMLElement | null;
  acts: HTMLElement;
  fill: HTMLElement;
  ticks: HTMLElement;
  scrub: HTMLInputElement;
  clock: HTMLElement;
  caption: HTMLElement;
  controls: HTMLElement;
}

const RATES = [1, 1.5, 2];

export function bindTransport(els: TransportEls, o: { animate?: () => boolean } = {}): { cycleSpeed(): void } {
  let def: SceneDef<any> | null = null;
  let captionIndex = -2;
  let dragging = false;
  let gateButton: HTMLButtonElement | null = null;
  const useEl = els.play.querySelector('use');

  const setCaption = (text: string, takeaway: boolean): void => {
    els.caption.textContent = text;
    els.caption.classList.toggle('is-takeaway', takeaway);
    if ((o.animate?.() ?? true) && els.caption.animate) {
      els.caption.animate(
        [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }],
        { duration: 360, easing: 'cubic-bezier(.22,.72,.18,1)' },
      );
    }
  };

  player.on('mount', (d: SceneDef<any>) => {
    def = d;
    captionIndex = -2;
    gateButton = null;
    els.acts.replaceChildren();
    els.ticks.replaceChildren();
    d.acts.forEach((act, i) => {
      const b = K.h('button', '', els.acts, act.label);
      b.type = 'button';
      b.style.left = (act.at / d.duration) * 100 + '%';
      b.addEventListener('click', () => player.gotoAct(i));
      if (i) K.h('i', '', els.ticks).style.left = (act.at / d.duration) * 100 + '%';
    });
  });

  player.on('frame', (f: Frame) => {
    els.fill.style.transform = `scaleX(${f.progress})`;
    if (!dragging) els.scrub.value = String(Math.round(f.progress * 1000));
    K.text(els.clock, K.mmss(f.t));
    const buttons = els.acts.children;
    for (let i = 0; i < buttons.length; i++) K.attr(buttons[i], 'aria-current', String(i === f.act));
    if (!def) return;
    const caps = def.captions;
    let idx = -1;
    for (let i = 0; i < caps.length; i++) if (f.t >= caps[i].at - 1e-6) idx = i;
    if (f.ended || !caps.length) idx = caps.length;
    if (idx !== captionIndex) {
      captionIndex = idx;
      if (idx === caps.length) setCaption(def.takeaway, true);
      else setCaption(idx >= 0 ? caps[idx].text : '', false);
    }
  });

  player.on('state', () => {
    const st = player.state;
    const showPause = st.playing && !st.ended;
    useEl?.setAttribute('href', showPause ? '#i-pause' : st.ended ? '#i-replay' : '#i-play');
    els.play.setAttribute('aria-label', showPause ? 'Pause' : st.ended ? 'Replay' : 'Play');
    if (els.speed) {
      K.text(els.speed, `${st.rate}×`);
      K.attr(els.speed, 'aria-label', `Playback speed: ${st.rate} times`);
      K.attr(els.speed, 'aria-pressed', String(st.rate !== 1));
    }
    if (st.waiting && !gateButton) {
      gateButton = K.h('button', 'primary-control is-waiting', els.controls, st.waiting.label);
      gateButton.type = 'button';
      gateButton.addEventListener('click', () => player.release());
    } else if (!st.waiting && gateButton) {
      gateButton.remove();
      gateButton = null;
    }
  });

  els.play.addEventListener('click', () => player.toggle());
  els.replay.addEventListener('click', () => player.replay());
  const cycleSpeed = (): void => player.setRate(RATES[(RATES.indexOf(player.state.rate) + 1) % RATES.length]);
  els.speed?.addEventListener('click', cycleSpeed);

  const value = (): number => (Number(els.scrub.value) / 1000) * player.state.duration;
  els.scrub.addEventListener('pointerdown', () => {
    dragging = true;
    player.scrubStart();
  });
  els.scrub.addEventListener('input', () => {
    player.scrubTo(value());
    if (!dragging) player.scrubEnd();
  });
  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    player.scrubEnd();
  };
  els.scrub.addEventListener('pointerup', endDrag);
  els.scrub.addEventListener('pointercancel', endDrag);
  els.scrub.addEventListener('change', endDrag);

  return { cycleSpeed };
}

/** Load the fonts canvases draw with, then redraw once they are in. */
export function whenFontsReady(): Promise<void> {
  const faces = ['400 16px "Field Sans"', '500 16px "Field Sans"', '700 16px "Field Sans"', '400 16px "Field Mono"', '500 16px "Field Mono"'];
  if (!document.fonts) return Promise.resolve();
  return Promise.all(faces.map((f) => document.fonts.load(f)))
    .then(() => document.fonts.ready)
    .then(() => player.refresh())
    .catch(() => {});
}
