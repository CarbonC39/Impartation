# Testing

## Run checks

After installing dependencies, run the checks you need:

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

| Command | Coverage |
| --- | --- |
| `npm test` | Node tests for protocol, storage, configuration, HTTP, and WebSocket behavior |
| `npm run typecheck` | Strict type checking for workspaces and E2E code |
| `npm run check` | Type checking, Node tests, and production builds |
| `npm run test:e2e` | Chromium browser tests against a production build |
| `npm run check:all` | Runs `check`, then browser tests |

Playwright starts isolated services and a temporary map registry on ports 5174/2569. It does not reuse development services on 5173/2567. If Linux system dependencies are missing, install those listed by Playwright; alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. NixOS example:

```sh
nix-shell -p chromium --run 'PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)" npm run check:all'
```

## Coverage

Node tests cover shared protocol and input validation, Tiled parsing and map rules, authoritative movement and interaction permissions, account and admin actions, SQLite migrations, Space/Portal isolation, WebRTC signaling, and tool configuration.

Browser tests cover account flows, map and character rendering, movement and actions, chat and built-in interactions, Space navigation, reconnects, external tool entries, and proximity voice. Tests use temporary databases and maps and do not modify product maps. Test files are in `apps/backend/test/` and `apps/frontend/e2e/`.

Automated checks are not acceptance testing in the target environment. Real external service login, drawing, collaboration persistence, and YouTube/Bilibili playback require separate verification. Browser tests currently cover Chromium only, not Firefox, WebKit, real touch devices, or poor-network stress.

## Known limits

- The character sprite atlas is 64×192 and includes walking and sitting poses; sitting is currently the only map action.
- Private areas filter chat and voice recipients, but position and typing indicators remain visible to members of the same Space; permanent ACLs are not implemented.
- External tool tests use page substitutes and do not verify real iframe embedding or access control in a target deployment.
- Voice automation uses a simulated microphone. Check real permission prompts, NAT traversal, audio quality, and browser/network combinations over HTTPS or localhost with the target STUN/TURN setup.
- GitHub Actions runs `npm run check` and publishes Releases and multi-architecture images; browser tests and target-host deployment are outside the workflow.
