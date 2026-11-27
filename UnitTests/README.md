# Unit tests

These tests run the **real script files**, the same text you paste into DAS, outside DAS. `das/` holds a DAS script interpreter written in Node and a simulated DAS. The simulated DAS is built from market data you export from DAS, so the tests check your scripts directly rather than a copy of their logic. You need Node.js only; there are no packages to install.

All commands run from the repo root.

## Contents

- [After changing a script](#after-changing-a-script)
- [What the tests cover](#what-the-tests-cover)
- [Other commands](#other-commands)
- [Replaying a day](#replaying-a-day)
- [Files](#files)
- [Writing a test](#writing-a-test)
- [Capturing a setup from DAS](#capturing-a-setup-from-das)
- [Fixture format](#fixture-format)
- [Limits](#limits)

---

## After changing a script

```
node UnitTests/das/run.js test
```

This runs the three parts below and exits with code 1 if any fail. Each failure says what changed, for example:

```
FAIL setup | JAGX 13:59: buttons match DAS
       CHART1.btn_rvol.text = "RVOL: 373.42x", expected "RVOL: 373.4x"
```

If a snapshot changed and the change is what you meant, accept it:

```
node UnitTests/das/run.js snapshot
```

It lists every change it saved.

---

## What the tests cover

### 1. Check (lint)

Every live script must parse. The check reports:

- a missing `;` (two statements run together);
- unclosed strings and braces;
- `=` where `==` was meant, as in `if($SetupArmed=0)`;
- unknown function names, such as `Rond(`;
- `exechotkey` names with no script in the repo.
- a replay slider whose script text (in `das/params.js`) is no longer in the script.

`run.js check` also lists warnings, such as a variable that is read but never set, which is usually a typo. The check treats a missing `;` as an error even where DAS might accept it.

### 2. Hand-written tests (`tests/*.json`)

| File | What it checks |
|---|---|
| `arming.json` | Presses Setup Armed once for each rule. Each non-negotiable blocks with its own spoken line, and the first rule to fail is the one spoken. Edge values do what the rules say: a price of exactly $20, a float of exactly 20M, volume of exactly 750k and a 4-candle range of exactly 25% of price all arm, and an RVOL of 0 isn't blocked. Each warning is spoken while still arming. The highest-volume candle warning first runs `FindIntradayLevels_1` on the fixture's bars to draw the line. Another test checks that drawing levels leaves `$VOL` (the day's volume) alone. |
| `orders.json` | Entry sizing and the trigger stop, the 25-share cap, the training-account route, and every reason an entry is blocked. Also `TestStop` showing the same share count `DynamicEntry` buys, `SellPortion` and `SellPortionAsk` (in profit, at a loss, flat, and the leftover share on 25 shares), and the loss lockout. |
| `setup.json` | Checks the buttons and the arming result against what DAS showed for JAGX at 13:59, and that RVOL shows "0x" in orange when there's no data. JAGX 13:59 now arms: DAS blocked it under the old $0.30 range limit, before the change to the % and spike limits. The candle-range tests run `TestExtended` on NRSN at 08:05 and 08:33 (spike), 08:08 (over 25% of price) and 08:09 (frontside, orange only), with `$MPRICE` set to each bar's close. |

Each arming test starts from the JAGX values DAS had in memory, made clean: price 8, small candle ranges, a tight spread and a confirmed reversal. It then breaks one rule, and checks the exact words spoken, whether the setup armed, and the arm button.

### 3. Snapshots (`snapshots/*.json`)

Six standard scenarios run on every fixture:

- all tests on a freshly loaded symbol;
- arming;
- an entry with a stop 20c below the bid;
- the three exits.

Every button, spoken line, order and variable must match the saved snapshot. A change shows up as, for example, `btn_rvol.text: "RVOL: 373.4x" -> "RVOL: 373.42x"`. A new fixture needs its first snapshot saved (see [Capturing a setup from DAS](#capturing-a-setup-from-das)).

---

## Other commands

```
node UnitTests/das/run.js run <fixture> Test_Dip                       # run hotkeys, print what they did
node UnitTests/das/run.js run <fixture> DynamicEntry --set SETUPARMED=1 --montage Price=11.5
node UnitTests/das/run.js compare <fixture>                            # check the interpreter against DAS
node UnitTests/das/run.js check                                        # lint only, with warnings
node UnitTests/das/run.js test UnitTests/tests/arming.json             # one test file only
```

`<fixture>` is a file name in `fixtures/` without `.json`, such as `JAGX_20261124_1359`.

Options for `run` and `compare`:

| Option | Effect |
|---|---|
| `--set NAME=VALUE` | Set a variable first. Repeatable. |
| `--montage NAME=VALUE` | Change a montage field, such as `Pos=20`. |
| `--quote NAME=VALUE` | Change a quote field, such as `Halted=1`. |
| `--second=N` | Set `GetSecond()`, in seconds since midnight. |
| `--no-preset` | Start with empty memory instead of the variables DAS had at export. |

`run` prints the variables set, the buttons, speech, `MsgBox` text, chart lines, and every order and montage command in the order sent.

`compare` runs `RunTests_Dispatch` and `RunTests_ChartUpdate` and compares each variable they set with DAS's own value. On the JAGX fixture, 132 of 134 match. The other two (`$VOL`, `$RVOL`) differ only because the volume ticked between DAS's last test run and the export.

---

## Replaying a day

```
node UnitTests/das/run.js replay NRSN_20261125_1502
```

This writes `UnitTests/replays/<fixture>.html`. Open it in a browser. The page steps through the fixture's 1-minute bars as if the day were live, runs the real scripts, and shows where "Setup Armed" would have blocked, armed with warnings, or armed clean. It holds the scripts and the fixture, so it replays the day itself (a few seconds when it opens). That lets the strategy sliders re-run the scripts with other thresholds.

How it works (`das/replay.js`):

- Each minute is replayed at 4 points: the open, the low, the high and the close for a green candle, or the open, the high, the low and the close for a red one (the page labels them that way). The true order inside a minute isn't in the export, so this is an assumption. The forming candle grows the way it did in DAS, so a rule such as the candle-range limit can switch on partway through a minute.
- At each point, Chart1 is cut off at that minute. `RunTests_Dispatch` and `RunTests_ChartUpdate` run with memory carried over from the previous point, as in DAS. Memory starts empty, as after loading the desktop, with the tests turned on.
- Then `Setup Armed` runs on a copy of memory, so pressing it never arms the following points. The replay records what it spoke, `$OKtoArm` and the button colours.
- `SpeakTestResults` then runs again on another copy, with its `return;` statements removed, so it lists every rule that fails. Setup Armed stops at the first blocker, so on a blocked minute the warnings below it are never spoken. This pass shows them anyway, and is never used to decide whether arming is allowed.

The chart:

- The shading behind the candles is the arming result, one thin slice per point: red = blocked, orange = arms with warnings, green = arms clean. In the side panel you can untick warnings you'd ignore (such as "Price action has not yet confirmed a reversal") so they no longer turn a minute orange.
- The strips under the chart have one row per rule that fails: blockers in red, warnings in orange. A faded mark means Setup Armed stopped at an earlier blocker and never said it. Below them are the chart buttons' colours. A red button that isn't an arming rule, such as MACD, doesn't block.
- Hover a candle to see its values, Rng4/Rng10 in dollars and as a percent of price, the highest-volume candle low, and what Setup Armed said at each of the 4 points. Click to pin it. Scroll to zoom, drag to pan, or type a time range.
- On an iPad (or any touch screen): tap a candle to pin it, drag sideways to pan, and pinch to zoom. A vertical drag scrolls the page. In landscape the page keeps its three columns. In portrait (under 1024 px wide) the details sit in a panel under the chart, and **Strategy settings** replaces them there, so the chart stays in view while a slider moves.

### Strategy settings

Click **Strategy settings** to open the sliders. Each one changes a threshold in the scripts' text before they run; the files in the repo don't change. The chart then shows the adjusted result, a "Setup Armed, live rules" strip keeps the original for comparison, and the panel at the top gives the share of points that would arm, for the whole day and for the minutes in view. "Changes to the scripts" lists each line as it is and as it would be.

| Slider | Script | Live value |
|---|---|---|
| Stock is too expensive | `SpeakTestResults` | $20 |
| Float too high | `SpeakTestResults` | 20M |
| Gap less than | `SpeakTestResults` | 10% |
| Candle range too large: 4-candle average | `SpeakTestResults`, `TestExtended` | 25% of price |
| Candle is too large for this stock: size vs the 8 before | `SpeakTestResults`, `TestExtended` | 2.5x or more |
| Candle is too large for this stock: and at least | `SpeakTestResults`, `TestExtended` | 8% of price |
| Volume too low | `SpeakTestResults` | 750K |
| Price is too close to the highs | `SpeakTestResults` | $0.10 |
| Below VWAP: curl needs short-term RVOL of | `Test_Curl` | 1.0x |
| Candles have large range (warning) | `SpeakTestResults`, `TestExtended` | 10% of price |
| Stock may be extended (warning) | `TestExtended` | 4x Rng10 above the 9 EMA |
| Stock is expensive (warning) | `SpeakTestResults` | $10 |

- The candle-range sliders are already in % of price, because the live rules are (`$Rng4Pct`, `$SpikePct`, set by `TestExtended`). The two "Candle is too large for this stock" sliders are the two halves of one rule: it blocks only when the candle is both that many times the 8 before it **and** that % of price. The details panel shows each minute's Rng4 % and spike size.
- "Price is too close to the highs" has four modes, with a $ slider and a % slider:

  | Mode | Condition written into the script | Effect |
  |---|---|---|
  | $ | `$MONTAGE1.Hi-0.1 <= $MPRICE` | The live rule |
  | % of price | `$MONTAGE1.Hi-($MPRICE*0.02) <= $MPRICE` | Scales with the stock's price |
  | $ and % | both conditions joined with `&&` | Fires only when both are crossed: looser than either alone |
  | $ or % | both conditions joined with `\|\|` | Fires when either is crossed: stricter than either alone |
- Sliders that only change `SpeakTestResults` update as you drag: Setup Armed is pressed again at every point from the saved memory, with the visible minutes first. The others change a test that runs every second, so the page replays the day again when you release the slider.
- The address keeps the view and the settings, e.g. `NRSN_20261125_1502.html#08:00-09:00@08:09&nearHigh=0.05&spikeMult=3` shows 08:00 to 09:00 with 08:09 pinned and two thresholds changed. Values are written as plain numbers (`0.05`, `3`, `25`); "too close to the highs" also takes `2%`, `0.1and2%` or `0.1or2%`. Bookmark it to come back to a setting.
- The thresholds and where they're written are listed in `das/params.js`. Each one names the exact script text it replaces, and `run.js test` fails if that text is no longer in the script, so update `params.js` when you change one of those lines. To add a slider, add an entry there. `REPLAY_EDITS` in the same file lists edits the replay always makes because it can't check that rule: today only the RVOL blocker, switched off.

Options: `--from=HH:MM --to=HH:MM` keeps only that part of the day, `--samples=1|2|4` sets the points per minute, `--spread=X` sets the assumed spread (default 0.02), `--param=NAME=VALUE` sets a threshold for the replay printed by the command and as the page's starting point (repeatable, e.g. `--param=nearHigh=0.05 --param=rng4Block=30 --param=spikeMult=3`), `--out=FILE` sets the page's path, and `--json=FILE` also writes the timeline as JSON.

Values the export only has from the moment of export, and how the replay fills them in:

| Value | Replay |
|---|---|
| Bid/ask | Last +/- half of `--spread` |
| Montage high/low ("Price is too close to the highs") | From 9:30, the regular session's high/low so far: DAS's montage leaves out premarket bars (seen in all four exports). Before 9:30, the high/low of the exported bars so far; what DAS shows then isn't known yet. |
| Today's volume | The exported bars' volume so far. DAS's daily volume is higher than the bars add up to (6-19% in the 2026-11-25 exports), even when the export reaches the start of the chart, so the running volume is scaled up by that ratio. If the export stops before the start of the chart, the difference is added from the first bar instead. |
| Highest-volume candle line (`1L<SYM>`, "Price is below the highest volume candle") | Always drawn, at the low of today's highest-volume finished candle so far, so the warning still counts after price falls far below that level (it stays resistance). In DAS, `FindIntradayLevels_1` draws it only when that low is within -20%/+50% of the price. The details panel shows the level and which candle set it. |
| RVOL | Not checked. The replay switches the RVOL blocker off in its copy of `SpeakTestResults` (your DAS scripts keep it), because DAS's own RVOL during the day isn't in the export. It has no slider and no strip. |
| Float, borrow status, daily averages | The export's values |
| 9/20/200 EMA inside a minute | Moved from the previous bar's value toward the price at that point. VWAP and MACD use the bar's exported value. |

### Publishing the replays

The replays are published as the **Replays** section of the trade-review site, behind the same login. On your PC, after exporting a day with `ExportChartData`:

```
node UnitTests/das/run.js publish
aws s3 sync UnitTests/site/replay s3://<BucketName>/replay --cache-control no-cache
```

`<BucketName>` is the trade-review stack's bucket (see trade-review's README). `publish`:

1. Converts every file in `exports/` that has no fixture yet (`--reconvert` converts them all again, replacing the fixtures). A file that isn't an export is skipped with a note.
2. Writes `UnitTests/site/replay/` (or `publish <folder>` writes `<folder>/replay/`):
   - `days/<fixture>.json`: one per fixture;
   - `days.json`: the list of days, newest first;
   - `engine.js`: the interpreter and the text of every live script **as they are now**, so every published day replays with your current rules;
   - `index.html`: the viewer.
3. Lists fixtures made by an older `ExportChartData` than the current one (`$X_VERSION`). Export those days again if their replay looks wrong.

`--samples` and `--spread` work as for `replay`. Days whose fixture you delete drop out of the list but stay in the bucket until you delete them there.

On the site:

- **Trades | Replays** at the top switches between the two.
- **Replays** lists the exported days, newest first, with a ticker search (Enter opens the first match). A day with trades in trade-review shows how many fills it has.
- On a replay, your fills for that ticker and day (trade-review's screenshots) are purple circles under their candles (a circle means a screenshot exists for that minute; it doesn't show the side or mark an entry or exit). The details panel lists the fills in the minute you pin, each linking to its screenshot in Trades, and the intro panel lists the day's fills. A screenshot's time is taken as the fill time, on the same clock as DAS's bar times. A fill after the export's last bar isn't shown.
- In Trades, a trade gets a **Replay** button only when a replay exists for its ticker and date. It opens the replay on the hour around the fill, with that minute pinned. If the fill is outside the exported bars, it opens the whole day.

The single-file page from `run.js replay` still works on its own. It has no site navigation and no fills.

---

## Files

| Path | What it is |
|---|---|
| `das/interpreter.js` | Parses and runs DAS script: `$variables`, `if`/`else`, `while`, `return`, expressions, `exechotkey`, `setvar`/`getvar`, `Round`, `SubString`, `StrFind` and so on. Statements that aren't expressions (`CXL ALLSYMB`, `TriggerOrder=RT:STOP ...`, `Speak text;`) are passed to the simulation as montage commands. |
| `das/simdas.js` | The simulated DAS. It builds Chart1, Chart5, ChartDaily, MONTAGE1, LADDER1, the quote, account, buttons and trend lines from a fixture. It records button text and colour, speech and `MsgBox` text. It also keeps an activity log of montage commands and orders in the order sent: `BUY`/`SELL=Send` orders (fractional shares rounded down, as DAS does) and `TriggerOrder` stops with their prices worked out. |
| `das/run.js` | The command-line runner. The test format is described at the top of the file. |
| `das/replay.js` | Replays a fixture minute by minute, for `run.js replay` and the replay page. |
| `das/params.js` | The thresholds the replay page's sliders can change, and the script text each one replaces. |
| `tools/replay_viewer.html` | The replay page. `run.js replay` copies it to `replays/` with the engine (`das/*.js`), the scripts and the fixture filled in. `run.js publish` makes it the site's `replay/index.html`, which loads `engine.js` and one day at a time. |
| `replays/` | Generated charts. Safe to delete; `run.js replay` writes them again. |
| `site/` | The replay part of the trade-review site, written by `run.js publish`. Safe to delete. |
| `tools/convert_das_export.js` | Turns an `ExportChartData` file into a fixture. `run.js publish` uses it for new exports. |
| `exports/` | Raw `ExportChartData` files, kept so fixtures can be rebuilt. |
| `fixtures/*.json` | Market data captured from DAS. They hold data only; the tests live in `tests/`, so converting an export again never loses a test. |
| `tests/*.json` | Hand-written tests. Each file names a default fixture. |
| `snapshots/*.json` | The accepted results of the standard scenarios, one file per fixture. |

`exports/`, `fixtures/`, `snapshots/`, `replays/` and `site/` are in `.gitignore`, so they stay on this computer. The tests in `tests/` need the fixtures they name, so a fresh clone can only run the lint until fixtures are added.

---

## Writing a test

A tests file names a default fixture and lists its tests:

```json
{
  "fixture": "JAGX_20261124_1359",
  "tests": [
    {
      "name": "Entry: armed, stop 11.50 -> buys 9 and places the trigger stop",
      "run": ["DynamicEntry"],
      "vars": { "SETUPARMED": 1 },
      "montage": { "Pos": 0, "Price": 11.5 },
      "expect": {
        "activity": [
          "CXL ALLSYMB",
          "BUY 9 ARCA1L @ 11.85 DAY+",
          "TRIGGER SELL Pos STOP LIMITP stop 11.5 @ 11.45 DAY+"
        ],
        "vars": { "SETUPARMED": 0 }
      }
    }
  ]
}
```

**Setting up a test:**

| Field | Meaning |
|---|---|
| `run` | Hotkeys to run, in order. Use the DAS hotkey name (`"Setup Armed"`) or the filename. |
| `vars` | Variables to set before running. |
| `montage`, `quote`, `account` | Fields to change, such as `{"Pos": 20, "AvgCost": 11.5}` or `{"Realized": -20}`. |
| `second` | `GetSecond()`, in seconds since midnight. |
| `preset` | `false` starts with empty memory. By default a test starts with every variable DAS had in memory at export, so a single script runs the way the dispatcher would run it. |
| `fixture` | Use a different fixture for this test. |

**What to expect** (all optional):

| Field | Checks |
|---|---|
| `vars` | Variable values. Numbers are compared to 4 decimals. |
| `buttons` | Text and colour, such as `{"LADDER1.btn_dip": {"text": "DIP: OK", "bkcolor": "green"}}`. |
| `speech` | The exact list of spoken lines, in order. |
| `speechIncludes` | Lines that must be among those spoken. |
| `activity` | The exact list of montage commands and orders, in order. An empty list means nothing was sent. |
| `orders` | The number of orders sent. |

The activity log uses these forms:

```
CXL ALLSYMB
LockAllMontage Lock
BUY 9 ARCA1L @ 11.85 DAY+
SELL 15 LIMIT @ 11.63
SELL 5 STOP LimitP stop 11.5 @ 11.45
TRIGGER SELL Pos STOP LIMITP stop 11.5 @ 11.45 DAY+
```

To find the values to expect, run the scenario with `run.js run`. Then check the numbers by hand before you copy them into the test.

---

## Capturing a setup from DAS

1. Unpause the tests, open the setup on Chart1 and click the `ExportChartData` button. DAS writes `DASExport_<SYM>`, with the 1-minute bars back to 4 AM (up to 960 bars, to 8 PM).
2. Copy the file to `UnitTests/exports/`. If you'll capture that symbol again, add the time to the name, such as `DASExport_JAGX_1359`.
3. Convert it, then save its first snapshot:
   ```
   node UnitTests/tools/convert_das_export.js UnitTests/exports/DASExport_JAGX
   node UnitTests/das/run.js snapshot JAGX_20261124_1359
   ```
   The converter writes `UnitTests/fixtures/<SYM>_<YYYYMMDD>_<HHMM>.json`. Give a second argument to choose a different output path.

`tools/convert_das_export.js` must match the row layout in the `ExportChartData` hotkey, so change them together. The `ExportChartData` button only calls that hotkey.

---

## Fixture format

- `charts.<Chart>.bars[n]` is `GetBar(-n)`, so `bars[0]` is the latest bar.
- `historyEnded: true` means the chart had no older bars than these.
- Each bar's `studies` holds the `GetStudyVal(..., ByBarNum, -n)` text exactly as DAS returned it, such as `" AVG:0.893\n"`.
- `studies` holds the current numeric study values.
- `variables` holds every other variable in memory. That includes the test scripts' results and the loss counter's realized P&L (`TEMPTOTAL`).

The fixtures also serve as a data set for backtesting setups later. Each one has every 1-minute bar from 4 AM to the export, with its EMA, VWAP and MACD values, so the tests can be replayed bar by bar as if live. Quote fields (RVOL, float, ETB) and the bid and ask are only recorded at the moment of export.

---

## Limits

- **Not confirmed in DAS yet.** The interpreter assumes these (listed at the top of `das/interpreter.js`):
  - an unset variable reads as 0;
  - operators take C-style precedence;
  - `+` joins text when either side is text;
  - `SubString(text, start, end)` has a 0-based start and an exclusive end;
  - text becomes a number by reading its leading number;
  - numbers joined into text show at most 4 decimals.
- **No fills.** The simulation doesn't fill orders, so it can't test what happens after a fill, such as the trigger stop's real quantity.
- **Chart lines** are recorded by name and price only.
- **New DAS functions.** A function the scripts start using must be added to `das/simdas.js`, or the check reports it as unknown.
