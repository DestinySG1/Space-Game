import type { Hex } from '../game/types';

export type Tab = 'select' | 'yard' | 'research' | 'expedition' | 'log';

export interface UIState {
  view: 'home' | 'expedition';
  tab: Tab;
  selShip: string | null;
  selNode: string | null;
  hoverHex: Hex | null;
  speed: number;
  launch: string[]; // ships picked for the next expedition
  launchTier: number;
  toast: { msg: string; ok: boolean; until: number } | null;
}

export const initialUI = (): UIState => ({
  view: 'home',
  tab: 'select',
  selShip: null,
  selNode: null,
  hoverHex: null,
  speed: 1,
  launch: [],
  launchTier: 1,
  toast: null,
});
