/* The contract between the player and a film. */
import type { Rail } from '../ui/instruments.ts';

export interface Act {
  at: number;
  label: string;
}
export interface Caption {
  at: number;
  text: string;
}
/** The story stops at a gate until the viewer acts (or `auto` seconds pass). */
export interface Gate {
  id: string;
  at: number;
  label: string;
  auto?: number;
}

/** How the 1280 x 520 design space sits inside the real stage element. */
export interface View {
  width: number;
  height: number;
  scale: number;
  ox: number;
  oy: number;
  /** Visible bounds in design pixels (wider than 0..1280 on wide stages). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dpr: number;
  /** The size of one device pixel in design units: the width of a true hairline. */
  px: number;
}

/**
 * One moment of a film.
 *   t     story time in seconds, 0..duration. Can move backward.
 *   idle  seconds the story clock has stood still while playing (after the end, or at a gate).
 *   live  t + idle: continuous, for motion that must keep going.
 * A film's picture must be a pure function of (t, idle).
 */
export interface Frame {
  t: number;
  dt: number;
  idle: number;
  live: number;
  duration: number;
  progress: number;
  act: number;
  actT: number;
  ended: boolean;
  playing: boolean;
  /** True on hard seeks and the first frame: snap any smoothing to its target. */
  snap: boolean;
  gate: { id: string; waited: number; auto?: number } | null;
  view: View;
}

export interface Palette {
  bg: string;
  stage: string;
  sheet: string;
  sheet2: string;
  line: string;
  line2: string;
  wire: string;
  /** The new way: lines, dots and bars. */
  mark: string;
  /** The same, at full strength. */
  bright: string;
  dim: string;
  /** The one accent: what has just happened, or what to look at now. */
  live: string;
  ink: string;
  text: string;
  muted: string;
  faint: string;
  /** The old way. */
  old: string;
  /** Failure only. */
  alert: string;
}

export interface Layer {
  el: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

export interface Choice {
  el: HTMLElement;
  set(i: number): void;
  readonly value: number;
}

export interface Toggles {
  el: HTMLElement;
  set(i: number, on: boolean): void;
  get(i: number): boolean;
}

export interface PlayerApi {
  play(): void;
  pause(): void;
  toggle(): void;
  replay(): void;
  seek(t: number, idle?: number): void;
  glideTo(t: number, opts?: { then?: 'play' | 'stay' }): void;
  gotoAct(i: number): void;
  release(): void;
  /** Ask for a redraw after something outside the clock changed (a viewer's choice, for example). */
  refresh(): void;
}

export interface SceneContext {
  id: string;
  root: HTMLElement;
  colors: Palette;
  view: View;
  player: PlayerApi;
  /** A canvas whose 2-D context is already in design pixels each frame. First created is furthest back. */
  canvas(): Layer;
  /** The 1280 x 520 HTML layer for mock interfaces. */
  html(): HTMLElement;
  /** The instrument rail at the right edge of the stage. */
  rail(): Rail;
  /** Controls under the stage. */
  button(label: string, onClick: () => void): HTMLButtonElement;
  options(labels: string[], selected: number, onChange: (i: number) => void): Choice;
  /** Independent on/off switches under the stage. */
  toggles(labels: string[], onChange: (i: number, on: boolean) => void): Toggles;
}

export interface SceneInstance {
  update(f: Frame): void;
  resize?(view: View): void;
  destroy?(): void;
  onGate?(id: string, info: { auto: boolean }): void;
}

export interface SceneDef<P = unknown> {
  id: string;
  duration: number;
  /** Shown under the stage when the story ends. */
  takeaway: string;
  /** One sentence describing the film for people who cannot see it. */
  alt: string;
  acts: Act[];
  captions: Caption[];
  gates?: Gate[];
  /** Deterministic precomputation. May run ahead of time, while another film plays. */
  prepare?(): P;
  setup(ctx: SceneContext, prepared: P): SceneInstance;
}

export type Domain = 'Air' | 'Sea' | 'Space' | 'Land';
export interface Source {
  label: string;
  url: string;
}
export interface Project {
  id: string;
  name: string;
  short?: string;
  category: Domain;
  /** Who built it, where it happened and when: shown beside the number. */
  maker: string;
  place: string;
  when: string;
  description: string;
  /** The film's headline and the one line telling the viewer what to watch for. */
  title: string;
  prompt: string;
  /** Where the figures come from. The first is linked from the page. */
  sources: Source[];
  /** What the film cannot show: figures that were not released, or that are the maker's own count. */
  caveat: string;
}
