# Virtual Workspace

[English](README.md) | [简体中文](README.zh-CN.md)

A 2D multiplayer space built with Phaser 4, Colyseus, and Tiled. Choose a character, move around, interact with others, use tools, and chat. The character editor previews and saves layered sprite sheets (body, face, hair, top, bottom, shoes, accessories), each with a validated asset ID and editable RGB color. All layers share one animation frame and foot anchor in the map.

Tiled JSON is the source of map geometry and interaction semantics. The server registry can list multiple finite orthogonal maps with 16×16 tiles. Portals move players between maps and named spawn points within the same room.

External tools use the `web` interaction type. Their `resourceId` selects a page configured in `EXTERNAL_TOOLS`; entering a web zone shows a small hint above the zone, and clicking it launches a new tab (`external`) or opens a sandboxed iframe in a centered, draggable TV-style window (`embed`). External services keep their own accounts and permissions. Formal sign-up and login, account recovery, and private rooms are not implemented yet.

## Run locally

Requires Node.js 24 or later and npm.

```sh
cp .env.example .env
npm ci
npm run dev
```

Open <http://localhost:5173>, pick a world on the start screen, dress the character in the wardrobe, then enter the space. Every wardrobe item is previewed on your current outfit; each layer offers preset candy colors plus a free color picker whose dashed top-left box marks the soft color range (an optional lock keeps picks inside it). The mirror can turn the character and preview the sitting pose; outfits can be randomized from the presets, undone, and saved into three named outfit slots kept in this browser (saving also updates the persistent profile). The interface theme (six presets or a custom theme built from four colors) is chosen from the top-right button on the start and wardrobe screens and stored per browser. Put PNG assets in `assets/characters/{body,face,hair,top,bottom,shoes,accessories}/`; the shared build generates category IDs and paths from these folders. Tops, bottoms, shoes, and accessories support a `none` choice. There is no account or password: the start screen uses the persistent anonymous identity and offers one-time binding codes for other devices. The world selection screen is a frontend prototype; the world name only changes the UI label, and the backend uses its map registry.

Move with WASD, the arrow keys, or the on-screen direction pad. On touch screens, hold or slide a finger across the pad (diagonals included); drag its centre grip to move the pad. Tap or hold the grip for a hint; double-tap it (or use Settings → Adjust control layout) to open the layout editor, where you can resize the pad and drag the pad and the action buttons anywhere, or reset them. Layout is stored per browser. Nicknames are drawn under the characters' feet and stay unchanged while sitting; Settings can hide nicknames and switch the chat background between transparent, half-transparent (default) and solid. These display choices are stored per browser. The action list shows the character actions defined in the shared catalog (`CHARACTER_ACTIONS`, currently **Sit**); the server rejects any other action name. Click an action to perform it, or press E to perform the action of the anchor under the character (otherwise the last chosen action); the animation option applies to actions with animated frames. Movement cancels the current action. Press Enter on the map to open the chat line; while it has focus every key edits text (arrow keys move the caret). Enter sends and returns the keyboard to the map so you can keep walking; Esc or Tab leaves without sending and keeps the draft. Other text fields also pause keyboard movement. The chat box can be dragged by its heading and resized from its top-right corner; double-click the heading or use settings to reset it. The server validates action requests and resolves anchors from the player's authoritative position.

Chat messages appear in a translucent, collapsible panel and as short-lived speech bubbles above the speaker. While the panel is collapsed, an unread count is shown. While someone has text in the chat box, others see animated typing dots over their character; turn off Settings → "Let others see I'm typing" to stop sending this hint. Nicknames, bubbles, typing dots and the speaking microphone are drawn on the map canvas in the same frame as the characters, so they never lag behind while walking.

Before entering a world, a pre-join check lets you choose whether to join with the microphone on, which microphone to use (with a live level meter), and whether to start muted; nothing is captured unless you turn the microphone on, and the choices are stored per browser. In the map, the microphone button at the top right turns your mic on or off (the first click starts proximity voice; turning the mic off keeps you connected so you can still listen), and the speaker button silences or restores all incoming voice (stored per browser). Settings → Nearby voice switches microphones (live peers get the new track without reconnecting) or disconnects voice and releases the microphone. A small microphone badge appears over a character while this browser hears them talking (and over your own character while you talk unmuted); speaking is detected locally from the audio levels, so nothing extra is sent to the server. It uses peer-to-peer WebRTC audio. The browser scans the existing player state, while the server authorizes signaling pairs against connected players, authoritative positions, and map IDs. The server supplies ICE server configuration through `GET /api/voice-config`; the default connect radius is 160 map pixels, disconnect radius is 192 pixels, and each client is limited to 6 peers. The gap between radii prevents repeated connect/disconnect at the boundary. Voice requires microphone permission and a secure browser context (HTTPS, or localhost). ICE configuration is sent to browsers, so do not expose long-lived TURN credentials; use short-lived credentials from your TURN provider when relaying is needed. The project does not run an SFU or provide TURN service.

Camera zoom is controlled by `VITE_CAMERA_ZOOM`, which defaults to `2` and accepts any finite positive number independently of tile size. Restart Vite after changing `.env`. Action anchors define character position, action, and optional facing; they do not draw furniture. Map authors can place furniture separately on Tiled visual layers. Character sheets use 16×24 frames in four columns and eight rows. The first four rows are down/left/right/up walking poses; the next four are action poses. The first column is static and columns 2–4 animate. Every layer must keep the same layout and foot anchor; asset IDs in `appearance` are resolved by the frontend character asset manifest.

