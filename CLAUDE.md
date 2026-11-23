# Fuel Photo Log (`realsystem/fuel`)

Browser-only app that reads fuel-pump displays and dashboard odometers/trip meters from photos, pairs them into fill-ups, computes fuel economy and reports, and exports/imports CSV. Live at https://realsystem.github.io/fuel/ (also linked from overlandn.com). Everything lives in `web/`.

## Commands
Run from `web/` (CI does the same with Node 20). `node_modules` is a symlink to `/opt/npm-tools/node_modules` here, so there is no install step in this sandbox; elsewhere `npm install --no-audit --no-fund`.
- Dev server: `npm run dev` (http://localhost:5173, live rebuild). Build: `npm run build` (-> `web/dist`).
- All tests: `npm test`. One file: `node --import tsx --test test/report.test.ts`. One test: add `--test-name-pattern="partial fills"`.
- Typecheck: `npm run typecheck`. No linter or formatter is configured.
- Local accuracy checks (need the git-ignored `../images/`): `npm run accuracy`, `npm run odometer -- ../images/odometer`, `npm run negatives -- <dir-of-non-pump-photos>`.
- Retrain the odometer glyph model: `python3 tools/train_glyphs.py --export` (run from `web/`; rewrites `glyphModel.ts`) (unverified).

## Architecture
- `src/main.tsx` -> `src/app/App.tsx` (all state: a `FuelRecord[]`; components in `src/app/components/`).
- `src/workers/imageProcessor.worker.ts` runs detection off the main thread. `src/processor/runOnBlob.ts` is the entry: pump reader (`ImageProcessor`/`NumberDetector`, 7-segment) first, then `OdometerProcessor` + `processor/odometer/` (connected components + tiny MLP), else `subject: 'unrecognized'`.
- `src/services/`: `CaptureTimeService` (EXIF > file-name time > file date), `TripService` (pairing, full-to-full trips, fill-up rows), `OdometerStatsService`, `OdometerSuggestService`, `ReportService`, `ManualEntryService`, `ExportService`/`ImportService` (CSV), `RecordService`, `StatisticsService`.
- Data flow: files -> worker -> `ProcessingResult` -> `FuelRecord` -> (dedupe) -> `computeTrips` -> `buildReport`. Nothing is stored: the exported CSV is the history, re-imported next cycle (imported rows have no photo).
- `src/` at the repo root is old Python/OpenCV experiments, reference only. Deep dive: `web/TECHNICAL.md`; usage: `web/README.md`.

## Conventions
- TypeScript, ESM, `.ts` extensions in imports. Services are pure functions over `FuelRecord[]` (easy to unit test); keep UI logic out of them.
- Uncertain readings must be flagged for review, never silently accepted; suggestions (e.g. odometer fixes) are never auto-applied. A trip-meter value is never used as mileage.
- CSV is the contract: any new `FuelRecord` field that matters goes in `CSV_COLUMNS` (ExportService) AND `importCsv` (ImportService) with validation/limits; update `test/services.test.ts` column expectations.
- Features need tests (`test/*.test.ts`; UI is checked manually with Playwright). Update `web/TECHNICAL.md` for behavior changes.
- Branch off `main`, one PR per change via `gh api repos/realsystem/fuel/pulls ...`. Merge only when the user says "merge" (merge commit, `PUT .../pulls/N/merge`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: <session url>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and the session URL.

## Gotchas
- **Privacy:** never commit photos or location data. `images/` is git-ignored; `images/odometer/expected.json` (real mileages) is local only. GPS/EXIF location is never read. The user rewrites git history themselves, so never push old history or photos.
- **Support link:** the Buy Me a Coffee URL must not appear in code, tests, docs or history. It is only the `SUPPORT_URL` GitHub secret/variable, injected at build (`process.env.SUPPORT_URL` in `build.mjs`). Tests use `buymeacoffee.com/example`.
- **CSP** (`public/index.html`) is `default-src 'self'`: no CDNs, web fonts, analytics or any network calls. Never use `process.env` in browser code except the two defines in `build.mjs` (it is undefined at runtime).
- **Sandbox typecheck is noisy:** `@types/react` is missing, so `npm run typecheck` shows ~900 TS7006/TS7016/TS2307-type errors in `.tsx`. Real check: `npm run typecheck 2>&1 | grep "error TS" | grep -v "TS7006\|TS7031\|TS2307\|TS7026\|TS2875\|TS7016\|UploadForm"` should print nothing. CI (with network) has full types.
- No network for npm/pip here. Playwright Chromium works: `NODE_PATH=$(npm root -g):/opt/npm-tools/node_modules node script.cjs` against a static server on `web/dist`; the sandbox cannot reach github.io.
- `src/processor/odometer/glyphModel.ts` is GENERATED (synthetic fonts only): do not edit by hand. `dist/` is generated.
- `test/regression.test.ts` and `test/odometerRegression.test.ts` use local photos and skip/scale when `images/` is absent or partial.
- Pump reader returns `no_numbers` unless >= 2 lines and a decimal point; odometer digits need ~10 px height. Pairing uses photo time only (<= 6 h, EXIF or file-name time, never file date). Efficiency assumes full-to-full fills.
- Stop-hook "unpushed commits" warnings are often stale tracking refs: `git fetch -q origin +refs/heads/<b>:refs/remotes/origin/<b>` then compare `git rev-parse HEAD origin/<b>`.
- Deploy: every push to `main` runs `.github/workflows/pages.yml` (install, typecheck, test, build, Pages), so a red typecheck or test blocks the live site.

## Definition of done
- `npm test` all green, `npm run build` succeeds, and the filtered typecheck above prints nothing (CI runs the full `npm run typecheck`).
- UI changes: checked in Chromium at desktop and phone width with no console errors.
- No photos, expected-mileage files or the support URL in the diff; `web/TECHNICAL.md`/README updated if behavior changed.
- PR opened against `main`; wait for the user's "merge".
