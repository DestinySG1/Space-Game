// Side panel: HTML built from state. Buttons carry data-action / data-arg, handled in main.ts.
import { cooldownLeft, shuttleTargets } from '../game/actions';
import { CONFIG, MODULES, SLOTS, SLOT_NAMES, moduleInfo } from '../game/config';
import {
  beaconCost, canAfford, colonizeCost, hangarSlots, hangarUpgradeCost, jumpFuel, passiveIncome, planetOutput, planetUpgradeCost,
  refineryCost, refineryOutput, refineryUpgradeCost, researchCost, shipCost, shipStats, tradeValuePerUnit, unlockThreshold,
  type Cost,
} from '../game/economy';
import { canJump, expeditionShips } from '../game/expedition';
import { nodeById, nodeNear, shipById } from '../game/state';
import type { GameState, Job, ModuleId, Ship, ShipType, SlotType } from '../game/types';
import { esc, fmt, fmt1, fmtTime } from './format';
import type { UIState } from './ui-state';

const cost = (c: Partial<Cost>) =>
  [
    c.credits ? `<span class="res cr">${fmt(c.credits)}</span>` : '',
    c.ore ? `<span class="res ore">${fmt(c.ore)}</span>` : '',
    c.shards ? `<span class="res sh">${fmt(c.shards)}</span>` : '',
    c.hydrogen ? `<span class="res h2">${fmt(c.hydrogen)}</span>` : '',
  ].join(' ') || 'kostenlos';

const btn = (action: string, text: string, opts: { arg?: string; disabled?: boolean; kind?: string } = {}) =>
  `<button class="btn ${opts.kind ?? ''}" data-action="${action}" ${opts.arg !== undefined ? `data-arg="${esc(opts.arg)}"` : ''} ${opts.disabled ? 'disabled' : ''}>${text}</button>`;

const progress = (job: Job) =>
  `<div class="prog"><div style="width:${(100 * (1 - job.remaining / job.total)).toFixed(1)}%"></div></div>
   <div class="muted small">noch ${fmtTime(job.remaining)}</div>`;

const SHIP_ROLE: Record<ShipType, string> = {
  hauler: 'Handelt zwischen Posten. Trägt in Expeditionen viele Splitter.',
  miner: 'Baut Erz in Gürteln ab, in Expeditionen Splitter.',
  warden: 'Kampfschiff. Schützt die Flotte in Expeditionen.',
};

export function topbar(s: GameState, ui: UIState): string {
  const ex = s.expedition;
  return `
    <div class="brand">Lumen Reach</div>
    <div class="resbar">
      <span class="res cr" title="Credits">${fmt(s.credits)}</span>
      <span class="res ore" title="Erz">${fmt(s.ore)}</span>
      <span class="res sh" title="Echo-Splitter">${fmt(s.shards)}</span>
      <span class="res h2 ${s.hydrogen < 1 ? 'empty' : ''}" title="Wasserstoff (Treibstoff)">${fmt(s.hydrogen)}</span>
    </div>
    <div class="views">
      <button class="vbtn ${ui.view === 'home' ? 'on' : ''}" data-action="view" data-arg="home">Heimat-Sektor</button>
      ${ex ? `<button class="vbtn ${ui.view === 'expedition' ? 'on' : ''} ${ex.duration - ex.elapsed < CONFIG.expedition.collapseWarning ? 'warn' : ''}" data-action="view" data-arg="expedition">Expedition ${fmtTime(ex.duration - ex.elapsed)}</button>` : ''}
    </div>`;
}

export function tabs(ui: UIState): string {
  const t: [UIState['tab'], string][] = [
    ['select', 'Auswahl'], ['yard', 'Werft'], ['research', 'Module'], ['expedition', 'Expedition'], ['log', 'Logbuch'], ['account', 'Konto'],
  ];
  return t.map(([id, name]) => `<button class="tab ${ui.tab === id ? 'on' : ''}" data-action="tab" data-arg="${id}">${name}</button>`).join('');
}

