#!/usr/bin/env node
// =========================================================
// DAS SCRIPT TEST RUNNER
// =========================================================
//
// node UnitTests/das/run.js test [tests/file.json ...]
//     Everything, in one go. Exit code 1 if anything fails.
//       1. check: every live script parses and passes the lint
//       2. the hand-written tests in UnitTests/tests/*.json
//       3. snapshots: the standard scenarios on every fixture give
//          the same buttons, speech, orders and variables as last
//          time they were accepted (UnitTests/snapshots/)
//
// node UnitTests/das/run.js snapshot [fixture ...]
//     Run the standard scenarios and save the results as the new
//     snapshot, after checking that a change shown by "test" is
//     the one you meant. Prints what changed. Default: all fixtures.
//
// node UnitTests/das/run.js check
//     Only the lint (see lint() below).
//
// node UnitTests/das/run.js run <fixture> <hotkey> [hotkey ...]
//     Run hotkeys on a fixture and print what they did.
//
// node UnitTests/das/run.js compare <fixture>
//     Run the test dispatchers and compare every variable with the
//     value DAS had in memory at export. Checks the interpreter
//     against DAS.
//
// <fixture> is a path or a name in UnitTests/fixtures, such as
// JAGX_20261124_1359.
//
// Options for run and compare:
//   --no-preset           don't load the variables DAS had in memory
//   --second=N            GetSecond() (seconds since midnight)
//   --set NAME=VALUE      set a variable first (repeatable)
//   --montage NAME=VALUE  change a montage field, e.g. Pos=20
//   --quote NAME=VALUE    change a quote field, e.g. Halted=1
//
// A tests file (UnitTests/tests/*.json):
//   { "fixture": "JAGX_20261124_1359",           default for its tests
//     "tests": [ {
//       "name": "...",
//       "fixture": "...",                             optional, per test
//       "run": ["Test_Retracement", "Test_Dip"],     hotkeys, in order
//       "preset": false,                              optional: start with empty memory
//       "vars": { "SETUPARMED": 1 },                  optional: set first
//       "montage": { "Pos": 20, "AvgCost": 11.5 },    optional overrides
//       "quote": { "Halted": 1 },                     optional overrides
//       "account": { "Realized": -50 },               optional overrides
//       "second": 50346,                              optional GetSecond()
//       "expect": {
//         "vars": { "DIPREASON": "Dip Trade OK" },
//         "buttons": { "LADDER1.btn_dip": { "text": "DIP: OK", "bkcolor": "green" } },
//         "speech": ["exact", "list"],  or  "speechIncludes": ["one line"],
//         "activity": ["CXL ALLSYMB", "SELL 15 LIMIT @ 11.63", ...],
//                     every montage command and order, in the order sent
//         "orders": 2 } } ] }
// =========================================================

"use strict";

const fs = require("fs");
const path = require("path");
const { SimDas, indexScripts, REPO_ROOT, HOTKEY_ALIASES, HOST_FUNCTIONS, UNSIMULATED_FUNCTIONS } = require("./simdas");
const { parse, toNum, fmtNum, BUILTINS } = require("./interpreter");

const UNIT_DIR = path.join(__dirname, "..");
const FIXTURE_DIR = path.join(UNIT_DIR, "fixtures");
const TESTS_DIR = path.join(UNIT_DIR, "tests");
const SNAPSHOT_DIR = path.join(UNIT_DIR, "snapshots");

// Called with exechotkey but not in this repo (see README.md)
const KNOWN_MISSING_HOTKEYS = ["catalystbuttoncolor"];


// ---------------------------------------------------------
// Files
// ---------------------------------------------------------

function fixturePath(nameOrPath)
{
    if (fs.existsSync(nameOrPath)) return nameOrPath;
    const p = path.join(FIXTURE_DIR, nameOrPath.replace(/\.json$/, "") + ".json");
    if (fs.existsSync(p)) return p;
    throw new Error("No fixture " + nameOrPath);
}

