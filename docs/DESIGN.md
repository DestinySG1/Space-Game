# Lumen Reach – Game Design (Prototyp 0.1)

Weltraum-Strategie mit zwei Ebenen: ein **Heimat-Sektor**, der dauerhaft (auch offline) wächst, und
**Expeditionen** von 15 Minuten, aus denen die seltene Ressource kommt, die den Fortschritt antreibt.

Alle Zahlen stehen in `src/game/config.ts`, alle Formeln in `src/game/economy.ts`.
Zum Balancen nur dort ändern und danach `npm run balance` laufen lassen.

## Kernkreislauf

```
 Kolonien ─┐
 Handel  ──┼─► Credits ──┐
 Abbau   ──┘   Erz ──────┼─► Ausbau · Schiffe · Sprungkerne · Baupläne
                         │                         │
                         │            Sprungkern ──▼
                         │                  Expedition (15 min)
                         │                         │
                         └──── Echo-Splitter ◄─────┘
                               (nur aus Expeditionen, gaten die Baupläne ab Stufe 2)
```

- **Credits** und **Erz** kommen aus dem Heimat-Sektor (passiv und mit Schiffen).
- **Wasserstoff (H₂)** ist Treibstoff: Schiffe verbrauchen ihn im Heimat-Sektor beim Fliegen,
  und jede Expedition kostet Sprungtreibstoff. Er kommt aus Raffinerien an Gasriesen.
- **Echo-Splitter** gibt es nur in Expeditionen. Sie sind der Engpass für Baupläne, also für stärkere
  Schiffe, also für höhere Expeditionsstufen. Das verbindet beide Ebenen.

## Heimat-Sektor

Karte mit Radius 8 Feldern (4× die Fläche des ersten Prototyps) mit Heimatbasis in der Mitte,
18 Planeten, 6 Handelsposten, 10 Asteroidengürteln und 4 Gasriesen. Die Lage wird aus einem Seed erzeugt.

**Erkundung:** Zu Beginn sind nur die Heimatbasis und ihre 6 Nachbarfelder sichtbar. In diesen inneren
Feldern liegen garantiert ein Garten- und ein Felsplanet, zwei Handelsposten, ein Asteroidengürtel und ein
Gasriese. Alles andere liegt unter schwarzem Nebel: Objekte darin sind unsichtbar, lassen sich nicht
kolonisieren und nicht als Pendelziel wählen. Ein Feld wird erforscht, sobald ein Schiff hineinfliegt
(das kostet Wasserstoff). Da die Startposten nah beieinander liegen, lohnt sich das Erkunden auch für
den Handel: weiter entfernte Posten bringen mehr Credits pro Ware. Die Anomalie der Expeditionen ist
nicht vernebelt.

**Freie Bewegung:** Schiffe fliegen auf direktem Weg an jeden Punkt der Karte und bleiben dort stehen.
Das Hex-Raster dient nur zur Orientierung und zum Platzieren von Planeten, Posten und Gürteln.
Ein Feld hat einen Radius von 6 Einheiten (benachbarte Feldmitten liegen ≈ 10,4 auseinander), Planeten
nur 0,8 und Schiffe etwa 0,45. Innerhalb eines Felds ist also viel Platz zum Manövrieren. Ein Schiff
gilt als „an“ einem Objekt, wenn es höchstens 1,8 Einheiten entfernt ist. Schiffe parken jeweils auf
einem eigenen Platz rund um ein Objekt. Fluggeschwindigkeit: 2 Einheiten/s im Heimat-Sektor,
3 Einheiten/s in Expeditionen (mal Schiffsfaktor).

| Element | Funktion | Formel |
|---|---|---|
| Planet (Garten) | Credits passiv | `0,5 × Stufe^1,15` pro s |
| Planet (Fels) | Erz passiv | `0,15 × Stufe^1,15` pro s |
| Kolonisieren | n-ter Planet | `250 × 1,45^n` Credits |
| Ausbau Stufe L → L+1 | | `180 × 1,75^(L−1)` Cr, `30 × 1,75^(L−1)` Erz |
| Handelsposten | erzeugt Waren | `0,12/s`, Lager max. 30 |
| Warenwert | pro Einheit beim Verkauf an anderem Posten | `(6 + 4 × Distanz) × Handelsnetz-Bonus` |
| Asteroidengürtel | Erz-Vorrat 400, wächst `0,3/s` nach | |
| Gasriese + Raffinerie | Wasserstoff passiv | `0,12 × Stufe^1,15` pro s |
| Raffinerie bauen | n-te Raffinerie | `300 × 1,6^n` Credits |
| Raffinerie Stufe L → L+1 | | `250 × 1,75^(L−1)` Cr, `40 × 1,75^(L−1)` Erz |

### Wasserstoff

- Start: 120 H₂. Die Heimatbasis liefert immer `0,02/s` (1,2 pro Minute), damit man nie ganz feststeckt.
- Verbrauch pro geflogener Einheit im Heimat-Sektor: Frachter und Schürfer 0,03, Wächter 0,05.
  Stehende Schiffe verbrauchen nichts. In Expeditionen gibt es keinen Flugverbrauch.