export function panel(s: GameState, ui: UIState): string {
  switch (ui.tab) {
    case 'select': return selectionPanel(s, ui);
    case 'yard': return yardPanel(s);
    case 'research': return researchPanel(s);
    case 'expedition': return expeditionPanel(s, ui);
    case 'log': return logPanel(s, ui);
    case 'account': return accountPanel(ui);
  }
}

// ---- Selection ---------------------------------------------------------------

function selectionPanel(s: GameState, ui: UIState): string {
  const ship = shipById(s, ui.selShip);
  if (ship && ((ui.view === 'home') === (ship.location === 'home'))) return shipPanel(s, ship);
  const node = ui.view === 'home' ? nodeById(s, ui.selNode) : undefined;
  if (node) return nodePanel(s, node.id);
  if (ui.view === 'expedition') return expeditionHelp(s);
  return `
    <h2>Heimat-Sektor</h2>
    <p>Tippe auf ein Schiff, um es auszuwählen, dann irgendwo auf die Karte, um es dorthin zu schicken. Karte ziehen zum Verschieben, Mausrad oder zwei Finger zum Zoomen.</p>
    <ul class="hints">
      <li><b>Planeten</b> kolonisieren: liefern dauerhaft Credits oder Erz.</li>
      <li><b>Frachter</b> zwischen zwei <b>Handelsposten</b> pendeln lassen: je weiter, desto mehr Credits.</li>
      <li><b>Schürfer</b> zwischen <b>Gürtel</b> und <b>Heimatbasis</b> pendeln lassen: bringt Erz.</li>
      <li>Der <b>schwarze Nebel</b> ist unerforscht: Schicke ein Schiff hinein, um zu sehen, was dort liegt.</li>
      <li>Fliegen kostet <b>Wasserstoff</b>. An <b>Gasriesen</b> Raffinerien bauen, sonst kriechen die Schiffe mit leerem Tank.</li>
      <li>Mit Erz und Credits einen <b>Sprungkern</b> schmieden und eine <b>Expedition</b> starten.</li>
    </ul>
    <div class="card">Erforscht: <b>${s.explored.length}</b> von ${3 * CONFIG.sector.radius * (CONFIG.sector.radius + 1) + 1} Feldern</div>
    ${incomeSummary(s)}`;
}

function incomeSummary(s: GameState): string {
  const inc = passiveIncome(s);
  return `<div class="card"><div class="muted small">Kolonien und Raffinerien liefern pro Minute</div>
    <span class="res cr">${fmt1(inc.credits * 60)}</span> <span class="res ore">${fmt1(inc.ore * 60)}</span>
    <span class="res h2">${fmt1(inc.hydrogen * 60)}</span></div>`;
}

