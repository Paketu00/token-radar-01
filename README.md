# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Paketu00/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Paketu00/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for the [make.fun bounty "Build the best token launch radar"](https://make.fun/bounty/token-radar-01): `main.ts` (Node 22, standard library only, no network) reads the sealed DefiLlama snapshot, filters out protocols that already have a token plus wrapped, staked, bridged and exchange products, and ranks 178 genuine pre-token protocols by implied launch value — one formula for every row (TVL × category multiple × 7-day momentum × maturity × chain breadth) with a 0–100 conviction score. It writes `board.json` (the full 40-protocol watchlist plus early finds below the $50M floor, each row with its implied value and a seven-step farm plan derived from that protocol's own category, TVL and age) and `dossier.json` via `buildDossier` from `vendor/makefun-board.ts`, and ships a static offline dashboard (board, per-protocol detail and working filters) with three screenshots. Fully deterministic: a read-only run reproduces board and dossier byte-for-byte.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=<out-dir> node main.ts --input <path-to-snapshot.json>
```

Writes `board.json`, `dossier.json` and the dashboard files to the output directory.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
