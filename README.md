# Programmer Jackbox

A browser-based party game platform for developers. One player hosts a room, everyone else joins with a 6-character code, and you play together in real time.

## Game Modes

### Multiplayer

| Game | Players | Description |
|---|---|---|
| **Bug Fixer** | 3+ | Pitch the best bug-fix strategy card to the round's decider |
| **Code Typer (Versus)** | 2+ | Race opponents to type code snippets the fastest |
| **Logic CAH** | 4+ | Logic-based card prompts — players answer, decider picks the best |
| **Programmer Prophunt** | 4+ | Hiders plant suspicious lines of code; finders must spot them |

### Solo Arcade

| Game | Description |
|---|---|
| **Code Typer** | Speed-type code snippets as fast and accurately as possible |
| **Flexbox Spider** | Control a spider using CSS flexbox properties to reach its web |
| **Escape the Loop** | Program a robot to navigate a factory floor with drag-and-drop logic blocks |

## Setup

**Prerequisites:** Node.js v18+ and npm.

```bash
git clone https://github.com/BenBank11/ProgrammerJackbox.git
cd ProgrammerJackbox
npm install
npm start
```

- **Local:** `http://localhost:3000`
- **LAN:** `http://<host-ip>:3000` — other devices on the same network can connect directly

> Make sure your firewall allows inbound connections on the configured port.

## Development

```bash
npm run dev          # start with --watch (auto-restarts on file changes)
npm run sim:all      # run all socket simulation scripts against a running server
npm run lint         # ESLint
npm run format       # Prettier
```

Individual simulation scripts are also available (`npm run sim:lobby`, `npm run sim:bugfixer`, etc.) for testing specific game flows without a browser.

## Deployment (Render)

1. Connect the GitHub repository to [Render](https://render.com) as a **Web Service**
2. Set **Build Command** to `npm install` and **Start Command** to `npm start`
3. Render injects `PORT` automatically — no manual config needed

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |

## Architecture

```
server.js                  — Express + Socket.IO entry point, room management
src/
  room-manager.js          — Room creation, joins, player tracking
  constants.js             — Shared constants
  utils.js                 — Shared utilities
public/
  index.html               — Main lobby UI
  style.css                — Global design system (dark monospace theme)
  client.js                — Lobby socket client, game card rendering
  gamemodes.json           — Game mode registry (name, description, min players)
gameModes/
  bug-fixer/               — Bug Fixer game + service module
  code-typer/              — Solo Code Typer
  code-typer-multiplayer/  — Versus Code Typer
  escape-the-loop/         — Escape the Loop solo puzzle
  flexbox-spider/          — Flexbox Spider solo puzzle
  logic-cah/               — Logic CAH multiplayer
  programmer-prophunt/     — Programmer Prophunt + service module
```

Multiplayer games run logic on the server via a service module and push state to clients over Socket.IO. Single-player games are standalone pages loaded via redirect.

## Known Issues

- Quick play / public lobbies are not fully working
- Profile and Settings screens are UI placeholders — nothing persists
- No database; all room state is lost on server restart
- The Optimizer game mode exists as a folder but is not implemented

## Contributing

Each game lives in its own folder under `gameModes/`. Multiplayer games expose a service module (`*-service.js`) that the main `server.js` imports. Single-player games are self-contained static pages with their own HTML, CSS, and JS.
