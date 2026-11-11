/* Every film, loaded on demand. Each loader becomes its own small file in the
   split build, and is inlined in the single-file and embed builds. */
import type { SceneDef } from '../core/types.ts';

export const loaders: Record<string, () => Promise<SceneDef<any>>> = {
  fury: () => import('./fury.ts').then((m) => m.default),
  leonidas: () => import('./leonidas.ts').then((m) => m.default),
  'ward-250': () => import('./ward-250.ts').then((m) => m.default),
  'talon-a2': () => import('./talon-a2.ts').then((m) => m.default),
  'varda-w5': () => import('./varda-w5.ts').then((m) => m.default),
  lucas: () => import('./lucas.ts').then((m) => m.default),
  quarterhorse: () => import('./quarterhorse.ts').then((m) => m.default),
  marauder: () => import('./marauder.ts').then((m) => m.default),
  'victus-haze': () => import('./victus-haze.ts').then((m) => m.default),
  blackbeard: () => import('./blackbeard.ts').then((m) => m.default),
};