const fixtureCache = new Map();
function loadFixture(nameOrPath)
{
    const file = fixturePath(nameOrPath);
    if (!fixtureCache.has(file))
    {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (data.format !== "das-export-fixture/1") throw new Error(file + " is not a fixture");
        data.file = path.basename(file, ".json");
        fixtureCache.set(file, data);
    }
    return fixtureCache.get(file);
}

function listJson(dir)
{
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => path.join(dir, f));
}

function rel(file)
{
    return path.relative(REPO_ROOT, file).replace(/\\/g, "/");
}


// ---------------------------------------------------------
// Values
// ---------------------------------------------------------

const NUMBER_TEXT = /^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/;

function sameValue(actual, expected)
{
    if (typeof expected === "number" || typeof actual === "number")
    {
        if (typeof expected === "string" && !NUMBER_TEXT.test(expected)) return false;
        if (typeof actual === "string" && !NUMBER_TEXT.test(actual)) return false;
        const a = toNum(actual), e = toNum(expected);
        // DAS shows at most 4 decimals
        return Math.abs(a - e) <= 0.00005 + 1e-9 * Math.abs(e);
    }
    return actual === expected;
}

function show(v)
{
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}

function parseValue(text)
{
    return /^-?\d*\.?\d+$/.test(text) ? Number(text) : text;
}

function round2(n)
{
    return Math.round(n * 100) / 100;
}


// ---------------------------------------------------------
// Running a scenario: a fixture plus overrides, then hotkeys
// ---------------------------------------------------------

function runScenario(fixture, sc)
{
    const f = {
        ...fixture,
        montage: { ...(fixture.montage || {}), ...(sc.montage || {}) },
        quote: { ...(fixture.quote || {}), ...(sc.quote || {}) },
        account: { ...(fixture.account || {}), ...(sc.account || {}) },
    };
    const sim = new SimDas(f, {
        presetVariables: sc.preset !== false,
        second: sc.second,
        vars: sc.vars || {},
    });
    let error = null;
    try
    {
        for (const h of sc.run) sim.run(h);
    }
    catch (e)
    {
        error = e.message;
    }
    return { sim, r: sim.result(), error };
}

function findButtonKey(buttons, key)
{
    const lower = key.toLowerCase();
    return Object.keys(buttons).find(k => k.toLowerCase() === lower);
}

function checkExpect(sim, r, exp)
{
    const failures = [];
    for (const [k, v] of Object.entries(exp.vars || {}))
    {
        const actual = sim.getVar(k);
        if (!sameValue(actual, v)) failures.push("$" + k + " = " + show(actual) + ", expected " + show(v));
    }
    for (const [key, want] of Object.entries(exp.buttons || {}))
    {
        const got = r.buttons[findButtonKey(r.buttons, key)] || {};
        for (const [prop, v] of Object.entries(want))
        {
            if (got[prop] !== String(v))
            {
                failures.push(key + "." + prop + " = " + show(got[prop]) + ", expected " + show(String(v)));
            }
        }
    }
    if (exp.speech !== undefined && JSON.stringify(r.speech) !== JSON.stringify(exp.speech))
    {
        failures.push("speech = " + JSON.stringify(r.speech) + ", expected " + JSON.stringify(exp.speech));
    }
    for (const s of exp.speechIncludes || [])
    {
        if (!r.speech.includes(s)) failures.push("speech doesn't include " + JSON.stringify(s));
    }
    if (exp.activity !== undefined && JSON.stringify(r.activity) !== JSON.stringify(exp.activity))
    {
        failures.push("activity was:\n" + listOrNone(r.activity) + "\n       expected:\n" + listOrNone(exp.activity));
    }
    if (typeof exp.orders === "number" && r.orders.length !== exp.orders)
    {
        failures.push(r.orders.length + " orders sent, expected " + exp.orders);
    }
    return failures;
}

function listOrNone(list)
{
    return list.length ? list.map(x => "         " + x).join("\n") : "         (nothing)";
}


// ---------------------------------------------------------
// Lint: problems that would break a script in DAS
// ---------------------------------------------------------

