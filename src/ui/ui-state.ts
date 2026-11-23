import type { Vec } from '../game/types';
import { newCamera, type Camera } from './camera';

export type Tab = 'select' | 'yard' | 'research' | 'expedition' | 'log';

export interface UIState {
  view: 'home' | 'expedition';
  tab: Tab;
  selShip: string | null;
  selNode: string | null;
  hoverPoint: Vec | null; // world position under the mouse
  speed: number;
  launch: string[]; // ships picked for the next expedition
  launchTier: number;
  toast: { msg: string; ok: boolean; until: number } | null;
  confirmReset: boolean;
  cams: { home: Camera; expedition: Camera };
}

export const initialUI = (): UIState => ({
  view: 'home',
  tab: 'select',
  selShip: null,
  selNode: null,
  hoverPoint: null,
  speed: 1,
  launch: [],
  launchTier: 1,
  toast: null,
  confirmReset: false,
  cams: { home: newCamera(1.8), expedition: newCamera(1.6) },
});
