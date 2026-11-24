// =========================================================
// CONVERT A DAS EXPORT INTO A TEST FIXTURE
// =========================================================
//
// Reads a file written by the ExportChartData hotkey
// (SaveVarToFile: one `$name=value;` per line, in no
// particular order) and writes a JSON fixture.
//
// Usage:
//   node UnitTests/tools/convert_das_export.js <export-file> [output.json]
//
// Default output: UnitTests/fixtures/<SYM>_<YYYYMMDD>_<HHMM>.json
// Keep the raw export in UnitTests/exports/ so the fixture can be
// rebuilt if this converter changes. Fixtures hold data only: the
// tests that use them are in UnitTests/tests/, so converting again
// never loses a test.
//
// Fixture layout:
//   charts.<Chart>.bars[n] is GetBar(-n): bars[0] is the latest bar.
//   Bar fields use the DAS names (Time, Open, Hi, Lo, Close, Volume).
//   bars[n].studies holds GetStudyVal(name, ByBarNum, -n) exactly as
//   DAS returned it, e.g. " AVG:0.893\n".
//   studies holds the current numeric values (GetStudyVal without
//   ByBarNum), per window, plus "bare" for calls with no window.
//   variables holds every other variable that was in memory, which
//   includes the test scripts' results if the tests were running.
// =========================================================

const fs = require("fs");
const path = require("path");

// Field order of each row, matching ExportChartData
const ROW_LAYOUT = {
    Chart1: {
        prefix: "B1",
        countVar: "NBARS1",
        studies: ["Study9EMA", "Study20EMA", "Study200EMA", "StudyVWAP", "StudyMACD"],
    },
    Chart5: {
        prefix: "B5",
        countVar: "NBARS5",
        studies: ["Study9EMA"],
    },
    ChartDaily: {
        prefix: "BD",
        countVar: "NBARSD",
        studies: ["StudyD200SMA", "StudyD200EMA", "StudyD9EMA", "StudyD20EMA"],
    },
};

const MONTAGE_FIELDS = {
    M_BID: "Bid", M_ASK: "Ask", M_LAST: "Last", M_HI: "Hi", M_LO: "Lo",
    M_PRICE: "Price", M_POS: "Pos", M_AVGCOST: "AvgCost",
};

const QUOTE_FIELDS = {
    Q_LAST: "Last", Q_VOLUME: "Volume", Q_YCLOSE: "yClose", Q_RVOL: "RVOL",
    Q_FLOAT: "float", Q_ETB: "ETB", Q_HTB: "HTB", Q_SSR: "SSR",
    Q_HALTED: "Halted", Q_COMPANY: "CompanyName", Q_SECTOR: "Sector",
};

// Current study values (export version 2 and later)
const STUDY_FIELDS = {
    S1_BAR: ["Chart1", "StudyBar"],
    S1_EMA9: ["Chart1", "Study9EMA"],
    S1_EMA20: ["Chart1", "Study20EMA"],
    S1_EMA200: ["Chart1", "Study200EMA"],
    S1_VWAP: ["Chart1", "StudyVWAP"],
    S5_EMA9: ["Chart5", "Study9EMA"],
    SD_200SMA: ["ChartDaily", "StudyD200SMA"],
    SD_200EMA: ["ChartDaily", "StudyD200EMA"],
    SD_9EMA: ["ChartDaily", "StudyD9EMA"],
    SD_20EMA: ["ChartDaily", "StudyD20EMA"],
    SB_BAR: ["bare", "StudyBar"],
    SB_EMA9: ["bare", "Study9EMA"],
    SB_EMA20: ["bare", "Study20EMA"],
    SB_EMA200: ["bare", "Study200EMA"],
    SB_VWAP: ["bare", "StudyVWAP"],
};


// ---------------------------------------------------------
// Parse `$NAME=value;` lines. Names are upper-cased because
// DAS variables are not case-sensitive.
// ---------------------------------------------------------
function parseExport(text)
{
    const vars = {};
    for (const rawLine of text.split(/\r?\n/))
    {
        const line = rawLine.trim();
        if (!line) continue;

        const m = line.match(/^\$([A-Za-z0-9_]+)=(.*);$/);
        if (!m)
        {
            console.warn("Skipping unrecognised line: " + line.slice(0, 80));
            continue;
        }
        vars[m[1].toUpperCase()] = parseValue(m[2]);
    }
    return vars;
}

function parseValue(raw)
{
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))
    {
        return raw.slice(1, -1).replace(/\\(.)/g, (_, c) =>
            c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c);
    }
    if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(raw)) return Number(raw);
    return raw;
}

function toNumber(text)
{
    const n = Number(text);
    return Number.isNaN(n) ? text : n;
}


