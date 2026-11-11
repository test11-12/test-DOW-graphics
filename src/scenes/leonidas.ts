/* Win 02 — Epirus Leonidas
   Sixty-one drones in five scenarios, ending with forty-nine brought down by one pulse.

   Every drone is a mark and stays where it falls, so the last frame can be counted.
   The air is a halftone: each pulse runs through it as a wave of dots. The viewer
   fires the last one. */
import * as K from '../core/kit.ts';
import { DASH, FONT, Halftone, Pen } from '../draw/pen.ts';
import type { SceneDef } from '../core/types.ts';
import * as S from './leonidas.sim.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const { DUR, SWARM_ACT, GATE, PULSE, WAVE, EMITTER, SAFE, TOTAL } = S;
const [EX, EY] = EMITTER;
const PITCH = 14;
const NOTES: Array<[number, string]> = [
  [1.0, 'Scenario 1 of 5 · two groups, opposite sides'],
  [3.35, 'Scenario 2 of 5 · one of a pair, chosen by the audience'],
  [4.95, 'Scenario 3 of 5 · brought down inside a safe zone'],
  [6.0, 'Scenario 4 of 5 · three ranges, at once'],
  [SWARM_ACT, 'Scenario 5 of 5 · a swarm of forty-nine'],
];

const def: SceneDef<S.Sim> = {
  id: 'leonidas',
  duration: DUR,
  takeaway: 'Sixty-one went up and sixty-one came down, by the company’s count. A missile takes one drone. A pulse takes a sky full.',
  alt: 'A view from above of a test range with a microwave emitter at the bottom. Small groups of drones approach and are brought down in four short scenarios. Then forty-nine drones gather in one swarm. A single pulse sweeps out from the emitter and all forty-nine fall at once. A roster of sixty-one dots fills as the drones come down.',
  acts: [
    { at: 0, label: 'Four set pieces' },
    { at: SWARM_ACT, label: 'The swarm' },
    { at: GATE, label: 'One pulse' },
  ],
  captions: [
    { at: 0, text: 'Camp Atterbury, Indiana. Drones are flown at Epirus’s own microwave weapon while nine allied countries watch.' },
    { at: 1.9, text: 'Three from the left, three from the right. Then one of a pair, picked by someone in the audience.' },
    { at: 4.95, text: 'One dropped inside a pre-set safe zone. Then three at three ranges, all at once.' },
    { at: SWARM_ACT, text: 'Then the finale: forty-nine drones of two types, in one swarm.' },
    { at: 11.6, text: 'Missile interceptors would take them one at a time. Leonidas gets one pulse.' },
    { at: GATE + 0.05, text: 'One pulse. All forty-nine fall at the same instant.' },
  ],
  gates: [{ id: 'pulse', at: GATE, label: 'Fire the pulse', auto: 5 }],
  prepare: S.simulate,

  setup(ctx, sim) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);
    const air = new Halftone(FX, FY, FW / PITCH, FH / PITCH, PITCH, { stagger: true });
    // Each dot's bearing and distance from the emitter never change: work them out once.
    const range = new Float32Array(air.n);
    const angle = new Float32Array(air.n);
    for (let i = 0; i < air.n; i++) {
      range[i] = K.dist(EX, EY, air.xs[i], air.ys[i]);
      angle[i] = Math.atan2(air.ys[i] - EY, air.xs[i] - EX);
    }
    const { drones, shots } = sim;
    const final = shots[shots.length - 1];

    const rail = ctx.rail();
    const phase = rail.phase('Engagement', ['Four set pieces', 'The swarm', 'One pulse']);
    const pair = rail.pair();
    const flying = pair.stat({ label: 'In the air', slots: 2 });
    const down = pair.stat({ label: 'Brought down', slots: 2, bar: true });
    const roster = rail.dots({ label: 'Every drone flown that day', count: TOTAL });
    const chart = rail.chart({ label: 'Brought down so far', height: 74 });
    rail.note('The counts are Epirus’s own, from an invitation-only demonstration. Flight paths and timing are drawn for clarity.');

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        const waiting = !!f.gate;
        pen.plate(FX, FY, FW, FH, { title: 'Fire zone, Camp Atterbury · seen from above · not to scale', right: '26 Aug 2025' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- The air: a pulse is a wave through the dots ---- */
        for (let i = 0; i < air.n; i++) {
          let tone = 0.06;
          let shade = 0;
          for (const s of shots) {
            const age = t - s.at;
            if (age < -0.45 || age > 1.6 || range[i] > s.reach) continue;
            let da = Math.abs(angle[i] - s.aim);
            if (da > Math.PI) da = K.TAU - da;
            if (da > s.half) continue;
            if (age < 0) {
              // Taking aim: the sector shows faintly before it fires.
              tone = Math.max(tone, 0.06 + 0.1 * (1 + age / 0.45));
              continue;
            }
            const since = age - range[i] / WAVE;
            if (since < 0) continue;
            const glow = Math.exp(-since * 3.4);
            if (glow > tone) {
              tone = glow;
              shade = since < 0.09 ? 2 : 1;
            }
          }
          air.tone[i] = tone;
          air.shade[i] = shade;
        }
        air.draw(pen, [K.rgba(col.wire, 0.7), K.rgba(col.mark, 0.8), col.live], { min: 0.05, max: 0.3, gamma: 0.9 });

        /* ---- The last shot's sector, held while the viewer decides ---- */
        const aimed = K.tween(t, GATE - 1.6, GATE - 0.4);
        if (aimed > 0 && t < PULSE + 1.2) {
          pen.stroke(col.mark, 0.5 * aimed * (1 - K.tween(t, PULSE, PULSE + 1.2)), 1, DASH.dash, -live * 8);
          g.beginPath();
          g.moveTo(EX, EY);
          g.arc(EX, EY, final.reach * aimed, final.aim - final.half, final.aim + final.half);
          g.closePath();
          g.stroke();
          g.setLineDash([]);
        }
        // After the story, the emitter keeps watching: a slow sweep.
        if (f.ended) {
          const a = -Math.PI / 2 + 0.9 * Math.sin(live * 0.5);
          pen.stroke(col.mark, 0.28 * K.tween(f.idle, 0, 1.2), 1, DASH.fine).line(EX, EY, EX + 420 * Math.cos(a), EY + 420 * Math.sin(a));
          g.setLineDash([]);
        }

        /* ---- The safe zone of the third scenario ---- */
        const zone = K.pulse(t, 4.7, SWARM_ACT + 0.6, 0.4);
        if (zone > 0) {
          pen.stroke(col.mark, 0.75 * zone, 1, DASH.dash).box(SAFE[0] - 26, SAFE[1] - 26, 52, 52);
          g.setLineDash([]);
          pen.cap('Safe zone', SAFE[0] + 34, SAFE[1] + 3, col.mark, zone);
        }

        /* ---- Drones: flying, hit, fallen ---- */
        let nFlying = 0;
        let nDown = 0;
        for (let i = 0; i < drones.length; i++) {
          const d = drones[i];
          if (t < d.spawn) continue;
          const dead = t >= d.kill;
          if (dead) nDown++;
          else nFlying++;
          const since = t - d.kill;
          roster.set(i, dead ? (since < 0.9 ? 6 : 1) : 4);
          if (!dead) {
            const p = S.path(d, t);
            const wobble = d.scenario === 4 ? 3.2 : 1.6;
            const x = p[0] + K.noise(live * 0.9 + i * 7.3, 1) * wobble;
            const y = p[1] + K.noise(live * 0.9 + i * 3.1, 2) * wobble;
            const q = S.path(d, t + 0.1);
            const heading = Math.atan2(q[1] - p[1] + 0.001, q[0] - p[0]);
            const a = K.tween(t, d.spawn, d.spawn + 0.3);
            pen.fill(col.stage, 0.8 * a).dot(x, y, 8.5);
            pen.drone(x, y, heading, 0.62, col.bright, a);
            if (i === sim.picked) {
              const pick = K.pulse(t, 3.6, d.kill, 0.25);
              pen.brackets(x, y, 13, col.ink, pick, 4);
              if (pick > 0) pen.cap('Picked', x + 19, y - 8, col.ink, pick);
            }
          } else {
            // It keeps a little of its speed, drops, and lies where it lands.
            const fall = K.ease.out(K.seg(since, 0, 0.7));
            const x = d.at[0] + Math.cos(d.spin) * 5 * fall;
            const y = d.at[1] + 9 * fall;
            const flash = Math.exp(-since * 5);
            pen.fill(col.stage, 0.8).dot(x, y, 7);
            pen.drone(x, y, d.spin + fall * 1.4, K.lerp(0.62, 0.5, fall), K.blend(col.faint, col.live, flash), K.lerp(1, 0.78, fall));
          }
        }
        g.restore();

        /* ---- The emitter ---- */
        pen.fill(col.stage).rect(EX - 30, EY - 8, 60, 22);
        g.fill();
        pen.stroke(col.bright, 1, 1.3).box(EX - 26, EY - 5, 52, 10);
        pen.stroke(col.bright, 0.6, 1);
        for (let k = 1; k < 8; k++) pen.vline(EX - 26 + k * 6.5, EY - 5, EY + 5);
        pen.stroke(col.bright, 1, 1.3).line(EX - 9, EY + 5, EX - 14, EY + 14).line(EX + 9, EY + 5, EX + 14, EY + 14);
        const hot = Math.max(...shots.map((s) => Math.exp(-Math.max(0, t - s.at) * 6) * (t >= s.at ? 1 : 0)));
        if (hot > 0.02) pen.fill(col.live, hot).rect(EX - 26, EY - 5, 52, 10), g.fill();
        pen.label(EX + 27, EY, EX + 74, EY - 26, ['Leonidas', 'high-power microwave'], { color: col.ink, u: K.tween(t, 0.3, 1.1) });

        /* ---- What is happening now ---- */
        let k = -1;
        for (let i = 0; i < NOTES.length; i++) if (t >= NOTES[i][0]) k = i;
        if (k >= 0) pen.cap(NOTES[k][1], FX + 14, FY + 22, col.ink, K.tween(t, NOTES[k][0], NOTES[k][0] + 0.3) * (1 - K.tween(t, PULSE + 1.4, PULSE + 2.2)));
        const tallied = K.tween(t, PULSE + 1.6, PULSE + 2.4);
        pen.cap('61 flown · 61 down · five scenarios', FX + 14, FY + 22, col.live, tallied);
        if (waiting) pen.cap('Sector set · waiting for the order', EX - 42, EY + 4, col.ink, 0.55 + 0.45 * Math.sin(live * 4) ** 2, 'right');

        /* ---- Instruments ---- */
        phase.set(K.tween(t, SWARM_ACT, SWARM_ACT + 0.7) + K.tween(t, GATE + 0.05, GATE + 0.75));
        flying.set(nFlying);
        down.set(nDown);
        down.bar(nDown / TOTAL);
        for (let i = 0; i < drones.length; i++) if (t < drones[i].spawn) roster.set(i, 0);
        roster.legend(nDown === TOTAL ? '61 of 61 down' : nDown ? `${nDown} down · ${nFlying} flying` : nFlying ? `${nFlying} flying` : 'none launched yet');

        chart.clear();
        const cg = chart.g;
        const px = (time: number): number => (time / DUR) * chart.w;
        const py = (n: number): number => 6 + (1 - n / TOTAL) * (chart.h - 22);
        cg.lineWidth = 1;
        cg.strokeStyle = col.line2;
        cg.beginPath();
        cg.moveTo(0, py(0) + 0.5);
        cg.lineTo(chart.w, py(0) + 0.5);
        cg.stroke();
        cg.setLineDash([1.5, 3.5]);
        cg.strokeStyle = col.wire;
        cg.beginPath();
        cg.moveTo(0, py(TOTAL) + 0.5);
        cg.lineTo(chart.w, py(TOTAL) + 0.5);
        cg.stroke();
        cg.setLineDash([]);
        cg.strokeStyle = col.bright;
        cg.lineWidth = 1.6;
        cg.beginPath();
        cg.moveTo(0, py(0));
        let n = 0;
        for (const s of shots) {
          if (s.at > t) break;
          const got = S.tally(sim, Math.min(t, s.at + 0.4)).down;
          cg.lineTo(px(s.at), py(n));
          cg.lineTo(px(s.at), py(got));
          n = got;
        }
        cg.lineTo(px(t), py(n));
        cg.stroke();
        cg.fillStyle = t >= PULSE && t < PULSE + 1.5 ? col.live : col.ink;
        cg.beginPath();
        cg.arc(px(t), py(n), 2.6, 0, K.TAU);
        cg.fill();
        cg.font = FONT.tick;
        cg.textBaseline = 'alphabetic';
        cg.fillStyle = col.faint;
        cg.textAlign = 'left';
        cg.fillText('0', 0, chart.h - 2);
        cg.fillText('61', 0, py(TOTAL) + 12);
        if (t > PULSE + 0.4) {
          cg.fillStyle = col.muted;
          cg.textAlign = 'right';
          cg.fillText('49 in one pulse', px(PULSE) - 7, py(36));
        }
      },
    };
  },
};
export default def;
