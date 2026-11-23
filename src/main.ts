import './style.css';
import * as A from './game/actions';
import { CONFIG } from './game/config';
import { insideMap } from './game/geom';
import { pixelToHex } from './game/hex';
import { load, save, step } from './game/sim';
import { isExplored, newGame, nodeNear, shipById } from './game/state';
import type { GameState, ModuleId, ShipType, SlotType, Vec } from './game/types';
import { fmtTime } from './ui/format';
import { panel, tabs, topbar } from './ui/panel';
import { resetCamera, zoomAt } from './ui/camera';
import { drawAnomaly, drawExpedition, drawHome, toWorld, type DrawResult } from './ui/render';
import { initialUI, type Tab } from './ui/ui-state';
import { Cloud } from './net/cloud';
import { Coop } from './net/coop';
import { coopGateSpot } from './game/anomaly';
import { coopData } from './ui/coop-view';

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

let lastDraw: DrawResult | null = null;
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

/** World position under a screen point, or null outside the map. */
function pointAt(clientX: number, clientY: number): Vec | null {
  if (!lastDraw) return null;
  const r = canvas.getBoundingClientRect();
  const p = toWorld(lastDraw.view, clientX - r.left, clientY - r.top);
  return insideMap(p, lastDraw.view.radius) ? p : null;
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

const cam = () => ui.cams[ui.view];

/** A short tap selects or gives a move order; dragging pans; wheel and pinch zoom. */
function handleTap(clientX: number, clientY: number) {
  if (ui.view === 'coop') return coopTap(clientX, clientY);
  const shipId = shipAt(clientX, clientY);
  const selected = shipById(s, ui.selShip);
  const selectedHere = selected && (selected.location === 'home') === (ui.view === 'home');
  if (shipId && shipId !== ui.selShip) {
    ui.selShip = shipId;
    ui.selNode = null;
    ui.tab = 'select';
  } else if (shipId && shipId === ui.selShip) {
    ui.selShip = null;
  } else {
    const p = pointAt(clientX, clientY);
    if (!p) return;
    if (selectedHere) {
      const r = A.moveShip(s, selected.id, p);
      if (!r.ok) toast(r.msg, false);
    } else if (ui.view === 'home') {
      if (!isExplored(s, pixelToHex(p.x, p.y, CONFIG.hexSize))) {
        toast('Unerforschter Nebel: Schicke ein Schiff hinein, um das Feld zu erkunden.', true);
        ui.selNode = null;
        refreshPanel(true);
        return;
      }
      ui.selNode = nodeNear(s, p, 1)?.id ?? null;
      ui.selShip = null;
      ui.tab = 'select';
    }
  }
  refreshPanel(true);
}

/** On the co-op map only your own ships can be selected; a tap elsewhere sends the selected one there. */
function coopTap(clientX: number, clientY: number) {
  const shipId = shipAt(clientX, clientY);
  if (shipId) {
    ui.selShip = shipId === ui.selShip ? null : shipId;
    ui.tab = 'select';
  } else {
    const p = pointAt(clientX, clientY);
    if (p && ui.selShip) coop.move(ui.selShip, p);
  }
  refreshPanel(true);
}

const pointers = new Map<number, { x: number; y: number }>();
let gesture = { sx: 0, sy: 0, moved: false };
const localXY = (clientX: number, clientY: number) => {
  const r = canvas.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
};

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) gesture = { sx: e.clientX, sy: e.clientY, moved: false };
  else gesture.moved = true; // a second finger means pinch, never a tap
});

// ---- cloud saves on the player's own server ------------------------------------------

const cloud = new Cloud(
  () => s,
  (next, note) => {
    s = next;
    ui.selShip = null;
    ui.selNode = null;
    save(s, storage());
    toast(note, true);
  },
  () => refreshPanel(true),
);
ui.cloud = cloud.view;

