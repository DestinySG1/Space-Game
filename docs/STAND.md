# Stand & nächste Schritte

Übergabe-Notiz zum Weitermachen (Stand: 23.11.2026).

## Was fertig ist

- **Heimat-Sektor:** Radius 8, Felder 6× so groß wie Schiffe (freie Bewegung), schwarzer Nebel mit
  Erkundung (nur die inneren 7 Felder sind am Anfang sichtbar), Kolonien, Handel, Bergbau, Gasriesen mit
  Raffinerien, Wasserstoff als Treibstoff, Offline-Fortschritt bis 8 h.
- **Schiffe & Module:** Frachter, Schürfer, Wächter; 13 Module in Steckplätzen, Baupläne aus Splittern,
  zwei aktive Fähigkeiten (Störimpuls, Notsprung).
- **Expeditionen (allein):** 15 Minuten, Gegnerwellen, Kristallvorkommen, Heimsprung am Tor.
- **Server (`server/`):** Konten, Cloud-Spielstand, **Koop-Anomalien** für bis zu 4 Spieler über WebSocket.
- **Betrieb:** Docker Compose + Caddy (HTTPS), Anleitung in `docs/SERVER.md`.
- **Tests:** 34 Spiellogik (`npm test`), 10 Server (`cd server && npm test`), Balancing-Bots (`npm run balance`).
- **Spielbare Offline-Version:** https://claude.ai/artifact/QqeqCX2FM3Rwo6kxVkiMU6 (ohne Konto/Koop).

## Zu Hause als Erstes

1. Repo holen: `git clone https://github.com/DestinySG1/Space-Game.git`
2. Lokal ausprobieren: `npm install && npm run dev` (Spiel) und in einem zweiten Terminal
   `cd server && npm install && npm run dev` (Server). Dann http://localhost:5173 öffnen.
3. Auf den Root-Server bringen: Schritte in `docs/SERVER.md` (Domain in `.env`, `docker compose up -d --build`).
   Das Docker-Image wurde noch nie wirklich gebaut (in der Cloud-Sitzung lief kein Docker-Dienst) –
   beim ersten Build auf Fehlermeldungen achten.

## Offene Punkte / Ideen

- **Koop:** Freunde gezielt einladen (statt Warteschlange), Chat/Pings auf der Karte, Koop-Anomalien
  mit Bossgegner am Ende höherer Stufen.
- **Sicherheit gegen Mogeln:** Spielstand liegt im Browser; Belohnungen aus Koop werden dort gutgeschrieben.
  Für echten Mehrspieler-Wettbewerb müsste der Spielstand auf den Server.
- **Server-Neustart:** laufende Koop-Anomalien gehen verloren (Schiffe kommen ohne Beute heim).
- **Nebel** auch in Anomalien? (bisher nur im Heimat-Sektor)
- Einzel-Expeditionen intern auf die Koop-Engine (`src/game/anomaly.ts`) umstellen, damit es nur noch
  eine Anomalie-Logik gibt.
- Tutorial, Sound, schönere Grafik.
