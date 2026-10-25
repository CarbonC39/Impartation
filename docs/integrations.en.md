# Interactions and External Services

Map interactions fall into two groups: built-in interactions whose state and rules are managed by Impartation, and `web` interactions that open an external webpage managed by its own service. This document explains their responsibilities and data scope. See [Tiled map authoring](tiled.en.md) and [external tool configuration](external-tools.en.md).

## Built-in interactions

| Interaction | Map type | Purpose | State scope |
| --- | --- | --- | --- |
| Board | `board` | Post and delete messages in a map area | Stored by Space and `resourceId`; maps in a Space can share it |
| Shared Pomodoro | `pomodoro` | Shared 25-minute focus and 5-minute break timer | Shared by Space and `resourceId`; resets when the Space room is recreated |
| Portal | `Portal` | Move between maps in one Space | Server validates destination map, spawn, and private-area access |
| Private area | `privateArea` | Temporarily invite members and lock entry | Temporary within the Space room; not an account ACL |
| Wardrobe | `wardrobe` | Open the character appearance editor | Appearance is saved in the account profile |
| Action and furniture selector | `action`, `variantSelector` | Perform a character action or switch linked furniture tiles | Current action and selection belong to map state in the room |
| Attachment source | `attachment` | Let a character take an attachment from the map | Current attachment and unique-source occupancy belong to room state |

A board stores up to 100 posts per resource, each 1–500 characters. Authors can delete their own posts; admins can delete any post. The server derives the author from the account identity; clients cannot provide author information.

Logged-in members in the area control the Pomodoro timer: start, pause, resume, or reset. Starting the next round after completion is manual. Areas with the same resource ID in one Space share a timer; different Spaces are isolated. The timer resets when its room is destroyed or the server restarts.

Board and Pomodoro operations require a valid account connection and presence in the corresponding interaction area. The server validates identity, current position, and resource ID, and rate-limits consecutive operations. Other interaction types apply their own map-position and membership checks. See [account rules](account-system.en.md).

## External services

A map `web` interaction provides an external webpage entry. Each area maps its `resourceId` to a URL in `EXTERNAL_TOOLS`. Entering the area displays an entry; the page opens only after the player clicks it.

| Example map resource ID | Example purpose | Service status |
| --- | --- | --- |
| `shared-canvas` | Whiteboard | Optional WBO service is described in the Compose example |
| `shared-drawing` | Collaborative drawing for artists | Deploy a compatible service separately |
| `lounge-screen` | Synchronized YouTube/Bilibili viewing | Deploy a compatible service separately |
| `shared-document` | Collaborative document | Optional Etherpad service is described in the Compose example |

These are example map entries. They do not mean a service is deployed or has passed browser acceptance in a target environment. The shared Neko browser does not synchronize video playback. The project does not include video calls or screen sharing.

External services manage their own accounts, permissions, content, and persistence. The project does not map Impartation accounts or admin roles to tools, proxy tool traffic, issue tool credentials, or manage external containers. Entry URLs are public to browsers and must not contain passwords, access tokens, or private invitation details. Access restrictions belong in the external service or deployer's reverse proxy.

A tool can open in a new `external` tab or an `embed` iframe. Embedding depends on the target service's CSP, login method, and browser policy. See [external tool configuration](external-tools.en.md) for iframe sandbox rules. The project has no iframe bridge or service-specific adapter. Leaving the area closes the embedded window but does not revoke the external service's login session.

## Acceptance scope

Automated checks cover built-in interaction rules and external entry URL configuration and opening behavior. They do not verify real third-party login, collaboration, persistence, or media synchronization. When enabling an external service, check browser access, permissions, and required features in the target environment. See the [testing guide](testing.en.md).
