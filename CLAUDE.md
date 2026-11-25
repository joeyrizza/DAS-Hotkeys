# CLAUDE.md

Guidance for Claude when working in this repo. See `README.md` for how the system works.

## What this repo is

DAS Trader Pro scripts used in **live trading**. Files have no extension. The user copies each one by hand into a DAS hotkey, button or event script, so editing a file here changes nothing until it's pasted into DAS. Mistakes can place or protect real orders badly, so be careful with anything that sends orders, sizes positions or affects the arming rules and lockouts.

"Setup Armed" is the user's self-check, pressed on a key combination when they see an entry forming. DAS speaks every blocker and warning so that, under stress, they don't miss an obvious rule break (float too high, too extended). The spoken lines are the point of it: a rule that silently stops being spoken is as bad as a wrong order. Any change to an arming rule or its input test needs its test in `UnitTests/tests/arming.json` updated too.

## Rules

- **Keep `README.md` up to date with every script change.** Edit it in the same change: thresholds, run order in the dispatchers, the variables or buttons a script sets, new or removed scripts, hotkey-name mismatches and known limitations. The unit tests are documented in `UnitTests/README.md`, not here: keep that file up to date when the tests or test tools change. Tell the user which sections you changed.
- **Propose, don't implement, changes to order logic, sizing, arming or lockouts** (`DynamicEntry`, `StaticEntry`, `Sell*`, `TriggerStop`, `SpeakTestResults`, `SetupArmed`/`SetupDisarmed`, `CheckForMultipleLosses`). Show the proposed code and wait for a yes. Display, speech and test-script fixes the user asked for can be made directly.
- **The user commits their own changes** and tests them in DAS before going on. Don't commit unless asked. After a batch of edits, list the scripts that need to be pasted into DAS, using the DAS hotkey name wherever it differs from the filename.
- **Keep each file's line endings.** The repo has both CRLF and LF files. Shell tools like `sed -i` and heredocs can silently change them, so check with `file <path>` after editing, and prefer the Edit tool.
- If a script is moved into or out of a dispatcher (`RunTests_1sec`, `RunTests_ChartUpdate`, `RunTests_1min`, `RunTests_Symb`, `RunTests_Dispatch`), check the run order: later scripts read globals that earlier ones set.

## DAS script facts

The user confirmed these in DAS:

- Divide by zero doesn't error; it returns `0` (`MsgBox(14/0)` shows `0`). Add a guard only where 0 would be a misleading value. For example, `$PricePosition` defaults to 50.
- Fractional share counts round down. A 25-share position split 75/25 can leave one share, which the user sells by hand.
- `SubString` parsing of `GetStudyVal(..., ByBarNum, n)` strings in `TestEMATrendState` works correctly (gives 3 decimals).
- Variables are global and not case-sensitive (`$SetupArmed` and `$SETUPARMED` are the same).
- Bar fields are `.Open`, `.Hi`, `.Lo`, `.Close`, `.Volume`, `.Time`. Use `.Hi`/`.Lo`, not `.High`/`.Low`.
- `GetTrendLine` only finds lines on the chart's current symbol, because lines are made local with `GlobalTrendLineToLocal`.
- Trendline `LineStyle=0` is solid; `1` is not. Level lines use 0; `R1`/`S1` and `5Min9EMA` use 2.
- `Round(x,103)` returns a **string** with 2 decimals (`Round(123.456,103)` → `"123.45"`), meant for display. The 2 decimals can't be changed.
- `Round("123.456",3)` turns a string into a number. Study values from `GetStudyVal(..., ByBarNum, n)` are strings, so the scripts strip the prefix with `SubString` and then `Round` the rest.
- `SaveVarToFile(name)` writes every variable in memory to a file, one `$var=value;` per line. `LoadVarFromFile(name)` reads them back (meant for restoring values when the platform loads). Lines come out in no fixed order. Strings are double-quoted, and `setvar` variables are included.
- Seen in an `ExportChartData` export: per-bar study text ends with a newline, and EMA/VWAP text starts with a space (`" AVG:0.893\n"`, `" VWAP:0.780\n"`, `"MACD:x, Signal:y\n"`). Bar `.Time` is `"20261124 13:37:00"`. Minutes with no trades have no bar. `GetBar(-n)` before the chart's first bar returns an empty bar (`Time ""`, prices 0, study text `"0"`). `GetSecond()` matches the bar times. `GetStudyVal("Study9EMA")` with no window reads Chart1.
- Seen in an export: `Round(x)` with no decimals drops the fraction (`Round(92.9694)` = 92), while `Round(x,1)` rounds (`Round(10.088965,1)` = 10.1). So `DynamicEntry`'s `Round(risk / riskPerShare)` already rounds the share count down.

