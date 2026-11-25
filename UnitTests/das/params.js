// =========================================================
// ADJUSTABLE THRESHOLDS FOR THE REPLAY
// =========================================================
//
// The strategy thresholds the replay can change, and where each
// one is written in the scripts. Changing one swaps the number in
// the script text before it runs; the live files aren't touched.
//
// Each edit names a script, the exact text to find (it must occur
// exactly once), cond(limit) that writes the rule's condition for
// one limit, and make(condition) that writes the replacement text.
// "run.js test" checks every edit still matches, so if a script
// changes, update the matching edit here.
//
// A setting is { mode, value, pct }. Params with "percent" can use
// every mode; the others only "$":
//   "$"    the dollar limit:        $AverageRange4 > 0.3
//   "%"    a percent of the price:  $AverageRange4 > ($MPRICE*0.06)
//   "and"  both must be true:       ($AverageRange4 > 0.3 && $AverageRange4 > ($MPRICE*0.06))
//   "or"   either is enough:        ($AverageRange4 > 0.3 || $AverageRange4 > ($MPRICE*0.06))
// For a limit that blocks when exceeded, "and" is looser than either
// limit alone and "or" is stricter.
//
// "instant" params only edit SpeakTestResults, so the viewer can
// re-score Setup Armed without replaying the tests. The others
// edit a test script that runs every second, so the viewer
// replays the day again after the slider is released.
// =========================================================

"use strict";

const PARAMS = [
    // ---- Blockers ----
    {
        id: "maxPrice", group: "Blockers", label: "Stock is too expensive", unit: "$",
        default: 20, min: 1, max: 50, step: 0.5,
        help: "Blocks when the price is above this.",
        edits: [{ script: "SpeakTestResults", find: "if($MPRICE>20){", cond: r => "$MPRICE>" + r, make: c => "if(" + c + "){" }],
    },
    {
        id: "maxFloat", group: "Blockers", label: "Float too high", unit: "M shares",
        default: 20, min: 1, max: 100, step: 1,
        help: "Blocks when the float is above this many million shares.",
        edits: [{ script: "SpeakTestResults", find: "if($Float>20){", cond: r => "$Float>" + r, make: c => "if(" + c + "){" }],
    },
    {
        id: "minGap", group: "Blockers", label: "Gap less than", unit: "%",
        default: 10, min: 0, max: 100, step: 1,
        help: "Blocks when the gap from yesterday's close is at or below this.",
        edits: [{ script: "SpeakTestResults", find: "if($GAP<=10){", cond: r => "$GAP<=" + r, make: c => "if(" + c + "){" }],
    },
    {
        id: "rng4Block", group: "Blockers", label: "Candle range too large: 4-candle average", unit: "% of price",
        default: 25, min: 5, max: 60, step: 1,
        help: "Blocks when the average range of the last 4 candles is above this % of the price ($Rng4Pct).",
        edits: [
            { script: "SpeakTestResults", find: "if($Rng4Pct > 25){", cond: r => "$Rng4Pct > " + r, make: c => "if(" + c + "){" },
            { script: "TestExtended", find: "$Rng4Pct > 25 ||", cond: r => "$Rng4Pct > " + r, make: c => c + " ||" },
        ],
    },
    {
        id: "spikeMult", group: "Blockers", label: "Candle is too large for this stock: size vs the 8 before", unit: "x or more",
        default: 2.5, min: 1, max: 6, step: 0.1,
        help: "The bigger of the last two candles (the forming one and the one before) compared with the average range of the 8 candles before them ($SpikeMultiple). Blocks only when the % of price below is also met.",
        edits: [
            { script: "SpeakTestResults", find: "$SpikeMultiple >= 2.5 &&", cond: r => "$SpikeMultiple >= " + r, make: c => c + " &&" },
            { script: "TestExtended", find: "$SpikeMultiple >= 2.5 &&", cond: r => "$SpikeMultiple >= " + r, make: c => c + " &&" },
        ],
    },
    {
        id: "spikePct", group: "Blockers", label: "Candle is too large for this stock: and at least", unit: "% of price",
        default: 8, min: 1, max: 40, step: 0.5,
        help: "The same candle must also be at least this % of the price ($SpikePct), so a big jump after quiet, tiny candles doesn't block.",
        edits: [
            { script: "SpeakTestResults", find: "$SpikePct >= 8)", cond: r => "$SpikePct >= " + r, make: c => c + ")" },
            { script: "TestExtended", find: "$SpikePct >= 8)", cond: r => "$SpikePct >= " + r, make: c => c + ")" },
        ],
    },
    {
        id: "minVolume", group: "Blockers", label: "Volume too low", unit: "shares",
        default: 750000, min: 0, max: 5000000, step: 50000,
        help: "Blocks while today's volume is below this.",
        edits: [{ script: "SpeakTestResults", find: "if($VOL < 750000){", cond: r => "$VOL < " + r, make: c => "if(" + c + "){" }],
    },
    {
        id: "nearHigh", group: "Blockers", label: "Price is too close to the highs", unit: "$",
        default: 0.1, min: 0, max: 0.5, step: 0.01,
        percent: { default: 2, min: 0, max: 15, step: 0.25 },
        help: "Blocks when the price is within this distance of the day's high.",
        edits: [{ script: "SpeakTestResults", find: "$MONTAGE1.Hi-.10 <= $MPRICE", cond: r => "$MONTAGE1.Hi-" + r + " <= $MPRICE", make: c => c }],
    },
    {
        id: "curlRvol", group: "Blockers", label: "Below VWAP: curl needs short-term RVOL of", unit: "x",
        default: 1, min: 0, max: 3, step: 0.1,
        help: "Below VWAP, arming needs a curl. Test_Curl gives a caution (which blocks below VWAP) when the last 10 candles' relative volume is under this.",
        edits: [{ script: "Test_Curl", find: "if($ST_RVOL10 < 1.0)", cond: r => "$ST_RVOL10 < " + r, make: c => "if(" + c + ")" }],
    },

    // ---- Warnings ----
    {
        id: "rng4Warn", group: "Warnings", label: "Candles have large range: 4-candle average", unit: "% of price",
        default: 10, min: 1, max: 40, step: 0.5,
        help: "Warns (and colours the range button orange) when the 4-candle average range is above this % of the price.",
        edits: [
            { script: "SpeakTestResults", find: "if($Rng4Pct > 10){", cond: r => "$Rng4Pct > " + r, make: c => "if(" + c + "){" },
            { script: "TestExtended", find: "if($Rng4Pct > 10){", cond: r => "$Rng4Pct > " + r, make: c => "if(" + c + "){" },
        ],
    },
    {
        id: "extMult", group: "Warnings", label: "Stock may be extended", unit: "x Rng10 above the 9 EMA",
        default: 4, min: 1, max: 10, step: 0.25,
        help: "Warns when the price is more than this many 10-candle average ranges above the 9 EMA.",
        edits: [{ script: "TestExtended", find: "$ExtensionMultiplier=4;", cond: r => r, make: c => "$ExtensionMultiplier=" + c + ";" }],
    },
    {
        id: "expensive", group: "Warnings", label: "Stock is expensive", unit: "$",
        default: 10, min: 1, max: 50, step: 0.5,
        help: "Warns when the price is above this.",
        edits: [{ script: "SpeakTestResults", find: "if($MPRICE>10){", cond: r => "$MPRICE>" + r, make: c => "if(" + c + "){" }],
    },
];