- Unter 1 H₂ gilt der Tank als leer: Alle Schiffe fliegen nur noch mit 25 % Tempo.
- Sprungtreibstoff: `15 × Stufe` pro Schiff beim Start einer Expedition.
- Gemessen: Mit den zwei Startschiffen reicht der Tank ca. 20 Minuten; eine Raffinerie (7,2/min)
  deckt danach den Verbrauch und erlaubt etwa eine Expedition alle 15 Minuten.

**Pendelrouten** automatisieren Schiffe: Frachter zwischen zwei Posten, Schürfer zwischen Gürtel und
Basis. Sie sind der Hauptgrund, warum der Sektor offline weiterarbeitet.

**Offline-Fortschritt:** beim Laden wird bis zu 8 h Heimat-Sektor nachsimuliert. Eine laufende
Expedition pausiert, solange das Spiel zu ist (Designentscheidung: niemand verliert Schiffe im Schlaf).

## Schiffe

| | Frachter | Schürfer | Wächter |
|---|---|---|---|
| Kosten | 400 Cr | 500 Cr, 50 Erz | 800 Cr, 120 Erz |
| Rumpf / Schild | 500 / 100 | 450 / 100 | 1500 / 500 |
| Schaden | – | – | 60/s |
| Ladung Heimat | 6 Waren | 60 Erz | – |
| Ladung Expedition | 40 Splitter | 20 Splitter | 4 Splitter |
| Abbau | – | 0,5 Erz/s · 0,08 Splitter/s | – |

Hangarplätze: `3 + Hangarstufe`. Ausbau `1200 × 2^Stufe` Cr und `200 × 2^Stufe` Erz.

## Module

Jedes Schiff hat Steckplätze, in die Module eingebaut werden (nur im Heimat-Sektor, jederzeit
umbaubar, kostenlos). Module kommen aus **Bauplänen**: Ein Bauplan wird entschlüsselt und dann bis Stufe 5
aufgewertet. Eingebaute Module werden mit jeder neuen Stufe automatisch stärker; ein Bauplan kann in
beliebig viele Schiffe eingebaut werden.

| Schiff | Plätze |
|---|---|
| Frachter | Handel, Schild |
| Schürfer | Abbau, Schild |
| Wächter | Waffe, Schild, Unterstützung |

Bauplan Stufe L → L+1 kostet `300 × 2^L` Credits, `60 × 2^L` Erz, Splitter `0` für Stufe 1, danach
`6 × 1,9^(L−1)`, Dauer `30 × 1,7^L` s.

| Platz | Modul | Wirkung |
|---|---|---|
| Waffe | Phasenlanze | +35 % Schaden pro Stufe auf ein Ziel |
| Waffe | Streukanone | bis zu 3 Ziele, je 50 % Schaden, +15 % pro Stufe |
| Schild | Deflektor | +40 % Schild pro Stufe |
| Schild | Regenerator | Schild lädt nach 1,5 s statt 4 s nach, +60 % Laderate pro Stufe |
| Schild | Verbundpanzerung | +25 % Rumpf pro Stufe |
| Unterstützung | Störimpuls (aktiv) | lähmt Gegner im Umkreis 6 für 3 s (+0,6 s pro Stufe), Abklingzeit 60 s |
| Unterstützung | Notsprung (aktiv) | sofort zum Sprungtor, Abklingzeit 150 s (−15 s pro Stufe, min. 30 s) |
| Unterstützung | Reparaturdrohne | repariert Schiffe im Umkreis 5 um 6 Rumpf/s pro Stufe |
| Unterstützung | Schubdüsen | +15 % Tempo pro Stufe |
| Handel | Frachtringe | +30 % Laderaum pro Stufe |
| Handel | Handelsrechner | +15 % Credits pro Ware pro Stufe |
| Abbau | Bohrlaser | +30 % Abbaurate (Erz und Splitter) pro Stufe |
| Abbau | Erzbunker | +35 % Laderaum des Schürfers pro Stufe |

Aktive Module werden in Expeditionen über einen Knopf im Schiffs- oder Expeditionspanel ausgelöst.
Spielstände der Version 4 werden übernommen: alte Forschungsstufen werden zu Bauplänen, und die Schiffe
bekommen passende Module eingebaut.

## Expeditionen

1. In der Schmiede einen **Sprungkern** der Stufe T herstellen: `500 × 1,7^(T−1)` Cr,
   `100 × 1,7^(T−1)` Erz.
2. Bis zu 4 Schiffe auswählen und springen. Die Schiffe fehlen solange im Heimat-Sektor.
3. Karte: Radius 8, Sprungtor in der Mitte, `16 + T` Splitter-Vorkommen mit je
   `10–18 × T^1,3 × Scanner` Splittern.