// Statements that aren't expressions but are real DAS commands.
// Anything else the parser couldn't read is reported as an error:
// usually a missing ";" (two statements run together) or a typo.
const RAW_COMMANDS = [
    /^\$\w+\.\w+\s+[^=]+$/,                 // $MONTAGE1.CXL ALLSYMB, $MONTAGE1.LockAllMontage Lock
    /^(\$\w+\.)?(TriggerOrder|TIF)\s*=\S/i, // TriggerOrder=RT:STOP ..., TIF=DAY+
    /^Speak\s+\S/i,                         // Speak text (old syntax)
    /^ConfigTrendLine\s+\S/i,
];

function lint()
{
    const scripts = indexScripts(REPO_ROOT);
    const files = [...new Set(scripts.values())].sort();
    const known = new Set([...Object.keys(BUILTINS), ...HOST_FUNCTIONS, ...UNSIMULATED_FUNCTIONS]);
    const errors = [], warnings = [];
    const written = new Set(["CHART1", "CHART5", "CHARTD", "MONTAGE1", "M", "LADDER1"]);
    const reads = [];

    for (const file of files)
    {
        const name = rel(file);
        let ast;
        try
        {
            ast = parse(fs.readFileSync(file, "utf8"), name);
        }
        catch (e)
        {
            errors.push(name + ": " + e.message);
            continue;
        }

        (function visit(n, key)
        {
            if (!n || typeof n !== "object") return;
            if (n.type === "raw")
            {
                const first = n.text.split("\n")[0].slice(0, 70);
                if (n.text.includes("\n"))
                {
                    errors.push(name + ":" + n.line + ": statement runs onto the next line, missing ';'?  " + first);
                }
                else if (!RAW_COMMANDS.some(re => re.test(n.text)))
                {
                    errors.push(name + ":" + n.line + ": can't read this as code, missing ';' or a typo?  " + first);
                }
                for (const m of n.text.matchAll(/\$(\w+)/g)) reads.push([m[1].toUpperCase(), name, n.line]);
            }
            if (n.type === "call")
            {
                const fn = n.name.toLowerCase();
                if (!known.has(fn))
                {
                    errors.push(name + ": unknown function " + n.name + "()  (a typo? if it's a real DAS " +
                        "function, add it to simdas.js)");
                }
                if (fn === "exechotkey" && n.args[0] && n.args[0].type === "lit")
                {
                    const target = String(n.args[0].v);
                    const k = (HOTKEY_ALIASES[target.toLowerCase()] || target).toLowerCase();
                    if (!scripts.has(k))
                    {
                        const msg = name + ": exechotkey(\"" + target + "\") has no script in the repo";
                        (KNOWN_MISSING_HOTKEYS.includes(k) ? warnings : errors).push(msg);
                    }
                }
                if (fn === "setvar" && n.args[0] && n.args[0].type === "lit")
                {
                    written.add(String(n.args[0].v).replace(/^\$/, "").toUpperCase());
                }
            }
            if (n.type === "assign" && n.target.type === "var") written.add(n.target.name);
            if (n.type === "var" && key !== "target") reads.push([n.name, name]);
            for (const k of Object.keys(n)) if (typeof n[k] === "object") visit(n[k], k);
        })(ast);
    }

    // A variable that is read but never set anywhere is usually a typo
    const seen = new Set();
    for (const [v, file] of reads)
    {
        if (written.has(v) || seen.has(v + file)) continue;
        seen.add(v + file);
        warnings.push(file + ": $" + v + " is read but never set by any script (a typo?)");
    }
    return { count: files.length, errors, warnings };
}

function printLint(result)
{
    for (const e of result.errors) console.log("ERROR " + e);
    for (const w of result.warnings) console.log("warn  " + w);
    console.log("check: " + result.count + " scripts, " + result.errors.length + " errors, " +
        result.warnings.length + " warnings");
}


// ---------------------------------------------------------
// Snapshots: the same scenarios on every fixture
// ---------------------------------------------------------

// Start as if the symbol had just been loaded: empty memory, so
// every test computes its result from the fixture's data.
const FRESH = {
    preset: false,
    vars: { RUNTESTSENABLED: 1 },
};
const ALL_TESTS = ["RunTests_Dispatch", "RunTests_Dispatch", "RunTests_ChartUpdate"];

