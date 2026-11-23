import './style.css';
import * as A from './game/actions';
import { CONFIG } from './game/config';
import { hexDistance, pixelToHex } from './game/hex';
import { load, save, step } from './game/sim';
import { newGame, nodeAt, shipById } from './game/state';
import type { GameState, Hex, ModuleId, ShipType } from './game/types';
import { fmtTime } from './ui/format';
import { panel, tabs, topbar } from './ui/panel';
import { drawExpedition, drawHome, type View } from './ui/render';
import { initialUI, type Tab } from './ui/ui-state';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const loaded = load(storage());
let s: GameState = loaded.state;
const ui = initialUI();
if (loaded.offline > 60) toast(`Willkommen zurück! ${fmtTime(loaded.offline)} Offline-Fortschritt im Heimat-Sektor.`, true);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map');
const ctx = canvas.getContext('2d')!;
const elTop = $('top');
const elTabs = $('tabs');
const elPanel = $('panel');
const elToast = $('toast');
const elSpeed = $('speed');

let lastDraw: { view: View; shipPos: Map<string, { x: number; y: number }> } | null = null;
let cssW = 0;
let cssH = 0;

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cssW = r.width;
  cssH = r.height;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(canvas);
resize();

function toast(msg: string, ok: boolean) {
  ui.toast = { msg, ok, until: performance.now() + 3500 };
}

function run(r: A.Result) {
  toast(r.msg, r.ok);
  refreshPanel(true);
}

// ---- input on the map ------------------------------------------------------------

function hexAt(clientX: number, clientY: number): Hex | null {
  if (!lastDraw) return null;
  const r = canvas.getBoundingClientRect();
  const v = lastDraw.view;
  const h = pixelToHex(clientX - r.left - v.cx, clientY - r.top - v.cy, v.size);
  return hexDistance(h, { q: 0, r: 0 }) <= v.radius ? h : null;
}

function shipAt(clientX: number, clientY: number): string | null {
  if (!lastDraw) return null;
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  const hit = Math.max(14, lastDraw.view.size * 0.3);
  let best: string | null = null;
  let bestD = hit;
  for (const [id, p] of lastDraw.shipPos) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

canvas.addEventListener('pointermove', (e) => {
  ui.hoverHex = e.pointerType === 'mouse' ? hexAt(e.clientX, e.clientY) : null;
});
canvas.addEventListener('pointerleave', () => (ui.hoverHex = null));
canvas.addEventListener('click', (e) => {
  const shipId = shipAt(e.clientX, e.clientY);
  const selected = shipById(s, ui.selShip);
  const selectedHere = selected && (selected.location === 'home') === (ui.view === 'home');
  if (shipId && shipId !== ui.selShip) {
    ui.selShip = shipId;
    ui.selNode = null;
    ui.tab = 'select';
  } else if (shipId && shipId === ui.selShip) {
    ui.selShip = null;
  } else {
    const h = hexAt(e.clientX, e.clientY);
    if (!h) return;
    if (selectedHere) {
      const r = A.moveShip(s, selected.id, h);
      if (!r.ok) toast(r.msg, false);
    } else if (ui.view === 'home') {
      ui.selNode = nodeAt(s, h)?.id ?? null;
      ui.selShip = null;
      ui.tab = 'select';
    }
  }
  refreshPanel(true);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ui.selShip = null;
    ui.selNode = null;
    refreshPanel(true);
  }
});

// ---- input in the panel ----------------------------------------------------------

