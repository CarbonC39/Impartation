# Hosting Guide: Spaces and Maps

This guide covers runtime limits, custom map deployment, and update checks. See the [README](../README.md#configuration-and-deployment) for installation and production identity setup, and [Tiled map authoring](tiled.en.md) for map creation.

## Runtime and persistent data

The current deployment uses one backend process and local SQLite. Each Space has at most one Colyseus room; additional backend replicas do not share rooms, queues, or interaction state.

| Data | Docker default location | Requirement |
| --- | --- | --- |
| SQLite database | `/app/data/world.sqlite` | Persist and regularly back up `/app/data` |
| Map registry and referenced files | `/app/assets/maps/` | Use bundled assets or mount the full map directory and set `MAP_REGISTRY_PATH` |
| Frontend files | `/app/apps/frontend/dist` | Included in the image; covers must be served by this static site |
| External tool content | Each tool's own storage | Maintain each service separately |

Board posts are stored by `(Space ID, resourceId)`. Keep Space IDs unchanged to retain existing posts; changing an ID creates a new data scope and does not migrate posts. Players, timers, private areas, and furniture selection in a Space room are runtime state and are lost when the room is destroyed or the backend restarts.

## Configure Spaces and maps

`MAP_REGISTRY_PATH` points to the registry JSON file; in Docker, use the path inside the container. The registry has `maps` and an ordered `spaces` array, and may include `project` pointing to a Tiled project file.

| Field | Description |
| --- | --- |
| `maps[].id` | Map ID, unique within the registry |
| `maps[].file` | Tiled JSON file path relative to the registry file |
| `maps[].defaultSpawn` | Name of an existing spawn in that map |
| `spaces[].id` | Stable Space ID matching `/^[a-z0-9][a-z0-9_-]*$/` |
| `spaces[].name`, `description` | Name shown on the start page and optional description |
| `spaces[].cover` | Public static image URL; not published by the map API |
| `spaces[].initialMap` | Initial map for the Space; must be listed in `maps` |
| `spaces[].maps` | Map IDs available in the Space |

The order of `spaces` determines the start-page order. Multiple Spaces can reference one map, but their runtime state remains separate. Every Portal destination must be available in that Space's map list.

When adding a map, deploy the `.tmj`, referenced tilesets, and images with their relative directory structure intact, then register the map and add it to the target Space. Also deploy referenced files for JSON Object Templates or `.tiled-project`. Restart the backend after changing the registry, map, or tileset.

Space and map IDs are stable identifiers; change display names without changing IDs. Covers are frontend static resources: for example, `/space-covers/main.png` maps to `space-covers/main.png` in the frontend directory. Updating the backend map directory does not update frontend covers.

## Compose example

Copy the Compose environment file and validate the configuration:

```sh
cp compose.env.example compose.env
# Set VW_ORIGIN, IDENTITY_SECRET, and the registration policy
docker compose --env-file compose.env -f compose.example.yml config --quiet
docker compose --env-file compose.env -f compose.example.yml up -d
```

By default, only Impartation starts and listens on host `127.0.0.1:2567`. Configure an HTTPS reverse proxy for remote access, or enable the commented Caddy service. `compose.env` supplies Compose variable interpolation; only values mapped under `environment` in `compose.example.yml` reach the container. Recreate containers after changing environment variables; a restart alone does not reload the environment file.

The Compose file also has optional commented coturn, WBO, Etherpad, and Neko services. To enable external tools, configure browser-reachable `EXTERNAL_TOOLS` URLs and any required access controls; see [external tool configuration](external-tools.en.md). The shared Neko browser does not synchronize YouTube/Bilibili playback.

## Mount custom maps

The following example copies repository maps to a deployment directory. Replace the maps, registry, and cover for your deployment:

```sh
mkdir -p hosting/world/maps hosting/covers
cp assets/maps/lobby.tmj assets/maps/interaction-lab.tmj assets/maps/tiles.png hosting/world/maps/
cp assets/maps/tiles.png hosting/covers/main.png
```

Register the maps and Space in `hosting/world/registry.json`, for example:

```json
{
  "maps": [
    { "id": "lobby", "file": "maps/lobby.tmj", "defaultSpawn": "default" },
    { "id": "interaction-lab", "file": "maps/interaction-lab.tmj", "defaultSpawn": "arrival" }
  ],
  "spaces": [
    {
      "id": "main",
      "name": "Main Hall",
      "cover": "/space-covers/main.png",
      "initialMap": "lobby",
      "maps": ["lobby", "interaction-lab"]
    }
  ]
}
```

Mount the map directory and cover into the image, and set the registry path:

```sh
docker run -d --name impartation --restart unless-stopped \\
  -p 127.0.0.1:2567:2567 \\
  -v impartation-data:/app/data \\
  --mount "type=bind,src=${PWD}/hosting/world,dst=/app/world,readonly" \\
  --mount "type=bind,src=${PWD}/hosting/covers,dst=/app/apps/frontend/dist/space-covers,readonly" \\
  --env-file .env.production \\
  -e MAP_REGISTRY_PATH=/app/world/registry.json \\
  ghcr.io/carbonc39/virtualworkspace:latest
```

`.env.production` must at least set `IDENTITY_SECRET`, `IDENTITY_BASE_URL`, and `IDENTITY_TRUSTED_ORIGINS`. The image's `node` user must be able to read mounted maps and covers; the database volume must be writable. Do not mount over the entire `dist` directory, or the frontend files will be hidden.

## Updates and acceptance

- Back up SQLite and the current registry/map files before upgrading. If a rollback follows a database format change, restore the database backup too.
- Maps and the registry load at startup; there is no hot reload. Restart the backend and refresh the browser after replacing maps. Map-only changes do not require rebuilding the frontend.
- Re-run `up -d` after changing the Compose environment or image version, and retain the existing database volume.

Check the service and example map resources after deployment:

```sh
docker logs --tail 100 impartation
curl -fsS http://127.0.0.1:2567/health
curl -fsS http://127.0.0.1:2567/api/world
curl -fsS http://127.0.0.1:2567/api/maps/lobby/map.json
```

Then use a browser to check the Space list, cover, spawn, collision, interactions, and Portal. `/health` checks only the database connection; a successful startup does not guarantee images or covers are reachable.

| Problem | Check |
| --- | --- |
| `ENOENT` or registry parse error | `MAP_REGISTRY_PATH`, mount paths, and file permissions |
| Invalid Portal destination | Space map list, destination map ID, and spawn name |
| Map image 404 | Relative `.tmj`/`.tsj` paths, case sensitivity, and mounted files |
| Cover 404 | Frontend static directory; covers are not published by the map API |
| Old map still appears | Backend restart, browser refresh, and the actual map directory read by the backend |
| Old posts missing | Whether the Space ID changed; separate Spaces do not share posts |