## Conventions

- Button colours: green = good, `orange` = caution (don't use `yellow`), red = blocker, `color(211,211,211)` = neutral.
- With several conditions setting one label, check the low-priority ones first so the most important condition is set last and wins. `Test_Dip` checks cautions first, then blockers.
- New tests: add a `//Runs on:` comment at the top, initialise or reset any output variables each run so values never carry over from the previous symbol, and register the test in the right dispatcher.
- Values that must survive a symbol change use `setvar`/`getvar` keyed by symbol (`news_<SYM>`, `pattern_<SYM>`).
- `DynamicSizing/` is legacy and not in use. Don't edit it or paste it into DAS unless asked.
- Unit tests run the real script files through the interpreter in `UnitTests/das/`. After changing a script, run `node UnitTests/das/run.js test` (lint, the tests in `UnitTests/tests/`, and snapshots). Add a test to `UnitTests/tests/*.json` for new behaviour; fixtures hold data only. When a snapshot changes, show the user the diff, and only run `run.js snapshot` to accept it once the change is what was intended. Tell the user which snapshot lines changed.
- The user's goals for the tests: catch script changes that break something (syntax, a button display, the entry stop), and keep a library of fixtures in `UnitTests/fixtures/` for backtesting entries later. Raw exports go in `UnitTests/exports/`.
- When you find new DAS behaviour (from the user or an export), model it in `UnitTests/das/interpreter.js` or `simdas.js` and update the confirmed/assumed list at the top of `interpreter.js`.
- `UnitTests/tools/convert_das_export.js` must match the row layout in `ExportChartData` (a hotkey; the `ExportChartData` button only calls it). Change both together.

## Open items

Not yet done. Raise them only if relevant, and don't implement without the user's go-ahead.

- **PositionMonitor (on hold while the user tests):** a 1-second script, run from `RunTests_Dispatch`, that detects when a position opens or closes. On close it would delete R1/S1 (unless re-armed) and reset `$R1_Last`/`$S1_Last`. It would also score each whole trade for the loss lockout, replacing `CheckForMultipleLosses`, which counts a partial at a profit followed by a breakeven stop as a loss. The user wants R1/S1 visible only while armed or in a position. Open questions:
  - Should a breakeven trade minus fees count as a loss?
  - Does realized P&L update after Pos reaches 0?
  - How to compare symbols so a symbol change isn't mistaken for a close?
  - R1/S1 are left on the old symbol after a symbol change.
- **TriggerStop:** the `StopTrigger` alert is left behind after a manual exit. Delete any existing alert before creating a new one.
- **Stuck test-group guards:** optionally reset the `$RunningTests*` guards when the PauseTests button unpauses, as a way to recover.
- **Leftover share from rounding:** `$qty=Round($pos*0.75)` in `SellPortion` (and `$pos*0.5` in `SellPortionAsk`) would avoid it. The user hasn't decided.
- **Range limits:** replaced on 2026-11-25. The $0.30 / $0.50 blocks and the $0.20 warning became: block when Rng4 > 25% of price, or when the bigger of the last two candles is ≥ 2.5× the 8 before it and ≥ 8% of price; warn when Rng4 > 10% of price. The aim is to allow frontside entries like NRSN 08:09. The user is testing it in DAS; the numbers may still need tuning with the replay sliders.

Already decided, not to be raised again:
- `SellPortion` doesn't need a profitable check.
- Arming staying active across symbol changes while the tests are paused isn't a concern.
- Intraday level scans that reach previous-day bars are acceptable.
- R1/S1 lines should stay on the chart during a trade.
- `TriggerStop` (a test made for another trader) and `StaticEntry` (an old buy hotkey, not assigned to a key) aren't used live. Don't review them as part of the strategy. `DynamicEntry` is the production entry.
- `DynamicEntry` doesn't need a guard for a 0 or blank stop price: broker limits block buys under $1, and the user checks the stop field before buying. (`Round()` with no decimals turned out to round down, so sizing never goes above $3.75 anyway.)
- Arming while the tests are paused (and so using another symbol's stale values) isn't a concern.
- `CheckForMultipleLosses` counting a loss after a restart (`$TEMPTOTAL` starts at 0) is fine. The user can unlock the montage by hand.
- The hand-made Bullish Impulse JSON cases (APUS, TDIC, WHLR) and `bullish_impulse_test.js` were deleted: they don't hold enough data. Tests use fixtures exported from DAS only.