// Edits the replay always makes, because it can't check the rule.
// RVOL: the live rule uses the higher of TestRVOL's own figure and
// DAS's RVOL, which seems adjusted for time of day. The export only
// has DAS's RVOL at the moment of export, so the replay can't tell
// whether the rule passed earlier in the day. The live scripts keep it.
const REPLAY_EDITS = [
    {
        id: "rvolOff", script: "SpeakTestResults",
        find: "if($RVOL>0 && $RVOL<=5){", make: () => "if(0 && $RVOL>0 && $RVOL<=5){",
    },
];

for (const p of PARAMS) p.instant = p.edits.every(e => e.script === "SpeakTestResults");

const byId = new Map(PARAMS.map(p => [p.id, p]));

function numText(x)
{
    return String(Math.round(x * 1e6) / 1e6);
}

const MODES = ["$", "%", "and", "or"];

// A full setting, with defaults filled in
function normalize(p, s)
{
    s = s || {};
    if (p.kind === "rule")
    {
        const out = { on: !!s.on };
        for (const fl of p.fields) out[fl.key] = s[fl.key] !== undefined ? Number(s[fl.key]) : fl.default;
        return out;
    }
    const mode = p.percent && MODES.includes(s.mode) ? s.mode : "$";
    return {
        mode,
        value: s.value !== undefined ? Number(s.value) : p.default,
        pct: s.pct !== undefined ? Number(s.pct) : (p.percent ? p.percent.default : 0),
    };
}

// The replacement text for one edit
function editText(p, e, setting)
{
    const s = normalize(p, setting);
    if (p.kind === "rule") return s.on ? e.rule(s) : e.find;
    const dollars = e.cond(numText(s.value));
    const pct = () => e.cond("($MPRICE*" + numText(s.pct / 100) + ")");
    if (s.mode === "%") return e.make(pct());
    if (s.mode === "and") return e.make("(" + dollars + " && " + pct() + ")");
    if (s.mode === "or") return e.make("(" + dollars + " || " + pct() + ")");
    return e.make(dollars);
}

function isDefault(p, s)
{
    if (!s) return true;
    const n = normalize(p, s);
    if (p.kind === "rule") return !n.on;
    return n.mode === "$" && n.value === p.default;
}

