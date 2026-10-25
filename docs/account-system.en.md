# Accounts, Profiles, and Permissions

The project uses Better Auth for usernames, passwords, and login sessions. SQLite stores project profile data, including display name, map character preset, appearance, permission role, and saved outfits. A login session proves account identity; `member` and `admin` are project permission roles. Neither can be set by client profile fields.

## Registration and profile data

Registration is controlled by `REGISTRATION_MODE`:

| Value | Behavior |
| --- | --- |
| `open` | Anyone can register; this is the default |
| `code` | Registration requires `REGISTRATION_CODE`; the server refuses to start if the code is missing |
| `admin` | Public registration is disabled; admins can still create accounts in the admin UI |

Usernames are 3–30 ASCII letters, digits, underscores, or periods; they are case-insensitive and immutable. Display names are 1–24 characters, may be shared, and can be changed. Passwords are 8–128 characters. Registration signs the user in automatically.

Better Auth requires an email field, so the project generates a non-deliverable placeholder address. It does not collect email, support email login, or provide email recovery. An administrator generates a one-time password-reset link for account recovery.

Project profile fields and permissions are separate:

| Field | Meaning |
| --- | --- |
| `avatar` | Preset ID for the character sprite shown on the map; not a personal profile photo |
| `appearance` | Current layered character outfit and layer colors |
| `role` | Project permission role: `member` or `admin` |
| `suspended` | Whether the account is frozen; managed by the server |

`GET /api/me` reads the current profile; `PATCH /api/me` updates display name, `avatar`, and `appearance`. The shared schema validates profile changes; updating a profile does not change permissions. The API returns compatibility aliases `name`/`displayName` and `appearance`/`currentAppearance`. PATCH accepts both forms; when both are supplied, `displayName` and `currentAppearance` take precedence.

Each account has three named outfit slots. `GET /api/me/outfits` reads all slots; `PUT /api/me/outfits/0`, `/1`, or `/2` updates one slot, and `null` clears it. Names are 1–12 characters and outfits are validated by `appearanceSchema`. Slots are stored per account across devices; old outfits in browser-local storage are not imported automatically.

## Login sessions and Space connections

Better Auth login sessions last 30 days. An account can have separate sessions on different devices and can join different Spaces at the same time, but it can have only one connection in a given Space. If the account joins that Space from another device, the new connection takes its seat and disconnects the old connection; the old device's account session is not revoked. A network reconnect restores the original Space connection and seat. The seat is released when the player leaves or the reconnect window expires.

| Operation | Account session | Live Space connection |
| --- | --- | --- |
| Sign out | Revokes the current device's session | Does not revoke other devices' connections; the current client leaves the signed-in UI |
| Change password | Revokes all sessions for the account | Disconnects all Space connections for the account |
| Use password-reset link | Sets a new password and revokes all sessions | Disconnects all Space connections for the account |
| Admin suspends account | Revokes existing sessions and blocks new sessions | Disconnects all Space connections for the account |
| Admin kicks account | Keeps account sessions valid | Disconnects current live connections; the account can sign in and rejoin |

Change a password with `POST /api/me/password`, providing the current password. Sign-in, sign-out, and password reset use the Better Auth routes allowed by the project; other Better Auth routes are not exposed.

## Administrators

Admin access is determined by the server-side profile `role`. The account management UI can list and create accounts, promote or demote users, suspend or unsuspend accounts, generate password-reset links, kick connections, and delete accounts. Admin requests require a valid admin session and explicit confirmation. An admin cannot suspend, demote, or delete their own account. Admins remain subject to normal map interaction and position checks in a Space.

Reset links expire after one hour and can be used once. Generating a new link invalidates the old one. Generating a link does not revoke login sessions; completing the reset revokes every session and disconnects live connections. Deliver the link privately to the intended user.

Suspending an account revokes current sessions, blocks new sessions, and disconnects live Space connections. After being unsuspended, the user can sign in with the existing password. Deleting an account removes the account and personal profile; its published board posts remain public and are not deleted automatically.

## Local maintenance CLI

The CLI uses the project root `.env` and `DATABASE_PATH` and accesses SQLite directly. Run it only as a trusted host user.

```sh
npm run identity -- list
npm run identity -- create USERNAME 'Display name' --password-stdin
npm run identity -- role USER_ID admin --yes
npm run identity -- role USER_ID member --yes
npm run identity -- suspend USER_ID --yes
npm run identity -- unsuspend USER_ID --yes
npm run identity -- reset-password USER_ID --yes
npm run identity -- kick USER_ID --yes
npm run identity -- delete USER_ID --yes
```

The create command reads the password from standard input; do not put it in command arguments:

```sh
printf 'Initial password: '
read -r -s ACCOUNT_PASSWORD
printf '\n'
printf '%s\n' "$ACCOUNT_PASSWORD" | npm run identity -- create USERNAME 'Display name' --password-stdin
unset ACCOUNT_PASSWORD
```

Use the CLI to create the first account during initial deployment, then grant it admin access. `kick` notifies a running server through a database command queue and is usually processed within one second. Role changes and other destructive operations require `--yes`.

## Deployment requirements

In production, set a random `IDENTITY_SECRET` of at least 32 characters, the public site `IDENTITY_BASE_URL`, and the actual frontend origins in `IDENTITY_TRUSTED_ORIGINS`. Use HTTPS/WSS and a same-origin reverse proxy. Identity profiles, outfits, sessions, and board posts are stored in SQLite; persist and back up the database. Only a single backend instance is supported. If HTTP Basic Auth is needed, the deployer must provide it through a reverse proxy; the project does not implement or configure it.