const SCENARIOS = [
    {
        name: "All tests",
        // 1st dispatch: symbol change + new candle; 2nd: the 1-second tests
        make: () => ({ ...FRESH, run: ALL_TESTS }),
    },
    {
        name: "Arm",
        make: () => ({ ...FRESH, run: [...ALL_TESTS, "Setup Armed"] }),
    },
    {
        name: "Entry, armed, stop 20c below bid",
        make: (f) => ({
            vars: { SETUPARMED: 1 },
            montage: { Pos: 0, Price: round2(f.montage.Bid - 0.20) },
            run: ["DynamicEntry"],
        }),
    },
    {
        name: "SellPortion, 20 shares in profit",
        make: (f) => ({ montage: { Pos: 20, AvgCost: round2(f.montage.Bid - 0.20) }, run: ["SellPortion"] }),
    },
    {
        name: "SellPortionAsk, 20 shares in profit",
        make: (f) => ({ montage: { Pos: 20, AvgCost: round2(f.montage.Bid - 0.20) }, run: ["SellPortionAsk"] }),
    },
    {
        name: "SellPortionAsk, 20 shares at a loss",
        make: (f) => ({ montage: { Pos: 20, AvgCost: round2(f.montage.Bid + 0.20) }, run: ["SellPortionAsk"] }),
    },
];

function takeSnapshot(fixture)
{
    const snap = {};
    for (const s of SCENARIOS)
    {
        const { r, error } = runScenario(fixture, s.make(fixture));
        const buttons = {};
        for (const k of Object.keys(r.buttons).sort()) buttons[k] = r.buttons[k];
        const vars = {};
        for (const k of Object.keys(r.assigned).sort())
        {
            const v = r.assigned[k];
            vars[k] = typeof v === "number" ? Number(fmtNum(v)) : v;
        }
        snap[s.name] = {
            error,
            buttons,
            speech: r.speech,
            activity: r.activity,
            messages: r.messages,
            lines: [...r.lines].sort(),
            warnings: r.warnings,
            vars,
        };
    }
    return snap;
}

function snapshotPath(fixture)
{
    return path.join(SNAPSHOT_DIR, fixture.file + ".json");
}

// Flatten to "scenario | section | key" -> text, for diffs
function flatten(snap)
{
    const out = new Map();
    for (const [sc, data] of Object.entries(snap))
    {
        for (const [section, val] of Object.entries(data))
        {
            if (val === null || val === undefined) continue;
            if (Array.isArray(val))
            {
                if (val.length) out.set(sc + " | " + section, val.join("  /  "));
            }
            else if (typeof val === "object")
            {
                for (const [k, v] of Object.entries(val))
                {
                    if (v && typeof v === "object")
                    {
                        for (const [p, x] of Object.entries(v)) out.set(sc + " | " + k + "." + p, show(x));
                    }
                    else out.set(sc + " | $" + k, show(v));
                }
            }
            else out.set(sc + " | " + section, show(val));
        }
    }
    return out;
}

// Most important first: errors, orders, buttons, speech, then variables
function diffSnapshots(before, after)
{
    const a = flatten(before), b = flatten(after);
    const lines = [];
    for (const k of new Set([...a.keys(), ...b.keys()]))
    {
        if (a.get(k) === b.get(k)) continue;
        const rank = /\| error/.test(k) ? 0 : /\| activity/.test(k) ? 1 : /\| \$/.test(k) ? 4
            : /\| speech|\| messages/.test(k) ? 3 : 2;
        const text = !a.has(k) ? k + ": (new) " + b.get(k)
            : !b.has(k) ? k + ": " + a.get(k) + " -> (gone)"
            : k + ": " + a.get(k) + " -> " + b.get(k);
        lines.push([rank, text]);
    }
    return lines.sort((x, y) => x[0] - y[0]).map(x => x[1]);
}

function printDiff(diff, max)
{
    for (const line of diff.slice(0, max)) console.log("       " + line);
    if (diff.length > max) console.log("       ... and " + (diff.length - max) + " more");
}


// ---------------------------------------------------------
// Options
// ---------------------------------------------------------