function nodePanel(s: GameState, id: string): string {
  const n = nodeById(s, id)!;
  const shipsHere = s.ships.filter((x) => x.location === 'home' && !x.target && nodeNear(s, x.pos)?.id === n.id);
  const shipList = shipsHere.length
    ? `<div class="muted small">Schiffe hier:</div>${shipsHere.map((x) => btn('selectShip', `${CONFIG.ships[x.type].name} ${esc(x.name)}`, { arg: x.id, kind: 'ghost' })).join(' ')}`
    : '';
  if (n.kind === 'base') {
    return `<h2>${esc(n.name)}</h2><p>Hier werden Schiffe gebaut und Erz abgeliefert.</p>${incomeSummary(s)}${shipList}`;
  }
  if (n.kind === 'planet') {
    const type = n.planetType === 'garden' ? 'Gartenwelt (Credits)' : 'Felsenwelt (Erz)';
    if (n.level === 0) {
      const c = colonizeCost(s);
      return `<h2>${esc(n.name)}</h2><p class="muted">${type} · nicht kolonisiert</p>
        ${btn('colonize', `Kolonisieren · ${cost(c)}`, { arg: n.id, disabled: !canAfford(s, c) })}${shipList}`;
    }
    const o = planetOutput(n);
    const next = { ...n, level: n.level + 1 };
    const on = planetOutput(next);
    const c = planetUpgradeCost(n);
    const maxed = n.level >= CONFIG.planet.maxLevel;
    return `<h2>${esc(n.name)} <span class="lvl">Stufe ${n.level}</span></h2><p class="muted">${type}</p>
      <div class="card">pro Minute: <span class="res cr">${fmt1(o.credits * 60)}</span> <span class="res ore">${fmt1(o.ore * 60)}</span>
      ${maxed ? '' : `<div class="muted small">nächste Stufe: <span class="res cr">${fmt1(on.credits * 60)}</span> <span class="res ore">${fmt1(on.ore * 60)}</span></div>`}</div>
      ${maxed ? '<p class="muted">Maximale Stufe.</p>' : btn('upgradePlanet', `Ausbauen · ${cost(c)}`, { arg: n.id, disabled: !canAfford(s, c) })}${shipList}`;
  }
  if (n.kind === 'gasgiant') {
    if (n.level === 0) {
      const c = refineryCost(s);
      return `<h2>${esc(n.name)}</h2><p>Gasriese. Eine Raffinerie gewinnt hier <span class="res h2">Wasserstoff</span>, den Treibstoff deiner Schiffe.</p>
        ${btn('refinery', `Raffinerie bauen · ${cost(c)}`, { arg: n.id, disabled: !canAfford(s, c) })}${shipList}`;
    }
    const maxed = n.level >= CONFIG.hydrogen.maxLevel;
    const c = refineryUpgradeCost(n);
    const next = refineryOutput({ ...n, level: n.level + 1 });
    return `<h2>${esc(n.name)} <span class="lvl">Raffinerie ${n.level}</span></h2>
      <div class="card">pro Minute: <span class="res h2">${fmt1(refineryOutput(n) * 60)}</span>
      ${maxed ? '' : `<div class="muted small">nächste Stufe: <span class="res h2">${fmt1(next * 60)}</span></div>`}</div>
      ${maxed ? '<p class="muted">Maximale Stufe.</p>' : btn('upgradeRefinery', `Ausbauen · ${cost(c)}`, { arg: n.id, disabled: !canAfford(s, c) })}${shipList}`;
  }
  if (n.kind === 'station') {
    const others = s.nodes.filter((x) => x.kind === 'station' && x.id !== n.id);
    return `<h2>${esc(n.name)}</h2><p>Produziert Waren. Frachter laden sie hier und verkaufen sie an einem anderen Posten.</p>
      <div class="card">Lager: <b>${Math.floor(n.stock)}</b> / ${CONFIG.station.stockCap}
      ${others.map((o) => `<div class="muted small">nach ${esc(o.name)}: ${fmt1(tradeValuePerUnit(s, n, o))} Credits pro Ware</div>`).join('')}</div>${shipList}`;
  }
  return `<h2>${esc(n.name)}</h2><p>Asteroidengürtel. Schürfer bauen hier Erz ab, es wächst langsam nach.</p>
    <div class="card">Erz: <b>${Math.floor(n.ore)}</b> / ${CONFIG.asteroid.oreMax}</div>${shipList}`;
}

