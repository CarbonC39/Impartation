# External Tool Entry Configuration

This document explains how a map `web` interaction's `resourceId` maps to a webpage. The project does not install or manage external services; see [interactions and external services](integrations.en.md) for deployment and permission boundaries.

## Configure entries

Set `EXTERNAL_TOOLS` in the project runtime environment. For local development, set it in the root `.env`. In the Compose example, enable and edit `EXTERNAL_TOOLS` under the service's environment in `compose.example.yml`; `compose.env` only supplies variable interpolation to Compose and is not automatically passed into the container. Each configuration key must match a `resourceId` used by a map `web` interaction.

```dotenv
EXTERNAL_TOOLS='{"shared-canvas":{"url":"https://board.example.com/boards/workspace"},"shared-document":{"url":"https://docs.example.com/p/workspace","mode":"embed","manualExternalOpen":true}}'
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | HTTP(S) URL | Required | Target opened in the browser; must not contain a username or password |
| `mode` | `external` / `embed` | `external` | Open a new tab or embed in the project window |
| `manualExternalOpen` | boolean | `false` | In embed mode, also show a manual link to open a new tab |
| `allowSameOrigin` | boolean | `false` | Add `allow-same-origin` permission to the embedded iframe |

Example:

```dotenv
EXTERNAL_TOOLS='{"shared-drawing":{"url":"https://draw.example.com/"}}'
```

Restart the backend after changing the configuration. At startup, the server parses it and checks that each entry matches at least one `web` area. If a resource ID is reused in maps, all matching areas must be of type `web`.

## Opening behavior

- `external` opens the URL in a new tab after the player clicks the entry, with `noopener noreferrer`.
- `embed` creates a sandboxed iframe only after the player clicks the entry. The iframe is removed when the player leaves the area, disconnects, or closes the window. Default sandbox permissions are `allow-scripts allow-forms allow-popups`; the referrer policy is `no-referrer`.
- `manualExternalOpen: true` only provides an extra link. It does not detect iframe load failures or automatically switch to a new tab.
- `allowSameOrigin: true` applies only to `embed`. Enable it only for trusted self-hosted services; combined with scripts, it weakens iframe isolation.

Prefer `external` by default. Before enabling `embed`, verify in the target browser that the service permits embedding and its login method works. Use `external` for services that cannot be embedded.

## Access control

`GET /api/tools` publicly returns configured `resourceId`, URL, and display options so the browser can match entries to map areas. URLs are therefore visible to all visitors. Do not put tokens, passwords, project user IDs, admin roles, or private invitation credentials in them.

Entering a `web` area only controls when the entry is shown; it does not authorize access to the external service. The project does not pass account identity, proxy tool requests, or provide an iframe `postMessage` bridge. The external service and its reverse proxy are responsible for authenticating users and controlling content access. On a phone, `localhost` refers to the phone itself; Docker service names are usually not reachable by the browser either.

## Included examples

The Compose file contains commented optional WBO whiteboard and Etherpad services and proxy routes. After enabling them, configure their URLs in `EXTERNAL_TOOLS` and set proxy access controls as needed. The Compose example does not guarantee that the services are running or have passed browser acceptance. Other collaborative drawing and synchronized viewing services must be deployed separately.