const coop = new Coop(
  () => cloud.sessionToken,
  () => s,
  () => refreshPanel(true),
  (msg, ok) => toast(msg, ok),
);
ui.coop = coop.view;
coop.onStart = () => {
  ui.view = 'coop';
  ui.tab = 'select';
  ui.selShip = null;
};

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id !== 'account-form') return;
  e.preventDefault();
  const mode = (e as SubmitEvent).submitter?.getAttribute('value') === 'register' ? 'register' : 'login';
  const name = (form.querySelector('#acc-name') as HTMLInputElement).value.trim();
  const pass = (form.querySelector('#acc-pass') as HTMLInputElement).value;
  void cloud.signIn(mode, name, pass);
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    ui.hoverPoint = e.pointerType === 'mouse' ? pointAt(e.clientX, e.clientY) : null;
    return;
  }
  if (pointers.size === 1) {
    if (!gesture.moved && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 6) {
      gesture.moved = true;
      canvas.classList.add('panning');
    }
    if (gesture.moved) {
      cam().x += e.clientX - prev.x;
      cam().y += e.clientY - prev.y;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const other = a === prev ? b : a;
    const before = Math.hypot(prev.x - other.x, prev.y - other.y);
    const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    const mid = localXY((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
    cam().x += (e.clientX - prev.x) / 2;
    cam().y += (e.clientY - prev.y) / 2;
    if (before > 10) zoomAt(cam(), after / before, mid.x, mid.y, cssW, cssH);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  ui.hoverPoint = null;
});

function endPointer(e: PointerEvent, tap: boolean) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    canvas.classList.remove('panning');
    if (tap && !gesture.moved) handleTap(e.clientX, e.clientY);
  }
}
canvas.addEventListener('pointerup', (e) => endPointer(e, true));
canvas.addEventListener('pointercancel', (e) => endPointer(e, false));
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') ui.hoverPoint = null;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const p = localXY(e.clientX, e.clientY);
    zoomAt(cam(), Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y, cssW, cssH);
  },
  { passive: false },
);
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
    case 'tab': ui.tab = arg as Tab; ui.confirmReset = false; break;
    case 'view':
      ui.view = arg === 'expedition' && s.expedition ? 'expedition' : arg === 'coop' && coop.view.snap ? 'coop' : 'home';
      ui.selShip = null;
      ui.selNode = null;
      if (ui.view !== 'home') ui.tab = 'select';
      break;
    case 'speed': ui.speed = Number(arg); break;
    case 'zoomIn': zoomAt(cam(), 1.3, cssW / 2, cssH / 2, cssW, cssH); break;
    case 'zoomOut': zoomAt(cam(), 1 / 1.3, cssW / 2, cssH / 2, cssW, cssH); break;
    case 'zoomReset': resetCamera(cam()); break;
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
    case 'coopQueue': {
      const err = coop.queue(Math.min(ui.launchTier, s.maxTier), ui.launch);
      toast(err ?? 'Suche nach Mitspielern …', !err);
      if (!err) ui.launch = [];
      break;
    }
    case 'coopCancel': coop.cancel(); break;
    case 'selectCoopShip': ui.selShip = arg; break;
    case 'coopJump': coop.jump(arg); ui.selShip = null; break;
    case 'coopAbility': coop.ability(arg); break;
    case 'coopRecall':
      for (const x of coop.view.snap?.ships ?? []) if (x.owner === coop.view.me) coop.move(x.id, coopGateSpot(x.owner, x.id));
      toast('Deine Schiffe fliegen zum Sprungtor.', true);
      break;
    case 'coopJumpAll':
      for (const x of coop.view.snap?.ships ?? []) if (x.owner === coop.view.me) coop.jump(x.id);
      break;
    case 'colonize': run(A.colonize(s, arg)); break;
    case 'upgradePlanet': run(A.upgradePlanet(s, arg)); break;
    case 'refinery': run(A.buildRefinery(s, arg)); break;
    case 'upgradeRefinery': run(A.upgradeRefinery(s, arg)); break;
    case 'hangar': run(A.upgradeHangar(s)); break;
    case 'build': run(A.buildShip(s, arg as ShipType)); break;
    case 'research': run(A.research(s, arg as ModuleId)); break;
    case 'equip': { const [id, slot, mod] = arg.split('|'); run(A.equip(s, id, slot as SlotType, (mod || null) as ModuleId | null)); break; }
    case 'activate': run(A.activate(s, arg)); break;
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
    case 'cloudSave': void cloud.push().then((ok) => toast(ok ? 'Auf dem Server gesichert.' : 'Sichern nicht möglich.', ok)); break;
    case 'cloudLogout': void cloud.signOut(); break;
    case 'cloudTake': void cloud.choose(arg === 'server' ? 'server' : 'local'); break;
    case 'recall': run(A.recallAllToGate(s)); break;
    case 'reset': ui.confirmReset = true; break;
    case 'resetNo': ui.confirmReset = false; break;
    case 'resetYes':
      s = newGame();
      Object.assign(ui, initialUI());
      save(s, storage());
      toast('Neues Spiel gestartet.', true);
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
  const coopNow = ui.view === 'coop' ? coopData(coop.view, now) : null;
  if (ui.view === 'coop' && !coopNow) ui.view = 'home';
  lastDraw = coopNow
    ? drawAnomaly(ctx, coopNow, ui, ui.cams.coop, cssW, cssH, now)
    : ui.view === 'expedition' && s.expedition
      ? drawExpedition(ctx, s, ui, cssW, cssH, now)
      : drawHome(ctx, s, ui, cssW, cssH, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => refreshPanel(), 250);
setInterval(() => save(s, storage()), 5000);
document.addEventListener('visibilitychange', () => document.hidden && save(s, storage()));
window.addEventListener('pagehide', () => {
  save(s, storage());
  void cloud.push(false, true);
});
refreshPanel(true);

// start talking to the server only once everything above is set up
void cloud.start();
setInterval(() => void cloud.push(), 60_000);
// keep the co-op connection open while signed in
setInterval(() => {
  if (cloud.view.name) coop.connect();
  else if (coop.view.status !== 'off') coop.disconnect();
}, 1000);
