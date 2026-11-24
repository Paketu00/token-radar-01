// Aurora Token Radar - a pre-token protocol radar for the token-radar-01 bounty.
//
// What this program does, in plain terms:
//   1. It reads one sealed DefiLlama snapshot (no network, Node standard library only).
//   2. It keeps protocols that do not have a token yet and throws out products that are
//      really somebody else's token in disguise: wrapped, staked or bridged wrappers,
//      exchange house products and renamed version pools of a protocol that exists.
//   3. It scores every survivor with one published formula (see scoreProtocol below),
//      ranks the board by the implied launch value that formula produces, and attaches
//      a concrete farm plan to every single row.
//   4. It writes board.json, a data.js feed for the static dashboard, copies the
//      dashboard and the screenshots into the output folder, and finally writes
//      dossier.json with buildDossier from vendor/makefun-board.ts.
//
// The snapshot's own watchlist is treated as a floor, never as a ceiling: every
// watchlist slug is on the board even before the early layer below the floor is added.
//
// Run it the way the grader does - the repository may be read-only, so every write
// goes under the output directory and nowhere else:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_CAP = 65_536;

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

function readSnapshot(path: string): Snapshot {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('snapshot root is not an object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || typeof doc.source !== 'string') {
    throw new Error('snapshot is missing its as_of date or its source line');
  }
  if (typeof doc.floor_usd !== 'number' || !(doc.floor_usd > 0)) {
    throw new Error('snapshot is missing a positive floor_usd');
  }
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist arrays');
  }
  const protocols: Protocol[] = doc.protocols.map((entry, at) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`protocol ${at} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`protocol ${at} lacks a slug, a name or a TVL figure`);
    }
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  const watchlist = doc.watchlist.filter((s): s is string => typeof s === 'string');
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist };
}

// ---------------------------------------------------------------------------
// The filter: who is genuinely still waiting for a token?
// ---------------------------------------------------------------------------

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;
const HOUSE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function hasNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

function isWrapperProduct(p: Protocol): boolean {
  if (p.category !== null && HOUSE_CATEGORIES.has(p.category)) return true;
  if (WRAPPER_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((brand) => p.name.startsWith(brand));
}

function isGenuineCandidate(p: Protocol): boolean {
  return hasNoToken(p) && !isWrapperProduct(p) && !VERSION_SUFFIX.test(p.name);
}

// ---------------------------------------------------------------------------
// The scoring model - one formula for every row, no name is ever special-cased
//
//   implied = round( tvl
//                    x categoryMultiple      (what DeFi usually lists at, per TVL)
//                    x momentumMultiplier    (clamped 7-day TVL change)
//                    x maturityMultiplier    (how long it has run tokenless)
//                    x breadthMultiplier )   (how many chains it already spans)
//
// A separate conviction score (0-100) summarises size, momentum and maturity for
// the dashboard's bars; it never changes the ranking, which is pure implied value.
// ---------------------------------------------------------------------------

const MODEL_ID = 'aurora-2';

function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 0.42;
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative')) return 0.38;
  if (c.includes('prediction')) return 0.35;
  if (c.includes('curator') || c.includes('allocator') || c.includes('rwa') || c.includes('yield')) return 0.3;
  if (c.includes('chain')) return 0.28;
  if (c.includes('payment') || c.includes('stable')) return 0.24;
  return 0.26;
}

const DAY = 86_400_000;

function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY));
}

interface Score {
  implied: number;
  category_multiple: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  conviction: number;
}

function scoreProtocol(p: Protocol, asOf: string): Score {
  const age = ageInDays(asOf, p.listed_at);
  const ageForMath = age ?? 540;
  const rawChange = p.change_7d ?? 0;
  const clampedChange = Math.min(80, Math.max(-40, rawChange));
  const momentum = 1 + (clampedChange / 100) * 0.55;
  const maturity = 0.62 + (Math.min(ageForMath, 1825) / 1825) * 0.48;
  const breadth = 1 + Math.min(Math.max(p.chains.length - 1, 0), 5) * 0.025;
  const multiple = categoryMultiple(p.category);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
  const sizePart = Math.min(40, Math.max(0, (Math.log10(Math.max(p.tvl_usd, 1)) - 6) * 16));
  const momentumPart = Math.min(30, Math.max(0, 15 + clampedChange * 0.35));
  const maturityPart = Math.min(30, (Math.min(ageForMath, 1825) / 1825) * 30);
  const conviction = Math.round(sizePart + momentumPart + maturityPart);
  const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
  return {
    implied,
    category_multiple: multiple,
    momentum_multiplier: round4(momentum),
    maturity_multiplier: round4(maturity),
    breadth_multiplier: round4(breadth),
    age_days: age,
    conviction,
  };
}

// ---------------------------------------------------------------------------
// Farm plans - derived from the row itself: category picks the action, TVL
// picks the position size, age picks the holding window. Nothing is hand-listed.
// ---------------------------------------------------------------------------

function positionSize(tvl: number): number {
  if (tvl >= 1_000_000_000) return 400;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 75_000_000) return 100;
  if (tvl >= 20_000_000) return 50;
  return 25;
}

function holdingWindow(age: number | null): number {
  if (age === null) return 45;
  if (age < 200) return 75;
  if (age < 500) return 60;
  return 45;
}

function primaryAction(p: Protocol, size: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${size} of USDC as collateral inside ${n} on ${chain}, borrow a small amount against it once, repay it, and leave the supply position open`;
  }
  if (c.includes('dex')) {
    return `Add $${size} of paired liquidity to the busiest ${n} pool on ${chain}, then make one small swap through the same pool so both sides of the product see the wallet`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${size} of USDC margin into ${n} on ${chain}, open one small hedged trade, close it cleanly, and keep the margin account funded`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${size} into one curated ${n} vault on ${chain}, keep the vault shares in the same wallet, and do not rotate between vaults chasing yield`;
  }
  if (c.includes('prediction')) {
    return `Fund ${n} with $${size} on ${chain} and take one genuine position in a liquid market you actually have a view on, then let it settle`;
  }
  if (c.includes('rwa')) {
    return `Mint $${size} of the ${n} real-world-asset token on ${chain} through its own app and hold the minted position untouched in the farming wallet`;
  }
  if (c.includes('yield')) {
    return `Deposit $${size} into the main ${n} yield vault on ${chain} and keep the receipt shares, compounding nothing by hand in the first month`;
  }
  if (c.includes('insurance')) {
    return `Buy $${size} of cover from ${n} on ${chain} for an asset you really hold elsewhere, and keep the policy active until it expires`;
  }
  if (c.includes('payment') || c.includes('stable')) {
    return `Route one real $${size} payment or stablecoin deposit through ${n} on ${chain} and leave a working balance in the account afterwards`;
  }
  return `Deposit $${size} of USDC into ${n} on ${chain} through its official app and keep the resulting position open and untouched`;
}

