# Lumen Reach auf dem eigenen Server

Der Server liefert das Spiel aus und speichert Konten und Spielstände. Er läuft als Docker-Container;
davor sitzt [Caddy](https://caddyserver.com/), der automatisch ein HTTPS-Zertifikat (Let's Encrypt)
für deine Domain holt und erneuert.

```
Browser ──HTTPS──► Caddy (Port 80/443) ──► app (Node.js, Port 8787) ──► SQLite-Datei im Volume
```

## Voraussetzungen

- Ein Linux-Root-Server (z. B. Debian oder Ubuntu) mit Docker und dem Compose-Plugin
- Eine (Sub-)Domain, deren DNS-Eintrag (A und ggf. AAAA) auf die IP des Servers zeigt
- Ports 80 und 443 frei und in der Firewall offen

Docker installieren (Debian/Ubuntu, offizielles Skript):

```bash
curl -fsSL https://get.docker.com | sh
```

## Erstinstallation

```bash
git clone https://github.com/DestinySG1/Space-Game.git
```

```bash
cd Space-Game
```

```bash
cp .env.example .env
```

In `.env` die eigene Domain eintragen, z. B. `DOMAIN=spiel.meine-domain.de`. Dann starten:

```bash
docker compose up -d --build
```

Nach etwa einer Minute ist das Spiel unter `https://<deine Domain>` erreichbar. Im Tab **Konto**
kann man sich registrieren; der Spielstand wird dann jede Minute und beim Schließen gesichert.

## Updates

```bash
git pull
```

```bash
docker compose up -d --build
```

Die Datenbank liegt im Docker-Volume `lumen-data` und bleibt bei Updates erhalten.

## Sicherung

Die gesamte Datenbank ist eine Datei. Sicherung in das aktuelle Verzeichnis:

```bash
docker compose exec app node -e "new (require('node:sqlite').DatabaseSync)('/data/lumen.db').exec(\"VACUUM INTO '/data/backup.db'\")"
```

```bash
docker compose cp app:/data/backup.db ./lumen-backup-$(date +%F).db
```

## Wenn schon ein Webserver läuft (nginx, Apache, …)

Dann den `caddy`-Dienst in `docker-compose.yml` weglassen, beim `app`-Dienst statt `expose` den Port
nur lokal freigeben:

```yaml
    ports:
      - "127.0.0.1:8787:8787"
```

und im vorhandenen Webserver einen Reverse-Proxy auf `http://127.0.0.1:8787` einrichten, z. B. für nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

(Die letzten drei Zeilen braucht der Koop-Modus für WebSocket-Verbindungen.)

## Lokal entwickeln

```bash
cd server && npm install && npm run dev
```

In einem zweiten Terminal im Hauptordner:

```bash
npm run dev
```

Vite leitet `/api` an den lokalen Server auf Port 8787 weiter.

## Sicherheit

- Passwörter werden mit scrypt gehasht, Sitzungs-Tokens nur als SHA-256-Hash gespeichert.
- Nach 10 falschen Anmeldungen pro Name und IP ist 15 Minuten Pause.
- Sitzungen laufen nach 90 Tagen ohne Nutzung ab.
- Spielstände sind auf 1,5 MB begrenzt.
