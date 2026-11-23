# Lumen Reach

Weltraum-Strategie im Browser: Baue deinen **Heimat-Sektor** aus (Kolonien, Handel, Bergbau) und
fliege **15-Minuten-Expeditionen** in Anomalien, um Echo-Splitter für Modul-Baupläne zu holen.

Prototyp 0.1 – TypeScript, Canvas, keine Laufzeit-Abhängigkeiten.

## Starten

```bash
npm install
npm run dev        # Entwicklungsserver mit Hot Reload
npm test           # Spiellogik-Tests
npm run build      # eine einzelne, eigenständige dist/index.html
npm run balance    # Balancing-Bots: Heimat-Fortschritt und Expeditions-Überleben
```

## Spielen

- Karte ziehen zum Verschieben, Mausrad / zwei Finger / Buttons +, −, ⌂ zum Zoomen.
- Schiff antippen, dann irgendeinen Punkt auf der Karte antippen: Das Schiff fliegt direkt dorthin
  und bleibt dort stehen.
- Frachter an einem Handelsposten → Pendelroute zu einem anderen Posten einrichten.
- Schürfer an einem Gürtel oder an der Basis → Pendelroute einrichten.
- Der schwarze Nebel ist unerforscht: Schiff hineinschicken, um das Feld aufzudecken.
- Planeten antippen → kolonisieren und ausbauen. Gasriesen antippen → Raffinerie für Wasserstoff
  (Treibstoff) bauen.
- *Werft*: Schiffe bauen, Hangar erweitern. *Module*: Baupläne entschlüsseln; eingebaut werden sie
  im Schiffspanel unter *Auswahl*. *Expedition*: Sprungkern
  schmieden, Flotte wählen, springen.
- Unten links: **Testtempo** 1× / 10× / 60× zum schnellen Ausprobieren.

## Aufbau

```
src/game/      reine Spiellogik, ohne DOM (testbar)
  config.ts    ALLE Balancing-Zahlen
  economy.ts   Formeln: Kosten, Produktion, Schiffswerte
  home.ts      Simulation Heimat-Sektor
  expedition.ts Simulation Expedition (Wellen, Kampf, Abbau, Heimsprung)
  actions.ts   alles, was der Spieler tun kann
  sim.ts       fester Zeitschritt, Speichern/Laden, Offline-Fortschritt
src/ui/        Canvas-Rendering (render.ts), Grafiken (sprites.ts), Kamera (camera.ts), Seitenpanel
tests/         Vitest
scripts/       Balancing-Bots
docs/DESIGN.md Spieldesign, Kreisläufe, Formeln, gemessenes Balancing
```

Neue Inhalte: Werte in `config.ts`, Regeln in `home.ts` / `expedition.ts`, Bedienung in
`actions.ts` + `ui/panel.ts`.