function shipPanel(s: GameState, ship: Ship): string {
  const st = shipStats(s, ship.type, ship);
  const head = `<h2>${CONFIG.ships[ship.type].name} „${esc(ship.name)}“</h2>
    <p class="muted small">${SHIP_ROLE[ship.type]}</p>
    <div class="card stats">
      <div>Rumpf <b>${fmt(ship.hull)}</b>/${fmt(st.hull)}</div><div>Schild <b>${fmt(ship.shield)}</b>/${fmt(st.shield)}</div>
      ${st.dps ? `<div>Schaden <b>${fmt1(st.dps)}</b>/s${st.targets > 1 ? ` ×${st.targets}` : ''}</div>` : ''}
      <div>Verbrauch <b>${fmt1(CONFIG.hydrogen.burn[ship.type] * 10)}</b> H₂/10 E.</div>
      ${ship.location === 'home' ? `<div>Ladung <b>${fmt(ship.cargo)}</b>/${fmt(st.cargoHome)}</div>` : `<div>Splitter <b>${fmt(ship.shards)}</b>/${fmt(st.cargoExp)}</div>`}
    </div>`;
  const status = ship.target
    ? `<p class="muted small">unterwegs …${ship.location === 'home' && s.hydrogen < 1 ? ' <b style="color:var(--bad)">Tank leer – nur 25 % Tempo</b>' : ''}</p>`
    : '';
  if (ship.location === 'expedition') {
    return `${head}${status}<p class="muted small">Tippe irgendwo auf die Karte, um dorthin zu fliegen. Am Sprungtor kann das Schiff heimspringen.</p>
      <div class="row">${btn('jump', 'Heimsprung', { arg: ship.id, disabled: !canJump(ship), kind: 'primary' })} ${abilityButton(s, ship)}</div>
      ${fitting(s, ship)}
      ${btn('deselect', 'Abwählen', { kind: 'ghost' })}`;
  }
  let route = '';
  if (ship.shuttle) {
    const a = nodeById(s, ship.shuttle.a)!;
    const b = nodeById(s, ship.shuttle.b)!;
    route = `<div class="card">Pendelroute: <b>${esc(a.name)} ↔ ${esc(b.name)}</b><br>${btn('stopShuttle', 'Route beenden', { arg: ship.id, kind: 'ghost' })}</div>`;
  } else {
    const targets = shuttleTargets(s, ship.id);
    const here = nodeNear(s, ship.pos);
    if (targets.length && !ship.target) {
      route = `<div class="card"><div class="muted small">Automatisch pendeln ab ${esc(here!.name)}:</div>
        ${targets.map((id) => btn('shuttle', `↔ ${esc(nodeById(s, id)!.name)}`, { arg: `${ship.id}|${id}` })).join(' ')}</div>`;
    } else if (ship.type !== 'warden') {
      route = `<p class="muted small">${ship.type === 'hauler' ? 'Fliege zu einem Handelsposten, um eine Pendelroute einzurichten.' : 'Fliege zu einem Gürtel oder zur Basis, um eine Pendelroute einzurichten.'}</p>`;
    }
  }
  return `${head}${status}${route}${fitting(s, ship)}${btn('deselect', 'Abwählen', { kind: 'ghost' })}`;
}

function expeditionHelp(s: GameState): string {
  const ex = s.expedition;
  if (!ex) return '<p>Keine Expedition aktiv.</p>';
  const ships = expeditionShips(s);
  return `<h2>Anomalie Stufe ${ex.tier}</h2>
    <p>Schürfer auf <b class="sh-t">Splitter-Vorkommen</b> schicken. Ein Frachter direkt daneben übernimmt die Splitter.
    Wächter in der Nähe ziehen das Feuer der Gegner auf sich. Zurück zum <b>Sprungtor</b> und heimspringen, bevor die Zeit abläuft.</p>
    <div class="card">Restzeit <b>${fmtTime(ex.duration - ex.elapsed)}</b> · Welle ${ex.waveIndex} · Gegner ${ex.enemies.length}</div>
    ${ships.map((x) => btn('selectShip', `${CONFIG.ships[x.type].name} ${esc(x.name)} ◆${Math.floor(x.shards)}`, { arg: x.id, kind: 'ghost' })).join(' ')}
    <div class="row">${ships.map((x) => abilityButton(s, x)).join(' ')}</div>
    <div class="row">${btn('recall', 'Alle zum Tor')} ${btn('jumpAll', 'Alle am Tor: Heimsprung', { kind: 'primary' })}</div>`;
}

// ---- Shipyard ----------------------------------------------------------------