// ---------------------------------------------------------
// Build bars for one chart. Reads X_<prefix>_0 .. X_<prefix>_<count>
// and stops at the first missing index.
// ---------------------------------------------------------
function buildBars(vars, layout)
{
    const count = vars["X_" + layout.countVar];
    const bars = [];

    for (let i = 0; count === undefined || i <= count; i++)
    {
        const row = vars["X_" + layout.prefix + "_" + i];
        if (row === undefined) break;

        const fields = String(row).split("|");

        // Past the start of the chart's history, DAS returns an empty bar
        // (Time "", prices 0, studies "0"). Older exports kept going.
        if (fields[0] === "" && Number(fields[4]) === 0)
        {
            bars.historyEnded = true;
            break;
        }

        const expected = 6 + layout.studies.length;
        if (fields.length !== expected)
        {
            throw new Error(
                "X_" + layout.prefix + "_" + i + " has " + fields.length +
                " fields, expected " + expected);
        }

        const studies = {};
        layout.studies.forEach((name, k) => { studies[name] = fields[6 + k]; });

        bars.push({
            Time: fields[0],
            Open: toNumber(fields[1]),
            Hi: toNumber(fields[2]),
            Lo: toNumber(fields[3]),
            Close: toNumber(fields[4]),
            Volume: toNumber(fields[5]),
            studies,
        });
    }

    if (count !== undefined && bars.length !== count + 1 && !bars.historyEnded)
    {
        console.warn(
            "Expected " + (count + 1) + " bars for X_" + layout.prefix +
            " but found " + bars.length);
    }
    return bars;
}


// ---------------------------------------------------------
// Build the fixture
// ---------------------------------------------------------
function buildFixture(vars)
{
    const symbol = vars.X_SYMBOL;
    if (!symbol) throw new Error("No $X_SYMBOL: is this an ExportChartData file?");

    const charts = {};
    for (const [chart, layout] of Object.entries(ROW_LAYOUT))
    {
        const bars = buildBars(vars, layout);
        // historyEnded: the chart had no older bars than these.
        // Export v3+ sets $X_END1 when it stops at the start of Chart1's history.
        const ended = !!bars.historyEnded || (chart === "Chart1" && vars.X_END1 === 1);
        charts[chart] = { historyEnded: ended, bars };
    }

    const montage = {};
    for (const [key, field] of Object.entries(MONTAGE_FIELDS))
    {
        if (("X_" + key) in vars) montage[field] = vars["X_" + key];
    }
    montage.Symb = symbol;

    const quote = {};
    for (const [key, field] of Object.entries(QUOTE_FIELDS))
    {
        if (("X_" + key) in vars) quote[field] = vars["X_" + key];
    }

    const studies = {};
    for (const [key, [chart, study]] of Object.entries(STUDY_FIELDS))
    {
        if (!(("X_" + key) in vars)) continue;
        studies[chart] = studies[chart] || {};
        studies[chart][study] = vars["X_" + key];
    }

    // Everything that isn't part of the export itself
    const variables = {};
    for (const name of Object.keys(vars).sort())
    {
        if (!name.startsWith("X_")) variables[name] = vars[name];
    }

    const barTime = String(vars.X_BARTIME || "");
    return {
        format: "das-export-fixture/1",
        name: symbol + " " + barTime,
        symbol,
        capture: {
            exportVersion: vars.X_VERSION,
            getSecond: vars.X_SECOND,
            barTime,
            testsRunning: vars.X_RUNTESTS === 1,
        },
        montage,
        quote,
        studies,
        charts,
        variables,
    };
}

function defaultOutputPath(fixture)
{
    // "20261124 13:37:00" -> "20261124_1337"
    const m = fixture.capture.barTime.match(/^(\d{8}) (\d{2}):(\d{2})/);
    const stamp = m ? m[1] + "_" + m[2] + m[3] : "unknown";
    return path.join(__dirname, "..", "fixtures", fixture.symbol + "_" + stamp + ".json");
}


// ---------------------------------------------------------
// Main
// ---------------------------------------------------------
function main()
{
    const input = process.argv[2];
    if (!input)
    {
        console.error("Usage: node convert_das_export.js <export-file> [output.json]");
        process.exit(1);
    }

    const vars = parseExport(fs.readFileSync(input, "utf8"));
    const fixture = buildFixture(vars);
    const output = process.argv[3] || defaultOutputPath(fixture);

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(fixture, null, 2) + "\n");

    const c = fixture.charts;
    console.log("Wrote " + output);
    console.log(
        "  " + fixture.symbol + " at " + fixture.capture.barTime +
        ": Chart1 " + c.Chart1.bars.length +
        ", Chart5 " + c.Chart5.bars.length +
        ", ChartDaily " + c.ChartDaily.bars.length + " bars; " +
        Object.keys(fixture.variables).length + " other variables");
    console.log("  Next: node UnitTests/das/run.js snapshot " + path.basename(output, ".json"));
    if (!fixture.capture.testsRunning)
    {
        console.log("  Note: tests were not running, so test results aren't in 'variables'.");
    }
}

if (require.main === module)
{
    main();
}

module.exports = { parseExport, buildFixture };