function parseOptions(args)
{
    const opts = { vars: {}, montage: {}, quote: {}, rest: [] };
    for (let i = 0; i < args.length; i++)
    {
        const a = args[i];
        const pair = (target) =>
        {
            const [k, ...v] = (args[++i] || "").split("=");
            target[k.replace(/^\$/, "")] = parseValue(v.join("="));
        };
        if (a === "--no-preset") opts.preset = false;
        else if (a.startsWith("--second=")) opts.second = Number(a.slice(9));
        else if (a === "--set") pair(opts.vars);
        else if (a === "--montage") pair(opts.montage);
        else if (a === "--quote") pair(opts.quote);
        else opts.rest.push(a);
    }
    return opts;
}


// ---------------------------------------------------------
// Commands
// ---------------------------------------------------------

function cmdRun(args)
{
    const opts = parseOptions(args);
    const [file, ...hotkeys] = opts.rest;
    if (!file || !hotkeys.length)
    {
        console.error("Usage: run.js run <fixture> <hotkey> [hotkey ...]");
        return 1;
    }
    const { r, error } = runScenario(loadFixture(file), { ...opts, run: hotkeys });

    console.log("Variables set:");
    for (const k of Object.keys(r.assigned).sort()) console.log("  $" + k + " = " + show(r.assigned[k]));
    console.log("Buttons:");
    for (const [k, v] of Object.entries(r.buttons).sort())
    {
        console.log("  " + k + ": " + [v.text !== undefined ? "text=" + JSON.stringify(v.text) : "",
            v.bkcolor !== undefined ? "bkcolor=" + v.bkcolor : ""].filter(Boolean).join(" "));
    }
    if (r.speech.length) console.log("Speech:\n" + r.speech.map(s => "  " + JSON.stringify(s)).join("\n"));
    if (r.activity.length) console.log("Orders and montage commands, in order:\n" + r.activity.map(c => "  " + c).join("\n"));
    if (r.messages.length) console.log("MsgBox:\n" + r.messages.map(m => "  " + JSON.stringify(m)).join("\n"));
    if (r.lines.length) console.log("Chart1 lines: " + r.lines.join(", "));
    if (r.warnings.length) console.log("Warnings:\n" + r.warnings.map(w => "  " + w).join("\n"));
    if (error) { console.log("ERROR: " + error); return 1; }
    return 0;
}

function cmdCompare(args)
{
    const opts = parseOptions(args);
    if (!opts.rest[0])
    {
        console.error("Usage: run.js compare <fixture>");
        return 1;
    }
    const fixture = loadFixture(opts.rest[0]);
    if (!fixture.capture || !fixture.capture.testsRunning)
    {
        console.log("Note: the tests weren't running at export, so DAS's values may be stale.");
    }
    const { r, error } = runScenario(fixture, { ...opts, run: ["RunTests_Dispatch", "RunTests_ChartUpdate"] });
    if (error) { console.log("ERROR: " + error); return 1; }
    const recorded = fixture.variables || {};

    const match = [], differ = [], unrecorded = [];
    for (const k of Object.keys(r.assigned).sort())
    {
        if (!(k in recorded)) unrecorded.push(k);
        else if (sameValue(r.assigned[k], recorded[k])) match.push(k);
        else differ.push(k);
    }

    console.log(fixture.name + ": " + match.length + " match, " + differ.length +
        " differ, " + unrecorded.length + " not in the export");
    if (differ.length)
    {
        console.log("Different from DAS (script result vs DAS memory):");
        for (const k of differ) console.log("  $" + k + ": " + show(r.assigned[k]) + "  vs DAS " + show(recorded[k]));
    }
    if (unrecorded.length) console.log("Not in the export: " + unrecorded.map(k => "$" + k).join(", "));
    if (r.warnings.length) console.log("Warnings:\n" + r.warnings.map(w => "  " + w).join("\n"));
    return 0;
}

function cmdCheck()
{
    const result = lint();
    printLint(result);
    return result.errors.length ? 1 : 0;
}

