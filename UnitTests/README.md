# Unit tests

These tests run the **real script files**, the same text you paste into DAS, outside DAS. `das/` holds a DAS script interpreter written in Node and a simulated DAS. The simulated DAS is built from market data you export from DAS, so the tests check your scripts directly rather than a copy of their logic. You need Node.js only; there are no packages to install.

All commands run from the repo root.

## Contents

- [After changing a script](#after-changing-a-script)
- [What the tests cover](#what-the-tests-cover)
- [Other commands](#other-commands)
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

`run.js check` also lists warnings, such as a variable that is read but never set, which is usually a typo. The check treats a missing `;` as an error even where DAS might accept it.

### 2. Hand-written tests (`tests/*.json`)

| File | What it checks |
|---|---|
| `arming.json` | Presses Setup Armed once for each rule. Each non-negotiable blocks with its own spoken line, and the first rule to fail is the one spoken. Edge values do what the rules say: a price of exactly $20, a float of exactly 20M, volume of exactly 750k and a 4-candle range of exactly $0.30 all arm, and an RVOL of 0 isn't blocked. Each warning is spoken while still arming. The highest-volume candle warning first runs `FindIntradayLevels_1` on the fixture's bars to draw the line. Another test checks that drawing levels leaves `$VOL` (the day's volume) alone. |
| `orders.json` | Entry sizing and the trigger stop, the 25-share cap, the training-account route, and every reason an entry is blocked. Also `TestStop` showing the same share count `DynamicEntry` buys, `SellPortion` and `SellPortionAsk` (in profit, at a loss, flat, and the leftover share on 25 shares), and the loss lockout. |
| `setup.json` | Checks the buttons and the arming result against what DAS showed for JAGX at 13:59, and that RVOL shows "0x" in orange when there's no data. |

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

## Files

| Path | What it is |
|---|---|
| `das/interpreter.js` | Parses and runs DAS script: `$variables`, `if`/`else`, `while`, `return`, expressions, `exechotkey`, `setvar`/`getvar`, `Round`, `SubString`, `StrFind` and so on. Statements that aren't expressions (`CXL ALLSYMB`, `TriggerOrder=RT:STOP ...`, `Speak text;`) are passed to the simulation as montage commands. |
| `das/simdas.js` | The simulated DAS. It builds Chart1, Chart5, ChartDaily, MONTAGE1, LADDER1, the quote, account, buttons and trend lines from a fixture. It records button text and colour, speech and `MsgBox` text. It also keeps an activity log of montage commands and orders in the order sent: `BUY`/`SELL=Send` orders (fractional shares rounded down, as DAS does) and `TriggerOrder` stops with their prices worked out. |
| `das/run.js` | The command-line runner. The test format is described at the top of the file. |
| `tools/convert_das_export.js` | Turns an `ExportChartData` file into a fixture. |
| `exports/` | Raw `ExportChartData` files, kept so fixtures can be rebuilt. |
| `fixtures/*.json` | Market data captured from DAS. They hold data only; the tests live in `tests/`, so converting an export again never loses a test. |
| `tests/*.json` | Hand-written tests. Each file names a default fixture. |
| `snapshots/*.json` | The accepted results of the standard scenarios, one file per fixture. |

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
