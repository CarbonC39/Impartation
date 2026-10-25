# Impartation

[English](README.md) | [简体中文](README.zh-CN.md)

A 2D multiplayer space built with Phaser 4, Colyseus, and Tiled. Create a character, explore maps with others, chat, use built-in interactions, and open external collaboration tools. The server manages accounts, world state, and map access.

## Run locally

Requires Node.js 24 or later and npm.

```sh
cp .env.example .env
npm ci
npm run dev
```

Open <http://localhost:5173>. Registration is open by default; configure `REGISTRATION_MODE=code` with `REGISTRATION_CODE`, or use `REGISTRATION_MODE=admin` to disable public registration. See [account and permission guide](docs/account-system.en.md) for production identity setup.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Type checks, Node tests, and production builds |
| `npm run test:e2e` | Chromium browser tests |
| `npm run check:all` | Runs both checks above |
| `npm run build` | Builds all workspaces |
| `npm start` | Starts the built backend |

Install Chromium before the first browser test run with `npx playwright install chromium`. See [testing](docs/testing.en.md) for test coverage and environment details.

## Configuration and deployment

Copy `.env.example` for local development. For deployment, set a random `IDENTITY_SECRET` of at least 32 characters, `IDENTITY_BASE_URL`, and `IDENTITY_TRUSTED_ORIGINS`. The project currently uses one backend instance and SQLite; persist and back up `data/world.sqlite`.

See the [hosting guide](docs/hosting.en.md) for Spaces, maps, Docker mounts, deployment, and rollback. The repository also includes a [Docker Compose example](compose.example.yml) and a [Docker image](https://github.com/carbonc39/impartation/pkgs/container/virtualworkspace).

Tiled JSON defines map geometry and interactions. See [map authoring](docs/tiled.en.md). The [interaction guide](docs/integrations.en.md) explains built-in features and external service boundaries; see [external tool configuration](docs/external-tools.en.md) to configure `EXTERNAL_TOOLS`.

## Documentation

| Document | Contents |
| --- | --- |
| [Hosting guide](docs/hosting.en.md) | Space setup, map deployment, Docker, updates, and troubleshooting |
| [Architecture](docs/architecture.en.md) | Modules, state ownership, and feature boundaries |
| [Accounts](docs/account-system.en.md) | Registration, sessions, saved outfits, and administrator actions |
| [Tiled maps](docs/tiled.en.md) | Map authoring and validation contract |
| [Integrations](docs/integrations.en.md) | Built-in interactions and external service boundaries |
| [Testing](docs/testing.en.md) | Commands, coverage, and known gaps |