The backend health check is at <http://localhost:2567/health>. The development server proxies `/api`, `/health`, Colyseus matchmaking, and WebSocket traffic.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Strict type checking, Node tests, and production builds |
| `npm run test:e2e` | Chromium browser tests; starts development services automatically |
| `npm run check:all` | Runs both checks above |
| `npm run build` | Builds shared, backend, and frontend workspaces |
| `npm start` | Starts the built backend; host the frontend separately |
| `npm run identity -- list` | Lists local identity profiles |
| `npm run identity -- role USER_ID admin` | Grants project administrator role |
| `npm run identity -- role USER_ID member` | Removes project administrator role |

Before the first browser test run, install Chromium with `npx playwright install chromium`. See [testing](docs/testing.md) for coverage, isolation, and NixOS setup.

## Configuration and deployment

The root [`.env.example`](.env.example) contains configuration examples. The backend and Vite both read the root `.env`; restart services after changing it. `MAP_REGISTRY_PATH` defaults to `assets/maps/registry.json`, and map files are resolved relative to the registry. See [Tiled maps](docs/tiled.md) for the map contract and rendering limits.

In production, set a random `IDENTITY_SECRET` of at least 32 characters, the public site URL in `IDENTITY_BASE_URL`, and the deployed frontend origins in `IDENTITY_TRUSTED_ORIGINS`. For a separate frontend host, use a same-origin reverse proxy for `/api`, `/matchmake`, and the Colyseus WebSocket. The Docker image below serves both frontend and backend on one port. `VITE_SERVER_URL` only controls the Colyseus connection; identity, map, and tool configuration APIs always use same-origin `/api`.

The [GitHub Actions workflow](.github/workflows/build-release.yml) runs `npm run check` on every push. Successful pushes to `main` create a commit-tagged GitHub Release marked **Latest** with `virtual-workspace.tar.gz`, and publish `ghcr.io/carbonc39/virtualworkspace:latest` plus a `sha-<commit>` tag for `linux/amd64` and `linux/arm64`. The archive contains compiled code and assets; extract it, run `npm ci --omit=dev`, configure production environment variables, set `FRONTEND_DIST_PATH` to the extracted `apps/frontend/dist`, then run `npm start`. GitHub Actions needs repository permissions to write releases and GHCR packages; a private package also needs pull access on the deployment host.

The Docker image serves the frontend, API, and WebSocket on port `2567`. For example, after configuring HTTPS on your own reverse proxy, run it with a persistent SQLite volume:

```sh
docker run -d --name virtual-workspace --restart unless-stopped \
  -p 127.0.0.1:2567:2567 -v virtual-workspace-data:/app/data \
  --env-file .env.production \
  ghcr.io/carbonc39/virtualworkspace:latest
```

Create `.env.production` with `IDENTITY_SECRET`, `IDENTITY_BASE_URL`, and `IDENTITY_TRUSTED_ORIGINS` as described above. Use the actual public HTTPS origin for both URL variables and keep the secret stable across container replacements. The image includes the repository maps and sprites; external tools still run as separate services.

Deploy SQLite with a single backend instance. The default database is `data/world.sqlite`; persist and back it up. HTTP Basic Auth, if needed, is provided by the deployer's proxy.

Use `EXTERNAL_TOOLS` to map Tiled `resourceId` values to `{ url, mode?, manualExternalOpen?, allowSameOrigin? }`. `url` is required; `mode` defaults to `external`. An embed opens only after a click and closes on zone exit. `manualExternalOpen: true` adds a separate manual link beside an open iframe; it does not detect load failures. `allowSameOrigin` defaults to false and should be enabled only for trusted self-hosted tools. Legacy `fallback: "external"` remains accepted as a manual-link alias. The project does not start Docker containers, so deploy and validate tool services separately. `GET /api/world` publishes the map directory; the server also provides normalized Tiled JSON and explicitly referenced map assets.

Proximity voice settings are in `.env.example`: `VOICE_ICE_SERVERS` is a JSON array of WebRTC ICE server entries (by default one public STUN server), `VOICE_CONNECT_RADIUS` defaults to `160`, `VOICE_DISCONNECT_RADIUS` to `192`, `VOICE_MAX_PEERS` to `6`, and `VOICE_SCAN_INTERVAL_MS` to `1000`. The backend publishes the ICE list through `GET /api/voice-config`; restart it after changing these values. A STUN server can help peers discover direct paths; configure TURN when users behind restrictive networks need relaying. TURN credentials included in this public browser configuration are visible to clients. Rotate static credentials by updating the environment and restarting the backend; this version does not mint TURN credentials.

If voice reports a missing browser API on `http://127.0.0.1:5173/`, run `({ secure: isSecureContext, mic: !!navigator.mediaDevices?.getUserMedia, rtc: !!window.RTCPeerConnection })` in that page's browser console. All three values should be `true`; a missing API needs a browser or embedded-preview setting change. Use HTTPS when opening the site from another device.

## Documentation

| Document | Contents |
| --- | --- |
| [Architecture](docs/architecture.md) | Modules, state ownership, and feature boundaries |
| [Identity and permissions](docs/account-system.md) | Device linking, identity APIs, administrator CLI, and migrations |
| [Tiled maps](docs/tiled.md) | Map authoring, collisions, interaction zones, and validation |
| [External tool configuration](docs/integration-plan.md) | URL configuration, public APIs, and launch behavior |
| [Integrations](docs/integrations.md) | Built-in tools, external services, and permissions |
| [Testing](docs/testing.md) | Commands, coverage, and known gaps |
| [Roadmap](docs/roadmap.md) | Features not implemented yet |
| [Contributor instructions](AGENTS.md) | Implementation, verification, and commit conventions |