function runTestFiles(files)
{
    let pass = 0, fail = 0;
    for (const file of files)
    {
        let suite;
        try { suite = JSON.parse(fs.readFileSync(file, "utf8")); }
        catch (e) { console.log("FAIL " + rel(file) + ": " + e.message); fail++; continue; }

        for (const test of suite.tests || [])
        {
            const label = path.basename(file, ".json") + " | " + test.name;
            try
            {
                const fixture = loadFixture(test.fixture || suite.fixture);
                const { sim, r, error } = runScenario(fixture, test);
                const failures = error ? ["ERROR " + error] : checkExpect(sim, r, test.expect || {});
                if (failures.length)
                {
                    fail++;
                    console.log("FAIL " + label);
                    for (const f of failures) console.log("       " + f);
                }
                else
                {
                    pass++;
                    console.log("PASS " + label);
                }
            }
            catch (e)
            {
                fail++;
                console.log("FAIL " + label + ": " + e.message);
            }
        }
    }
    return { pass, fail };
}

function runSnapshots()
{
    let pass = 0, fail = 0;
    for (const file of listJson(FIXTURE_DIR))
    {
        const fixture = loadFixture(file);
        const sp = snapshotPath(fixture);
        if (!fs.existsSync(sp))
        {
            fail++;
            console.log("FAIL snapshot " + fixture.file + ": none saved yet, run: node UnitTests/das/run.js snapshot " + fixture.file);
            continue;
        }
        const diff = diffSnapshots(JSON.parse(fs.readFileSync(sp, "utf8")), takeSnapshot(fixture));
        if (diff.length)
        {
            fail++;
            console.log("FAIL snapshot " + fixture.file + ": " + diff.length + " differences");
            printDiff(diff, 25);
        }
        else
        {
            pass++;
            console.log("PASS snapshot " + fixture.file + " (" + SCENARIOS.length + " scenarios)");
        }
    }
    return { pass, fail };
}

function cmdTest(args)
{
    const opts = parseOptions(args);
    const onlyFiles = opts.rest.length > 0;

    const lintResult = lint();
    for (const e of lintResult.errors) console.log("ERROR " + e);
    console.log((lintResult.errors.length ? "FAIL" : "PASS") + " check: " + lintResult.count + " scripts, " +
        lintResult.errors.length + " errors, " + lintResult.warnings.length +
        " warnings (run.js check to list them)\n");

    const t = runTestFiles(onlyFiles ? opts.rest : listJson(TESTS_DIR));
    const s = onlyFiles ? { pass: 0, fail: 0 } : (console.log(""), runSnapshots());

    const failed = t.fail + s.fail + (lintResult.errors.length ? 1 : 0);
    console.log("\n" + (t.pass + s.pass) + " passed, " + failed + " failed");
    if (s.fail)
    {
        console.log("If a snapshot change is what you intended, accept it with: node UnitTests/das/run.js snapshot");
    }
    return failed ? 1 : 0;
}

function cmdSnapshot(args)
{
    const files = args.length ? args.map(fixturePath) : listJson(FIXTURE_DIR);
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    for (const file of files)
    {
        const fixture = loadFixture(file);
        const sp = snapshotPath(fixture);
        const snap = takeSnapshot(fixture);
        if (fs.existsSync(sp))
        {
            const diff = diffSnapshots(JSON.parse(fs.readFileSync(sp, "utf8")), snap);
            console.log(fixture.file + ": " + (diff.length ? diff.length + " changes saved" : "no changes"));
            printDiff(diff, 100);
        }
        else
        {
            console.log(fixture.file + ": new snapshot");
        }
        for (const [name, sc] of Object.entries(snap))
        {
            if (sc.error) console.log("  warning: scenario \"" + name + "\" stopped with an error: " + sc.error);
        }
        fs.writeFileSync(sp, JSON.stringify(snap, null, 2) + "\n");
    }
    return 0;
}


// ---------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const commands = { run: cmdRun, compare: cmdCompare, test: cmdTest, check: cmdCheck, snapshot: cmdSnapshot };
if (!commands[command])
{
    console.error("Usage: node UnitTests/das/run.js <test|snapshot|check|run|compare> ...  (see the top of run.js)");
    process.exit(1);
}
process.exit(commands[command](rest));
