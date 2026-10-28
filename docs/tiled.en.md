# Tiled Map Authoring

This guide is for map authors. It describes the map layers and interaction objects read by this project. See the [hosting guide](hosting.en.md) for Spaces, map mounts, and cover deployment. For native Tiled object fields, see the official [Working with Objects](https://doc.mapeditor.org/en/stable/manual/objects/) and [JSON Map Format](https://doc.mapeditor.org/en/stable/reference/json-map-format/) references. This project supports only the subset listed here.

## Map requirements

Maps must be finite, orthogonal, use 16×16 pixel tiles, and be saved as Tiled JSON (`.tmj`). The map registry assigns each map an ID, file, and default spawn, and assigns each Space an initial map and its available maps. A map ID may differ from its filename.

Each map must have exactly these three object layers. They may be nested in Tiled groups:

| Layer | Contents |
| --- | --- |
| `spawns` | Named point objects used for map entry and Portal destinations |
| `collisions` | Rectangles or simple polygons that block character movement |
| `interactions` | Action anchors and interaction areas |

Example registry:

```json
{
  "maps": [
    { "id": "lobby", "file": "lobby.tmj", "defaultSpawn": "default" }
  ],
  "spaces": [
    {
      "id": "main",
      "name": "Main Hall",
      "cover": "/covers/main.png",
      "initialMap": "lobby",
      "maps": ["lobby"]
    }
  ]
}
```

Spawn names must be unique within a map and match the registry's `defaultSpawn`. A spawn must be in a passable area. Ground tiles do not create collision automatically; draw walls and obstacles separately in `collisions`.

Semantic objects in this project support only unrotated points, rectangles, and simple polygons. Polygons need at least three points and must not self-intersect. Private areas must not overlap. Draw decoration and furniture on tile layers instead of using semantic objects as map artwork.

## Interaction objects

Put interaction objects in the `interactions` layer and set their Tiled `class` to the interaction type. Legacy maps may use `type`. Every interaction object needs a non-empty name. `action`, `attachment`, `board`, `pomodoro`, `Portal`, and `web` use the name as their map-local ID, so these names must be unique. `variantSelector`, `privateArea`, and `wardrobe` use the numeric ID assigned by Tiled. Tiled object IDs must be unique within the map.

| Type | Shape | Required properties | Purpose |
| --- | --- | --- | --- |
| `action` | Point | string `action`, currently `sit` | Character action anchor |
| `variantSelector` | Point | string `action` (currently `sit`), numeric `targetObjectId`, comma-separated string `variants` | Select linked furniture tiles while sitting |
| `privateArea` | Rectangle or polygon | None | Temporarily invite members and restrict entry |
| `wardrobe` | Rectangle or polygon | None | Open the character wardrobe |
| `Portal` | Rectangle or polygon | string `targetMap`, string `targetSpawn` | Travel to another map in the same Space |
| `web` | Rectangle or polygon | non-empty string `resourceId` | Open an external webpage entry |
| `attachment` | Rectangle or polygon | string `mode`, string `attachmentIds` | Take a character attachment |

### Action anchors and furniture selection

An action anchor is an `action` point; currently only `sit` is supported. Optional `facing` can be `up`, `down`, `left`, or `right`. If the character is not facing the required direction, they still sit in place but do not align to or occupy the seat. `offsetX` and `offsetY` fine-tune the sitting position in map pixels.

```json
{
  "name": "window-seat",
  "class": "action",
  "x": 176,
  "y": 224,
  "point": true,
  "properties": [
    { "name": "action", "type": "string", "value": "sit" },
    { "name": "facing", "type": "string", "value": "down" }
  ]
}
```

To make furniture selectable, add a `variantSelector` point and use `targetObjectId` to reference a target rectangle or tile object outside the `interactions` layer. The target needs a numeric ID, positive width and height, and a unique ID; it does not need a name. On the target, integer properties named `variant.<option>` set the zero-based tile number in an atlas tileset; `-1` hides the target. The option names must match the comma-separated `variants`. On maps with multiple tilesets, also add a string `variantTileset` property to the target with the tileset name.

Each selector must have its own target object. Furniture backgrounds can remain on tile layers, but tiles that change must not also be drawn on a static layer. See the seat example in the repository maps.

### Private areas, wardrobes, and Portals

Private areas are open initially. Members inside can invite online players and lock or unlock entry. A member loses membership after leaving; re-entry after the area is locked requires a new invitation. Invitations for players who have not entered can remain for up to 60 seconds after the area becomes empty. Private areas do not replace walls or collision.

A `wardrobe` area opens the character appearance editor. Draw furniture separately on regular tile layers.

A Portal's `targetMap` must be available in the current Space, and `targetSpawn` must name a spawn in that map. If multiple Spaces share a map, every Portal on it must be valid for each Space.

### External tools

A `web` area maps its `resourceId` to a webpage URL in `EXTERNAL_TOOLS`. Entering the area only displays the entry; the player must click to open it. The external service manages its own login and permissions. See [external tool entry configuration](external-tools.en.md).

### Character attachments

An `attachment` area uses its name as the source ID. The `mode` and `attachmentIds` combinations are:

| `mode` | Number of attachment IDs | Behavior |
| --- | --- | --- |
| `single-unlimited` | One | Can be taken repeatedly |
| `single-unique` | One | Only one player can hold it from this map source at a time |
| `multiple-unlimited-random` | Two or more | Randomly selects one each time |

Attachments must use IDs registered by the project. For a tile that disappears when taken, use a native Tiled tile object:

1. Insert a tile on a decorative object layer such as `attachment-visuals`, then drag it into position.
2. Add an **object** property named `visualObjectId` to the attachment source area and select that tile object with Tiled's object picker.
3. Use an upright, unflipped 16×16 atlas tile. Positions need not align to the grid; group and object-layer offsets are supported. Each visual belongs to one source and cannot also be a variant target.

Do not also provide manual GID/X/Y properties or duplicate the visual on a static tile layer. Tiled supplies the global GID and bottom-left position; the project converts that position for rendering. Move the referenced tile object to reposition the source visual.

Legacy maps may continue using manual properties. To hide a map tile while a unique attachment is taken, set integer properties `visualGid`, `visualX`, and `visualY` on the source object and remove the corresponding tile from the static tile layer. X/Y are map pixel coordinates aligned to the 16-pixel grid; all three properties are required together. Coordinates identify the top-left corner starting at `(0, 0)`; column 6, row 4 is `(80, 48)`. `visualGid` is the map-global GID, calculated as `tileset.firstgid + Tiled local tile ID`, rather than the local ID. Each tileset has its own `firstgid`.

## Rendering and validation

Optional boolean tile-layer properties:

| Property | Effect |
| --- | --- |
| Neither | Ground behind players; ordinary layers retain Tiled order |
| `ySort = true` | Sort world-space horizontal band bottoms against player feet; preserve Tiled layer order within each band |
| `abovePlayers = true` | Always above players; do not also enable `ySort` |

Y-sorted content is drawn in world-space horizontal bands, each 16 pixels high. Tiles crossing a band boundary are cropped into separate fragments. Each band retains Tiled layer order, so shifted wall decorations cannot lose half their pixels behind an adjacent row from another layer. Positive, negative, fractional, and multi-tile X/Y offsets and nested group offsets are supported, along with tile flips, rotations, opacity, and animation. Tile-layer `x` and `y` use tile units; group `x` and `y` and all `offsetx` and `offsety` values use pixels. X does not contribute to Y depth.

A numeric `sortOffsetY` property (int or float, default `0`, in map pixels) deliberately changes depth: sorting Y = the world band's bottom Y + `sortOffsetY`. Positive values bring content forward; negative values move it backward, changing its overlap with other layers and players. Layer and group offsets need no reverse compensation. Multi-row objects still interleave with players by band, rather than sorting as a single object at a bottom anchor.

Layer names such as `top` and `y-sort` have no special meaning. These rendering groups take precedence over cross-group Tiled stacking. The `spawns` layer position does not define player depth. Body, clothing, hair, and attachments share a single depth so tiles cannot render between character parts.

The project supports atlas tilesets, regular tile layers, and grouped tile layers. External JSON tilesets (`.tsj`) can be used with a map. XML tilesets (`.tsx`), image-collection tilesets, image layers, and generic tile objects have no map rendering path. Use atlas tilesets and check map appearance and resource paths in the target browser.

At startup, the server checks map size and orientation, required object layers, spawns, interaction fields and geometry, furniture targets, and Portal destinations. Invalid configuration prevents startup. Restart the backend after changing map files; then check spawns, collision, interaction areas, and Portal destinations.