let pointerInPanel = false;
document.addEventListener('pointerdown', (e) => (pointerInPanel = !(e.target instanceof HTMLCanvasElement)));
document.addEventListener('pointerup', () => setTimeout(() => (pointerInPanel = false), 0));

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const arg = el.dataset.arg ?? '';
  switch (el.dataset.action) {
    case 'tab': ui.tab = arg as Tab; break;
    case 'view': ui.view = arg === 'expedition' && s.expedition ? 'expedition' : 'home'; ui.selShip = null; ui.selNode = null; if (ui.view === 'expedition') ui.tab = 'select'; break;
    case 'speed': ui.speed = Number(arg); break;
    case 'selectShip': {
      const ship = shipById(s, arg);
      if (ship) {
        ui.selShip = ship.id;
        ui.view = ship.location === 'expedition' ? 'expedition' : 'home';
        ui.tab = 'select';
      }
      break;
    }
    case 'deselect': ui.selShip = null; break;
    case 'colonize': run(A.colonize(s, arg)); break;
    case 'upgradePlanet': run(A.upgradePlanet(s, arg)); break;
    case 'hangar': run(A.upgradeHangar(s)); break;
    case 'build': run(A.buildShip(s, arg as ShipType)); break;
    case 'research': run(A.research(s, arg as ModuleId)); break;
    case 'beacon': run(A.craftBeacon(s, Number(arg))); break;
    case 'shuttle': { const [id, target] = arg.split('|'); run(A.setShuttle(s, id, target)); break; }
    case 'stopShuttle': run(A.stopShuttle(s, arg)); break;
    case 'launchTier': ui.launchTier = Number(arg); break;
    case 'launch': {
      const r = A.launchExpedition(s, Math.min(ui.launchTier, s.maxTier), ui.launch);
      run(r);
      if (r.ok) {
        ui.launch = [];
        ui.view = 'expedition';
        ui.tab = 'select';
        ui.selShip = null;
      }
      break;
    }
    case 'jump': run(A.jump(s, arg)); ui.selShip = null; break;
    case 'jumpAll': run(A.jumpAllAtGate(s)); break;
    case 'recall': run(A.recallAllToGate(s)); break;
    case 'reset':
      if (confirm('Wirklich ein neues Spiel beginnen? Der aktuelle Spielstand geht verloren.')) {
        s = newGame();
        Object.assign(ui, initialUI());
        save(s, storage());
      }
      break;
  }
  refreshPanel(true);
});

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.action !== 'pick') return;
  const id = el.dataset.arg!;
  if (el.checked) {
    if (ui.launch.length >= CONFIG.expedition.maxShips) {
      el.checked = false;
      toast(`Höchstens ${CONFIG.expedition.maxShips} Schiffe.`, false);
    } else ui.launch.push(id);
  } else ui.launch = ui.launch.filter((x) => x !== id);
  refreshPanel(true);
});

// ---- rendering -------------------------------------------------------------------

let cache = { top: '', tabs: '', panel: '', speed: '' };
function setHTML(el: HTMLElement, key: keyof typeof cache, html: string) {
  if (cache[key] !== html) {
    cache[key] = html;
    el.innerHTML = html;
  }
}

function refreshPanel(force = false) {
  if (pointerInPanel && !force) return;
  if (ui.view === 'expedition' && !s.expedition) ui.view = 'home';
  ui.launch = ui.launch.filter((id) => shipById(s, id)?.location === 'home');
  if (ui.selShip && !shipById(s, ui.selShip)) ui.selShip = null;
  setHTML(elTop, 'top', topbar(s, ui));
  setHTML(elTabs, 'tabs', tabs(ui));
  setHTML(elPanel, 'panel', panel(s, ui));
  setHTML(
    elSpeed,
    'speed',
    `<span class="muted small">Testtempo</span> ${[1, 10, 60].map((x) => `<button class="vbtn ${ui.speed === x ? 'on' : ''}" data-action="speed" data-arg="${x}">${x}×</button>`).join('')}`,
  );
  const t = ui.toast && ui.toast.until > performance.now() ? ui.toast : null;
  elToast.className = t ? `toast show ${t.ok ? 'ok' : 'bad'}` : 'toast';
  if (t) elToast.textContent = t.msg;
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  step(s, dt * ui.speed);
  if (ui.view === 'expedition' && !s.expedition) ui.view = 'home';
  lastDraw = ui.view === 'expedition' && s.expedition
    ? drawExpedition(ctx, s, ui, cssW, cssH, now)
    : drawHome(ctx, s, ui, cssW, cssH);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => refreshPanel(), 250);
setInterval(() => save(s, storage()), 5000);
document.addEventListener('visibilitychange', () => document.hidden && save(s, storage()));
window.addEventListener('pagehide', () => save(s, storage()));
refreshPanel(true);