function yardPanel(s: GameState): string {
  const q = s.queue.ship;
  const used = s.ships.length;
  const slots = hangarSlots(s);
  const types: ShipType[] = ['hauler', 'miner', 'warden'];
  const hc = hangarUpgradeCost(s);
  return `<h2>Werft</h2>
    <div class="card">Hangar: <b>${used}</b> / ${slots} Schiffe
      ${s.hangar < CONFIG.hangar.maxLevel ? `<br>${btn('hangar', `Hangar erweitern · ${cost(hc)}`, { disabled: !canAfford(s, hc) })}` : ''}</div>
    ${q ? `<div class="card">Im Bau: <b>${CONFIG.ships[q.target as ShipType].name}</b>${progress(q)}</div>` : ''}
    ${types.map((t) => {
      const c = shipCost(t);
      const st = shipStats(s, t);
      return `<div class="card">
        <div class="ct"><b>${CONFIG.ships[t].name}</b><span class="muted small">${fmtTime(CONFIG.ships[t].buildTime)}</span></div>
        <div class="muted small">${SHIP_ROLE[t]}</div>
        <div class="muted small">Rumpf ${fmt(st.hull)} · Schild ${fmt(st.shield)}${st.dps ? ` · Schaden ${fmt1(st.dps)}/s` : ''}</div>
        ${btn('build', `Bauen · ${cost(c)}`, { arg: t, disabled: !!q || used >= slots || !canAfford(s, c) })}
      </div>`;
    }).join('')}
    <h3>Flotte</h3>
    ${s.ships.map((x) => `<div class="fleet">${btn('selectShip', `${CONFIG.ships[x.type].name} ${esc(x.name)}`, { arg: x.id, kind: 'ghost' })}
      <span class="muted small">${x.location === 'expedition' ? 'in Expedition' : x.shuttle ? 'pendelt' : x.target ? 'unterwegs' : 'bereit'}</span></div>`).join('') || '<p class="muted">Keine Schiffe.</p>'}`;
}

// ---- Research ----------------------------------------------------------------

function researchPanel(s: GameState): string {
  const q = s.queue.research;
  const slots: SlotType[] = ['weapon', 'shield', 'support', 'trade', 'mining'];
  return `<h2>Module</h2>
    <p class="muted small">Entschlüssle Baupläne und baue die Module unter <b>Auswahl</b> in einzelne Schiffe ein.
    Ab Stufe 2 braucht jeder Bauplan <span class="res sh">Echo-Splitter</span> aus Expeditionen. Eingebaute Module werden
    mit jeder neuen Stufe automatisch stärker.</p>
    ${q ? `<div class="card">Entschlüsselt: <b>${moduleInfo(q.target as ModuleId).name}</b>${progress(q)}</div>` : ''}
    ${slots.map((slot) => `<h3>${SLOT_NAMES[slot]} <span class="muted small">· ${slotUsers(slot)}</span></h3>` + MODULES.filter((m) => m.slot === slot).map((m) => {
      const l = s.blueprints[m.id];
      const maxed = l >= CONFIG.research.maxLevel;
      const c = researchCost(s, m.id);
      const users = s.ships.filter((x) => x.fit[m.slot] === m.id).length;
      return `<div class="card">
        <div class="ct"><b>${m.name}${m.cooldown ? ' <span class="tag">aktiv</span>' : ''}</b><span class="lvl">${l}/${CONFIG.research.maxLevel}</span></div>
        <div class="muted small">${m.desc}${users ? ` · eingebaut in ${users} Schiff(en)` : ''}</div>
        ${maxed ? '' : btn('research', `${l === 0 ? 'Entschlüsseln' : 'Aufwerten'} · ${cost(c)} · ${fmtTime(c.time)}`, { arg: m.id, disabled: !!q || !canAfford(s, c) })}
      </div>`;
    }).join('')).join('')}`;
}

const slotUsers = (slot: SlotType) =>
  (Object.keys(SLOTS) as ShipType[]).filter((t) => SLOTS[t].includes(slot)).map((t) => CONFIG.ships[t].name).join(', ');

