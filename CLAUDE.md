# CLAUDE.md

Guidance for Claude when working in this repo. See `README.md` for how the system works.

## What this repo is

DAS Trader Pro scripts used in **live trading**. Files have no extension. The user copies each one by hand into a DAS hotkey, button or event script, so editing a file here changes nothing until it's pasted into DAS. Mistakes can place or protect real orders badly, so be careful with anything that sends orders, sizes positions or affects the arming rules and lockouts.

## Rules

- **Keep `README.md` up to date with every script change.** Edit it in the same change: thresholds, run order in the dispatchers, the variables or buttons a script sets, new or removed scripts, hotkey-name mismatches, known limitations and unit test status. Tell the user which sections you changed.
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

## Conventions

- Button colours: green = good, `orange` = caution (don't use `yellow`), red = blocker, `color(211,211,211)` = neutral.
- With several conditions setting one label, check the low-priority ones first so the most important condition is set last and wins. `Test_Dip` checks cautions first, then blockers.
- New tests: add a `//Runs on:` comment at the top, initialise or reset any output variables each run so values never carry over from the previous symbol, and register the test in the right dispatcher.
- Values that must survive a symbol change use `setvar`/`getvar` keyed by symbol (`news_<SYM>`, `pattern_<SYM>`).
- `DynamicSizing/` is legacy and not in use. Don't edit it or paste it into DAS unless asked.
- If you change the impulse rules in `Tests/Test_Pattern`, update `UnitTests/bullish_impulse_test.js` to match. Run the tests with `node UnitTests/bullish_impulse_test.js UnitTests/<file>.json`.

## Open items

Not yet done. Raise them only if relevant, and don't implement without the user's go-ahead.

- **PositionMonitor (on hold while the user tests):** a 1-second script, run from `RunTests_Dispatch`, that detects when a position opens or closes. On close it would delete R1/S1 (unless re-armed) and reset `$R1_Last`/`$S1_Last`. It would also score each whole trade for the loss lockout, replacing `CheckForMultipleLosses`, which counts a partial at a profit followed by a breakeven stop as a loss. The user wants R1/S1 visible only while armed or in a position. Open questions:
  - Should a breakeven trade minus fees count as a loss?
  - Does realized P&L update after Pos reaches 0?
  - How to compare symbols so a symbol change isn't mistaken for a close?
  - R1/S1 are left on the old symbol after a symbol change.
- **WHLR unit tests fail:** BAR1 in `WHLR.json` is a red candle, and BAR3's high is below BAR4's in `WHLR.9.25.26.json`. The user wants to revisit whether the rules or the expected results are wrong.
- **TriggerStop:** the `StopTrigger` alert is left behind after a manual exit. Delete any existing alert before creating a new one.
- **Stuck test-group guards:** optionally reset the `$RunningTests*` guards when the PauseTests button unpauses, as a way to recover.
- **Leftover share from rounding:** `$qty=Round(Pos*0.75)` in `SellPortion` (and `Pos*0.5` in `SellPortionAsk`) would avoid it. The user hasn't decided.
- **Range limits:** `$AverageRange4` thresholds (.30 block, .20 warning) became about 2.5× stricter after the `/10` → `/4` fix. The user is watching whether they need retuning, and may switch to percentage-of-price thresholds.

Already decided, not to be raised again:
- `SellPortion` doesn't need a profitable check.
- Arming staying active across symbol changes while the tests are paused isn't a concern.
- Intraday level scans that reach previous-day bars are acceptable.
- R1/S1 lines should stay on the chart during a trade.
