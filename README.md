# Blunderfish
Can you beat max difficulty stockfish if it randomly blunders?

Play now: **https://blunderfish.com/**

Blunderfish is an implementation of the "diluted stockfish" concept from the video **"30 Weird Chess Algorithms: Elo World"** by suckerpinch:  
https://www.youtube.com/watch?v=DpXy041BIlA

## Opponent engine

Opponent engine is fixed by mode:

- **Blunderfish / Blindfish / Clapbackfish** use Stockfish.
- **Rampfish** uses Maia via the Maia API endpoint, with selectable ELO ramp from 1100 to 1900.
- Rampfish uses Maia as primary move source, with a single-turn Stockfish fallback only when Maia times out/fails after one retry.

## Game modes
### Blunderfish
Max difficulty stockfish, but it is forced to randomly make a completely random legal move. This is often not a good move.

### Blindfish
Max difficulty stockfish, but it randomly forgets about pieces on the board before evaluating its move.

### Clapbackfish
Stockfish controls the game to sac the queen in the beginning but claps back to win at the end.

### Rampfish
Ramps Maia difficulty up or down over the game.

## Local Development

### Prerequisites

- [Volta](https://volta.sh/) for Node/npm version pinning

### Setup

1. Install the pinned toolchain:
   - `volta install node@20 npm@10`
2. Install dependencies:
   - `npm ci`

### Run and Validate

- Start dev server: `npm run dev`
- Run tests: `npm test`
- Run e2e tests: `npm run test:e2e`
- Build production bundle: `npm run build`
- Preview production bundle: `npm run preview`
- Maia API calls use `/api/v1/play/*` in-browser; the dev server proxies `/api` to `https://dock2.csslab.ca`.

### Troubleshooting

- If `node` or `npm` is missing, ensure Volta is installed and your shell profile is reloaded.
- If versions do not match, run `volta install node@20 npm@10` again.

## Credits

### Chess Engine

- **Stockfish** via `stockfish.js`
- License: **GPL-3.0**
- Package: https://www.npmjs.com/package/stockfish.js

### Board + Piece Graphics

- **Chess Pieces and Board Squares** by JohnPablok
- Source: https://opengameart.org/content/chess-pieces-and-board-squares
- License: **CC-BY-SA 3.0**

For full attribution details in-project, see: `public/CREDITS.md`.

This is just a project for fun, chess.com please don't sue me