/** Slot list for a ship: what is installed and what could be. */
function fitting(s: GameState, ship: Ship): string {
  const home = ship.location === 'home';
  return `<div class="card"><div class="muted small">Module${home ? '' : ' (wechseln nur im Heimat-Sektor)'}</div>
    ${SLOTS[ship.type].map((slot) => {
      const cur = ship.fit[slot];
      const options = MODULES.filter((m) => m.slot === slot && s.blueprints[m.id] > 0 && m.id !== cur);
      return `<div class="slot"><span class="muted small">${SLOT_NAMES[slot]}</span>
        <b>${cur ? `${moduleInfo(cur).name} ${s.blueprints[cur]}` : '<span class="muted">leer</span>'}</b>
        ${home ? `<div class="row">${options.map((m) => btn('equip', `${m.name} ${s.blueprints[m.id]}`, { arg: `${ship.id}|${slot}|${m.id}`, kind: 'ghost' })).join('')}
          ${cur ? btn('equip', 'Ausbauen', { arg: `${ship.id}|${slot}|`, kind: 'ghost' }) : ''}
          ${!cur && !options.length ? '<span class="muted small">Noch kein Bauplan – siehe Tab Module.</span>' : ''}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
}

/** Button for the ship's active module during an expedition. */
function abilityButton(s: GameState, ship: Ship): string {
  const id = ship.fit.support;
  if (!id || !moduleInfo(id).cooldown) return '';
  const left = cooldownLeft(s, ship, id);
  return btn('activate', left > 0 ? `${moduleInfo(id).name} · ${Math.ceil(left)} s` : `${moduleInfo(id).name} auslösen`, { arg: ship.id, disabled: left > 0, kind: 'primary' });
}

// ---- Expedition --------------------------------------------------------------

function expeditionPanel(s: GameState, ui: UIState): string {
  const q = s.queue.beacon;
  const tiers = Array.from({ length: s.maxTier }, (_, i) => i + 1);
  const forge = `<h2>Schmiede</h2>
    <p class="muted small">Ein Sprungkern öffnet eine Anomalie. Höhere Stufen: mehr Splitter, stärkere Gegner.</p>
    ${q ? `<div class="card">Schmiedet Stufe <b>${q.target}</b>${progress(q)}</div>` : ''}
    ${tiers.map((t) => {
      const c = beaconCost(t);
      return `<div class="card"><div class="ct"><b>Sprungkern Stufe ${t}</b><span class="muted small">Vorrat: ${s.beacons[t] ?? 0}</span></div>
        ${btn('beacon', `Schmieden · ${cost(c)} · ${fmtTime(c.time)}`, { arg: String(t), disabled: !!q || !canAfford(s, c) })}</div>`;
    }).join('')}`;

  const last = s.lastResult
    ? `<div class="card"><b>Letzte Expedition</b> (Stufe ${s.lastResult.tier}): ${s.lastResult.banked} Splitter gesichert, ${s.lastResult.shipsLost} Schiff(e) verloren${s.lastResult.unlocked ? ' · <b>neue Stufe frei!</b>' : ''}</div>`
    : '';

  if (s.expedition) {
    return `<h2>Expedition läuft</h2>${expeditionHelp(s)}${btn('view', 'Zur Expedition', { arg: 'expedition', kind: 'primary' })}${forge}`;
  }

  const home = s.ships.filter((x) => x.location === 'home');
  const tier = Math.min(ui.launchTier, s.maxTier);
  const have = s.beacons[tier] ?? 0;
  const fuel = jumpFuel(tier, Math.max(1, ui.launch.length));
  const fuelOk = s.hydrogen >= fuel;
  return `<h2>Expedition starten</h2>
    <p class="muted small">Dauer ${fmtTime(CONFIG.expedition.duration)}. Schiffe, die bei Ablauf noch drin sind, gehen verloren – mit ihrer Ladung.
    Sichere ${unlockThreshold(s.maxTier)} Splitter auf Stufe ${s.maxTier}, um die nächste Stufe freizuschalten.</p>
    ${s.ships.some((x) => x.type === 'warden') ? '' : '<p class="small" style="color:var(--bad)">Ohne Wächter überlebt keine Flotte lange. Baue zuerst einen in der Werft.</p>'}
    <div class="card"><div class="muted small">Stufe</div>
      ${tiers.map((t) => btn('launchTier', `${t} (${s.beacons[t] ?? 0})`, { arg: String(t), kind: t === tier ? 'primary' : 'ghost' })).join(' ')}
      <div class="muted small" style="margin-top:8px">Schiffe (max. ${CONFIG.expedition.maxShips})</div>
      ${home.map((x) => `<label class="chk"><input type="checkbox" data-action="pick" data-arg="${x.id}" ${ui.launch.includes(x.id) ? 'checked' : ''}> ${CONFIG.ships[x.type].name} ${esc(x.name)}</label>`).join('') || '<p class="muted">Keine Schiffe zu Hause.</p>'}
      <div class="muted small" style="margin-top:8px">Sprungtreibstoff: ${cost({ hydrogen: fuel })} (${CONFIG.hydrogen.jumpPerShip * tier} pro Schiff)</div>
      ${btn('launch', !have ? 'Erst einen Sprungkern schmieden' : !fuelOk ? 'Zu wenig Wasserstoff' : 'Sprung!', { kind: 'primary', disabled: !have || !fuelOk || ui.launch.length === 0 })}
    </div>${last}${forge}`;
}

const clock = (ms: number) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

function accountPanel(ui: UIState): string {
  const c = ui.cloud;
  if (!c || c.available === null) return '<h2>Konto</h2><p class="muted">Suche den Server …</p>';
  if (!c.available) {
    return `<h2>Konto</h2>
      <p>Online-Funktionen gibt es nur, wenn das Spiel von deinem Server geladen wird.
      Hier läuft es ohne Server: Der Spielstand bleibt in diesem Browser.</p>
      <p class="muted small">Anleitung zur Einrichtung: <b>docs/SERVER.md</b> im Repository.</p>`;
  }
  const msg = c.msg ? `<p class="small">${esc(c.msg)}</p>` : '';
  if (!c.name) {
    return `<h2>Konto</h2>
      <p class="muted small">Mit einem Konto wird dein Spielstand auf dem Server gesichert, und du spielst auf jedem Gerät weiter.</p>
      <form id="account-form" class="card form" autocomplete="on">
        <label for="acc-name">Name</label>
        <input id="acc-name" name="username" autocomplete="username" minlength="3" maxlength="20" required>
        <label for="acc-pass">Passwort (mindestens 8 Zeichen)</label>
        <input id="acc-pass" name="password" type="password" autocomplete="current-password" minlength="8" required>
        <div class="row">
          <button class="btn primary" type="submit" value="login" ${c.busy ? 'disabled' : ''}>Anmelden</button>
          <button class="btn" type="submit" value="register" ${c.busy ? 'disabled' : ''}>Neues Konto</button>
        </div>
      </form>${msg}`;
  }
  const choice = c.choice
    ? `<div class="card warn-card"><b>Zwei verschiedene Spielstände</b>
        <p class="small">Auf dem Server liegt ein Spielstand vom ${clock(c.choice.savedAt)}, der nicht von diesem Gerät stammt.
        Welcher soll weitergelten? Der andere wird überschrieben.</p>
        <div class="row">${btn('cloudTake', 'Server-Stand laden', { arg: 'server', kind: 'primary', disabled: c.busy })}
        ${btn('cloudTake', 'Diesen Stand behalten', { arg: 'local', disabled: c.busy })}</div></div>`
    : '';
  return `<h2>Konto</h2>
    <div class="card">Angemeldet als <b>${esc(c.name)}</b>
      <div class="muted small">${c.lastSync ? `Zuletzt gesichert: ${clock(c.lastSync)}` : 'Noch nicht gesichert.'} Automatische Sicherung jede Minute.</div></div>
    ${choice}
    <div class="row">${btn('cloudSave', 'Jetzt sichern', { disabled: c.busy || !!c.choice })} ${btn('cloudLogout', 'Abmelden', { kind: 'ghost', disabled: c.busy })}</div>
    ${msg}`;
}

function logPanel(s: GameState, ui: UIState): string {
  return `<h2>Logbuch</h2>${s.log.map((e) => `<div class="log"><span class="muted small">${fmtTime(e.t)}</span> ${esc(e.msg)}</div>`).join('')}
    <h3>Spielstand</h3><p class="muted small">Wird automatisch im Browser gespeichert. Der Heimat-Sektor arbeitet offline weiter (bis 8 h), laufende Expeditionen pausieren.</p>
    ${ui.confirmReset
      ? `<div class="card"><b>Wirklich neu beginnen?</b><div class="muted small">Der aktuelle Spielstand geht verloren.</div><div class="row">${btn('resetYes', 'Ja, neues Spiel', { kind: 'danger' })} ${btn('resetNo', 'Abbrechen', { kind: 'ghost' })}</div></div>`
      : btn('reset', 'Neues Spiel', { kind: 'danger' })}`;
}