// settings: { id: { value, mode } }. Returns transform(file, source)
// for SimDas, plus any edit that no longer matches its script.
function makeTransform(settings)
{
    const problems = [];
    const active = PARAMS.filter(p => settings[p.id] && !isDefault(p, settings[p.id]))
        .sort((a, b) => (b.kind === "rule") - (a.kind === "rule"));
    function transform(file, source)
    {
        const name = String(file).split("/").pop();
        let out = source;
        for (const e of REPLAY_EDITS)
        {
            if (e.script.toLowerCase() !== name.toLowerCase()) continue;
            const n = out.split(e.find).length - 1;
            if (n !== 1) { problems.push(e.id + ": \"" + e.find + "\" found " + n + " times in " + e.script); continue; }
            out = out.replace(e.find, () => e.make());
        }
        for (const p of active)
        {
            for (const e of p.edits)
            {
                if (e.script.toLowerCase() !== name.toLowerCase()) continue;
                const n = out.split(e.find).length - 1;
                if (n !== 1)
                {
                    problems.push(p.id + ": \"" + e.find + "\" found " + n + " times in " + e.script);
                    continue;
                }
                out = out.replace(e.find, () => editText(p, e, settings[p.id]));
            }
        }
        return out;
    }
    return { transform, problems };
}

// "nearHigh=0.1", "nearHigh=2%", "nearHigh=0.1and2%" or
// "nearHigh=0.1or2%" -> settings entry
function parseSetting(text)
{
    const r = String(text).match(/^(\w+)=(on|[\d.]+(?:,[\d.]+)*)$/);
    if (r && byId.has(r[1]) && byId.get(r[1]).kind === "rule")
    {
        const p = byId.get(r[1]);
        const s = { on: true };
        if (r[2] !== "on") r[2].split(",").forEach((v, i) => { if (p.fields[i]) s[p.fields[i].key] = Number(v); });
        return [p.id, s];
    }
    const m = String(text).match(/^(\w+)=(?:([\d.]+)(and|or))?([\d.]+)(%?)$/);
    if (!m || !byId.has(m[1])) throw new Error("Unknown --param " + text + " (names: " + PARAMS.map(p => p.id).join(", ") +
        "; values like 0.1, 2%, 0.1and2% or 0.1or2%)");
    const p = byId.get(m[1]);
    if ((m[5] || m[3]) && !p.percent) throw new Error(p.id + " has no % mode");
    if (m[3])
    {
        if (!m[5]) throw new Error(text + ": write the second value as a percent, e.g. 0.1and2%");
        return [m[1], { mode: m[3], value: Number(m[2]), pct: Number(m[4]) }];
    }
    if (m[5]) return [m[1], { mode: "%", value: p.default, pct: Number(m[4]) }];
    return [m[1], { mode: "$", value: Number(m[4]) }];
}

// settings entry -> the text parseSetting reads
function settingText(p, s)
{
    const n = normalize(p, s);
    if (p.kind === "rule") return p.fields.map(fl => n[fl.key]).join(",");
    if (n.mode === "%") return n.pct + "%";
    if (n.mode === "and" || n.mode === "or") return n.value + n.mode + n.pct + "%";
    return String(n.value);
}

// Every edit must match its script exactly once.
// readSource(scriptName) -> text, or null if missing.
function checkParams(readSource)
{
    const errors = [];
    for (const e of REPLAY_EDITS)
    {
        const src = readSource(e.script);
        const n = src === null ? 0 : src.split(e.find).length - 1;
        if (n !== 1) errors.push(e.id + ": \"" + e.find + "\" found " + n + " times in " + e.script +
            " (update UnitTests/das/params.js to match the script)");
    }
    for (const p of PARAMS)
    {
        for (const e of p.edits)
        {
            const src = readSource(e.script);
            if (src === null) { errors.push(p.id + ": no script " + e.script); continue; }
            const n = src.split(e.find).length - 1;
            if (n !== 1) errors.push(p.id + ": \"" + e.find + "\" found " + n + " times in " + e.script +
                " (update UnitTests/das/params.js to match the script)");
        }
    }
    return errors;
}

// SpeakTestResults with every "return;" removed, so it speaks every
// rule that fails instead of stopping at the first blocker. Used to
// show masked rules; never to decide whether arming is allowed.
function allRulesSource(source)
{
    return source.replace(/\breturn\s*;/gi, "");
}

// Lines spoken by a blocker: a Speak("...") followed by $OKtoArm=0
function blockerLines(source)
{
    const out = new Set();
    const re = /Speak\(\s*"([^"]*)"\s*\)\s*;\s*\$OKtoArm\s*=\s*0/gi;
    let m;
    while ((m = re.exec(source))) out.add(m[1]);
    return [...out];
}

module.exports = { PARAMS, REPLAY_EDITS, MODES, makeTransform, parseSetting, settingText, normalize, editText, checkParams,
    isDefault, allRulesSource, blockerLines };
