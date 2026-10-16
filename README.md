# Virtual Workspace

[English](README.md) | [简体中文](README.zh-CN.md)

A 2D multiplayer space built with Phaser 4, Colyseus, and Tiled. Choose a character, move around, interact with others, use tools, and chat. The character editor previews and saves six layered sprite sheets (body, face, hair, top, bottom, shoes), each with a validated asset ID and editable RGB color. All layers share one animation frame and foot anchor in the map.

Tiled JSON is the source of map geometry and interaction semantics. The server registry can list multiple finite orthogonal maps with 16×16 tiles. Portals move players between maps and named spawn points within the same room.

External tools use the `web` interaction type. Their `resourceId` selects a page configured in `EXTERNAL_TOOLS`; pages can open in a new tab (`external`) or in a sandboxed iframe (`embed`). External services keep their own accounts and permissions. Formal sign-up and login, account recovery, and private rooms are not implemented yet.

## Run locally

Requires Node.js 24 or later and npm.

```sh
cp .env.example .env
npm ci
npm run dev
```

Open <http://localhost:5173>, follow the entry flow, choose a nickname and customize the character, then enter the space. Appearance choices can be previewed, randomized, and saved to the persistent profile. The sign-in and world selection screens are frontend prototypes: the form does not authenticate with a password, and the world name only changes the UI label. The backend still uses persistent anonymous identity and its map registry.

Move with WASD, the arrow keys, or the on-screen direction pad. At an authored action anchor, press E or click **Sit** to sit; the animation option can be enabled as well. Movement cancels the current action, and typing pauses keyboard movement. The server validates action requests and resolves anchors from the player's authoritative position.

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

In production, set a random `IDENTITY_SECRET` of at least 32 characters, the public site URL in `IDENTITY_BASE_URL`, and the deployed frontend origins in `IDENTITY_TRUSTED_ORIGINS`. Host the frontend separately and use a same-origin reverse proxy for `/api`, `/matchmake`, and the Colyseus WebSocket. `VITE_SERVER_URL` only controls the Colyseus connection; identity, map, and tool configuration APIs always use same-origin `/api`.

Deploy SQLite with a single backend instance. The default database is `data/world.sqlite`; persist and back it up. HTTP Basic Auth, if needed, is provided by the deployer's proxy.

Use `EXTERNAL_TOOLS` to map Tiled `resourceId` values to `{ url, mode?, fallback? }`. `url` is required; `mode` can be `embed` or `external` and defaults to `external`. `fallback: "external"` adds a manual open link beside an embedded page; iframe load failures are not detected. The project does not start Docker containers, so deploy and validate tool services separately. `GET /api/world` publishes the map directory; the server also provides normalized Tiled JSON and explicitly referenced map assets.

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