function farmPlan(p: Protocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const size = positionSize(p.tvl_usd);
  const hold = holdingWindow(age);
  const gas = size >= 200 ? 9 : size >= 100 ? 6 : 3;
  const steps = [
    `Start with a dedicated farming wallet funded only from your main wallet, verify the ${p.name} app address from the protocol's own documentation, and never sign from a search-result link. Cost: under $3 in gas. Time: 10 minutes.`,
    `Before committing real size, make a $5 test transaction on ${chain}, wait for it to settle, and confirm the position shows in the app - a wrong-network deposit is the most common way this farm loses money. Cost: about $1 in gas. Time: 5 minutes.`,
    `${primaryAction(p, size, chain)}. Cost: $${size} of working capital plus roughly $${gas} in gas. Time: 20 minutes including the approval.`,
    `Repeat one genuine qualifying action every week - a deposit top-up, a borrow-and-repay, a swap or a governance vote - so the wallet shows a pattern of use, not a single drive-by visit. Cost: about $2 in gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days, spanning several weekly snapshots, and check the position weekly for health-factor or pool-share drift instead of touching it daily. Cost: the $${size} stays deployed. Time: ${hold} days.`,
    `Track the protocol's official announcements and its points or rewards page weekly; if a snapshot or eligibility date is announced, do one extra qualifying action that week and screenshot your position. Cost: nothing to check. Time: 10 minutes a week.`,
    `Keep a farm log with the wallet address, every date, transaction hash and balance, and unwind only after any announced snapshot passes - never pay a third party to claim anything for you. Cost: nothing. Time: 15 minutes to keep current.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  conviction: number;
  model: {
    category_multiple: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

function assembleBoard(snapshot: Snapshot): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isGenuineCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  for (const p of early) picked.set(p.slug, p);

  const watch = new Set(snapshot.watchlist);
  const scored = [...picked.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, score }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(p.slug),
    age_days: score.age_days,
    implied_value_usd: score.implied,
    conviction: score.conviction,
    model: {
      category_multiple: score.category_multiple,
      momentum_multiplier: score.momentum_multiplier,
      maturity_multiplier: score.maturity_multiplier,
      breadth_multiplier: score.breadth_multiplier,
    },
    farm_steps: farmPlan(p, score.age_days),
  }));
}

function checkBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `only ${board.length} rows, the gate wants at least 100`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice on the board`;
    seen.add(row.slug);
  }
  const slugs = seen;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i} carries rank ${row.rank}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has a bad implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value, which ranks nothing';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dashboard feed and file copying
// ---------------------------------------------------------------------------

function liveRows(snapshot: Snapshot) {
  return snapshot.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function argumentValue(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function main(): void {
  const inputArg = argumentValue('input', '/input');
  const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputPath)) {
    process.stderr.write(`aurora radar: no snapshot found at ${inputPath}\n`);
    process.exit(2);
  }
  const outDir = argumentValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshot = readSnapshot(inputPath);
  const board = assembleBoard(snapshot);
  const problem = checkBoard(board, snapshot);
  if (problem !== null) {
    process.stderr.write(`aurora radar: refusing to write a board the gate would reject: ${problem}\n`);
    process.exit(1);
  }
  const live = liveRows(snapshot);
  const earlyCount = board.filter((r) => !r.watchlist).length;
  const totalImplied = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const medianImplied = board.length > 0 ? board[Math.floor(board.length / 2)]!.implied_value_usd : 0;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);

  const feed = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_id: MODEL_ID,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    total_implied_usd: totalImplied,
    median_implied_usd: medianImplied,
    rows: board,
    live,
  };
  writeFileSync(join(outDir, 'data.js'), `window.RADAR=${JSON.stringify(feed)};\n`);

  copyPlainFiles(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
  const shots = copyPlainFiles(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));

  if (shots.length >= 3) {
    const dossier = buildDossier(outDir, {
      text_max_bytes: DOSSIER_TEXT_CAP,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    });
    writeFileSync(join(outDir, 'dossier.json'), dossier);
    process.stdout.write(
      `aurora radar: ${board.length} rows (${snapshot.watchlist.length} watchlist + ${earlyCount} early), ` +
        `${live.length} live-token protocols set aside, dossier written from ${shots.length} screenshots\n`,
    );
  } else {
    process.stdout.write(
      `aurora radar: ${board.length} rows written, but screenshots/ holds ${shots.length} image(s); ` +
        'dossier.json is written only once the three dashboard screenshots exist\n',
    );
  }
}

main();