4. **Gegnerwellen** ab Sekunde 60, alle 55 s, vom Kartenrand.
   - Anzahl: `1 + ⌊Welle / 5⌋ + ⌊(T−1) / 2⌋`
   - Stärke: `(1 + 0,35 × (T−1)) × (1 + 0,5 × verstrichene Zeit / Dauer)`
   - Splitterling (220 HP, 10 Schaden/s, schnell); ab Welle 10 in ungeraden Wellen ein Koloss
     (1200 HP, 30 Schaden/s, langsam).
   - Eine Welle kommt gemeinsam von einer Seite. Gegner fliegen frei auf das nächste Schiff zu und
     feuern ab 3 Einheiten Abstand. **Wächter ziehen das Feuer auf sich**, wenn sie höchstens
     5 Einheiten weiter weg sind als das nächste Schiff. Wächter feuern bis 4 Einheiten.
5. Schürfer bauen an Vorkommen ab, ein Frachter in höchstens 2,5 Einheiten Abstand übernimmt die
   Splitter automatisch.
6. **Heimsprung** nur vom Sprungtor. Mitgebrachte Splitter werden gutgeschrieben.
7. Nach 15 Minuten kollabiert die Anomalie: Alle Schiffe, die noch drin sind, gehen **mit Ladung**
   verloren. Zerstörte Schiffe sind ebenfalls weg.
8. Wer auf Stufe T mindestens `25 × T` Splitter sichert, schaltet Stufe T+1 frei.

Die Spannung entsteht aus **Gier gegen Sicherheit**: Die Gegner werden mit der Zeit stärker, die
Ausbeute steigt aber mit jeder Minute.

### Gemessenes Balancing (`npm run balance`)

| Flotte | Ergebnis |
|---|---|
| T1 ohne Wächter | nach ca. 2 min verloren |
| T1, 1 Wächter + Schürfer + Frachter | sicher, ca. 57 Splitter |
| T2–T3, 1 Wächter | verloren nach ca. 10–12 min, früher gehen oder aufrüsten |
| T3, 2 Wächter, Module Stufe 2 (Lanze, Deflektor, Bohrlaser, Frachtringe) | sicher, ca. 84 Splitter |
| T5, 2 Wächter, Module Stufe 3 | meist sicher bei Rückkehr nach 12,5 min, ca. 96 Splitter |

Der Heimat-Bot (mit aufgedeckter Karte) erreicht die erste Expedition nach etwa 7 Minuten Spielzeit.

## Koop-Anomalien (mehrere Spieler)

Läuft das Spiel vom eigenen Server (siehe `docs/SERVER.md`) und ist man angemeldet, kann man im
Expeditions-Tab **„Koop: Mitspieler suchen“** wählen. Sprungkern und Sprungtreibstoff werden wie bei einer
Einzel-Expedition verbraucht; wer vor dem Start abbricht, bekommt beides zurück.

- **Warteschlange pro Stufe:** Ab 2 Spielern startet die Anomalie nach 5 s, mit 4 Spielern sofort,
  spätestens nach 20 s auch allein.
- **Ein gemeinsames System:** dieselben Vorkommen, dieselben Gegnerwellen, dieselbe Uhr. Jeder steuert nur
  seine eigenen Schiffe; fremde Schiffe tragen den Spielernamen. Jeder Spieler kommt auf seiner eigenen
  Seite des Tors an.
- **Skalierung:** `+5` Vorkommen und `+60 %` Gegner pro Welle für jeden weiteren Spieler.
- **Zusammenarbeit:** Wächter ziehen das Feuer auch von Schiffen der Mitspieler auf sich, Reparaturdrohnen
  reparieren alle Schiffe in der Nähe. Splitter-Übergabe nur zwischen Schiffen desselben Spielers.
- **Beute:** Was ein Schiff am Tor heimbringt, gehört seinem Besitzer. Freischalten der nächsten Stufe wie
  bei Einzel-Expeditionen anhand der eigenen gesicherten Splitter.
- **Technik:** Der Server rechnet die Anomalie (10 Schritte/s) und schickt 5 Stände/s per WebSocket; der
  Client bewegt die Schiffe dazwischen weiter. Schiffswerte berechnet der Server selbst aus Typ und
  Modulen (Stufen auf 5 begrenzt). Spieler, die kurz offline sind, bekommen Ergebnisse beim
  Wiederverbinden; Schiffe aus Anomalien, die der Server nicht mehr kennt (z. B. nach einem Neustart),
  kehren ohne Beute heim.
- Die Logik liegt in `src/game/anomaly.ts` und wird vom Server mitgebündelt.

## Nächste Ausbaustufen (Ideen)

- Mehr Gegnertypen, Gegner mit Fähigkeiten, Boss am Ende höherer Stufen
- Mehrere Sektoren / Sektorkarte, die sich mit der Zeit erweitert
- Gilden, Diplomatie, gemeinsame Ziele; Koop-Anomalien mit Freunden gezielt (Einladung statt Warteschlange)
- Handel mit Ladungsarten und schwankenden Preisen
- Tägliche Ereignisse, Erfolge, Tutorial
- Grafik: Sprites/Shader statt Canvas-Formen, Sound
