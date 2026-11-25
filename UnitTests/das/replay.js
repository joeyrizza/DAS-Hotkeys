// =========================================================
// REPLAY A FIXTURE MINUTE BY MINUTE
// =========================================================
//
// Steps through a fixture's 1-minute bars as if the day were
// live, running the real test scripts each step, and records
// what "Setup Armed" would have said at that moment. Runs in
// Node (run.js replay) and in the browser (the replay viewer
// bundles this file with interpreter.js, simdas.js and params.js).
//
// Each minute is replayed at several points ("samples") so the
// forming candle grows the way it did in DAS:
//   green candle: open -> low -> high -> close
//   red candle:   open -> high -> low -> close
// A green candle is assumed to go to its low first, a red one to
// its high first. The true path inside a minute isn't in the
// export, so this is a guess.
//
// At each sample:
//   1. Chart1 is cut off at that minute, with the forming bar
//      built from the sample's price. Current EMA values are moved
//      toward the sample price the way an EMA updates; VWAP uses
//      the bar's exported value.
//   2. Montage Last/Hi/Lo, quote Last/Volume, the daily bar and
//      GetSecond() are set to what was known then.
//   3. RunTests_Dispatch and RunTests_ChartUpdate run, keeping
//      memory from the previous sample, as in DAS.
//   4. "Setup Armed" runs on a copy of memory, so pressing it in
//      the replay never arms the following samples. Its speech,
//      $OKtoArm and the button colours are recorded.
//   5. SpeakTestResults runs again with its "return;" statements
//      removed, on another copy, to list every rule that fails
//      (Setup Armed stops at the first blocker).
// Each sample keeps its memory, so rescore() can press Setup
// Armed again with other thresholds without replaying the tests.
//
// Values only known at export time:
//   - Bid/Ask: Last -/+ half of options.spread (default 0.02).
//   - Today's volume: DAS's quote volume is higher than the sum of
//     the 1-minute bars even when the export reaches the start of
//     the chart (6-19% in the 2026-11-25 exports), so it counts
//     trades the bars don't. If the export reaches the start of
//     the chart, the running bar volume is scaled up by that ratio.
//     If not, the difference is treated as volume before the first
//     exported bar and added to every sample.
//   - Montage Hi/Lo and the daily bar: from 9:30, the regular
//     session's high/low so far. Seen in four exports: DAS's
//     montage and daily bar leave out premarket bars (NRSN's
//     premarket high was 4.68, its montage high 2.82). Before
//     9:30, the high/low of the exported bars so far; what DAS
//     shows then isn't known yet.
//   - RVOL: not checked. The replay switches the RVOL blocker off
//     in its copy of SpeakTestResults (params.js REPLAY_EDITS):
//     DAS's own RVOL during the day isn't in the export.
//   - Float, ETB/HTB/SSR, the daily averages: export values.
//
// Usage:
//   const { replay } = require("./replay");
//   const timeline = replay(fixture, { samples: 4, spread: 0.02, settings: {} });
// =========================================================

"use strict";

const { SimDas, studyTextToNumber } = require("./simdas");
const { toNum } = require("./interpreter");
const { makeTransform, allRulesSource, blockerLines } = require("./params");

const CHART1_STUDIES = ["Study9EMA", "Study20EMA", "Study200EMA", "StudyVWAP", "StudyMACD"];
const EMA_PERIODS = { Study9EMA: 9, Study20EMA: 20, Study200EMA: 200 };

// Buttons shown as rule strips in the viewer, in display order
const RULE_BUTTONS = [
    "btn_price", "btn_float", "btn_gap", "btn_vol", "btn_range", "btn_extended",
    "btn_spread", "btn_vwap", "btn_macd", "btn_emas", "btn_ematrend", "btn_dailyavgs", "btn_etb",
];

// "20261125 08:05:00" -> seconds since midnight
function timeToSecond(t)
{
    const m = String(t).match(/(\d\d):(\d\d):(\d\d)$/);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
}

function round4(x) { return Math.round(x * 10000) / 10000; }

// Price path inside a bar: open, low/high in the assumed order, close
function samplePath(bar, samples)
{
    const up = bar.Close >= bar.Open;
    const first = up ? bar.Lo : bar.Hi;
    const second = up ? bar.Hi : bar.Lo;
    const pts = [
        { price: bar.Open, lo: bar.Open, hi: bar.Open },
        { price: first, lo: Math.min(bar.Open, first), hi: Math.max(bar.Open, first) },
        { price: second, lo: bar.Lo, hi: bar.Hi },
        { price: bar.Close, lo: bar.Lo, hi: bar.Hi },
    ];
    if (samples <= 1) return [pts[3]];
    if (samples === 2) return [pts[0], pts[3]];
    return pts;
}

// Press Setup Armed, then run every rule, each on a copy of memory.
// Memory and buttons are left as they were.
function scoreArm(sim)
{
    const savedVars = sim.interp.vars;
    const savedButtons = sim.buttons;
    const out = { ok: 0, speech: [], all: [], error: null };
    try
    {
        sim.interp.vars = new Map(savedVars);
        sim.buttons = {};
        sim.speech.length = 0;
        sim.run("Setup Armed");
        out.ok = toNum(sim.getVar("OKTOARM"));
        out.speech = sim.speech.filter(s => s !== "Setup armed." && s !== "Non-Negotiable.");

        const str = sim.resolveScript("SpeakTestResults");
        sim.interp.vars = new Map(savedVars);
        sim.speech.length = 0;
        sim.interp.steps = 0;
        sim.interp.runSource(str.file + "#all-rules", allRulesSource(str.source));
        out.all = sim.speech.slice();
    }
    catch (e)
    {
        out.error = e.message;
    }
    sim.interp.vars = savedVars;
    sim.buttons = savedButtons;
    sim.speech.length = 0;
    return out;
}

// Build a replay. Returns { timeline, sim, run }: run() is a generator
// that replays one bar per step (so a browser can show progress);
// timeline fills in as it goes.
function createReplay(fixture, options = {})
{
    const samples = options.samples || 4;
    const spread = options.spread !== undefined ? options.spread : 0.02;
    const from = options.from || "";
    const to = options.to || "";
    const settings = options.settings || {};
    const keepMemory = !!options.keepMemory;

    const c1 = fixture.charts.Chart1;
    const all1 = c1.bars;                       // all1[0] is the latest bar
    const chron = all1.slice().reverse();       // oldest first
    const c5 = (fixture.charts.Chart5 && fixture.charts.Chart5.bars) || [];
    const cd = (fixture.charts.ChartDaily && fixture.charts.ChartDaily.bars) || [];
    const today = String(all1[0].Time).slice(0, 8);

    const exportedVol = chron.reduce((s, b) => s + (String(b.Time).startsWith(today) ? b.Volume : 0), 0);
    const quoteVol = toNum((fixture.quote || {}).Volume);
    const historyEnded = !!c1.historyEnded;
    const preVolume = historyEnded ? 0 : Math.max(0, quoteVol - exportedVol);
    const volumeScale = historyEnded && exportedVol > 0 && quoteVol > exportedVol ? quoteVol / exportedVol : 1;

    const { transform, problems } = makeTransform(settings);

    // Start like DAS after loading the desktop: no test results in
    // memory, tests on, and the symbol not yet seen (so the first
    // dispatch runs the symbol-change tests).
    const sim = new SimDas({ ...fixture, quote: { ...fixture.quote, RVOL: 0 } }, {
        presetVariables: false,
        vars: { RUNTESTSENABLED: 1, SPEAKCANDLEACTION: 1, SETUPARMED: 0, TEMPTOTAL: 0 },
        sources: options.sources,
        transform,
    });
    // Keep the catalyst set for this symbol, if DAS had one
    for (const [k, v] of Object.entries(fixture.variables || {}))
    {
        if (/^(NEWS|PATTERN)_/i.test(k)) sim.interp.presetVar(k, v);
    }
    const chart1 = sim.windows.CHART1;
    const chart5 = sim.windows.CHART5;
    const chartD = sim.windows.CHARTDAILY;
    const montage = sim.windows.MONTAGE1;
    chart1.historyEnded = true;
    chart5.historyEnded = true;

    const str = sim.resolveScript("SpeakTestResults");
    const timeline = {
        format: "das-replay/2",
        symbol: fixture.symbol,
        fixture: fixture.file || fixture.name,
        samples,
        settings,
        problems,
        blockers: str ? blockerLines(str.source) : [],
        assumptions: {
            spread,
            preVolume,
            volumeScale,
            historyEnded: !!c1.historyEnded,
            firstBar: chron[0].Time,
        },
        bars: [],
        steps: [],
    };
    const { bars, steps } = timeline;

    function* run()
    {
        // Premarket: high/low of every bar so far (assumed).
        // From 9:30: regular session only, as DAS shows it.
        let dayHi = -Infinity, dayLo = Infinity, cumVol = preVolume, dayOpen = 0;
        let regHi = -Infinity, regLo = Infinity, regOpen = 0;

        for (let i = 0; i < chron.length; i++)
        {
            const bar = chron[i];
            const prev = chron[i - 1];
            const hhmm = String(bar.Time).slice(9, 14);
            const isToday = String(bar.Time).startsWith(today);
            const studyNums = {};
            for (const s of CHART1_STUDIES) studyNums[s] = studyTextToNumber((bar.studies || {})[s] || "0");

            const inRange = (!from || hhmm >= from) && (!to || hhmm <= to);
            const barIndex = bars.length;
            if (inRange)
            {
                bars.push({
                    t: bar.Time, o: bar.Open, h: bar.Hi, l: bar.Lo, c: bar.Close, v: bar.Volume,
                    ema9: studyNums.Study9EMA, ema20: studyNums.Study20EMA, vwap: studyNums.StudyVWAP,
                });
            }

            const path = samplePath(bar, samples);
            const second0 = timeToSecond(bar.Time);
            for (let j = 0; j < path.length; j++)
            {
                const pt = path[j];
                const frac = (j + 1) / path.length;
                const partial = {
                    ...bar,
                    Hi: pt.hi, Lo: pt.lo, Close: pt.price,
                    Volume: Math.round(bar.Volume * frac),
                };
                // Current study values: EMAs step from the previous bar's value
                // toward the sample price; VWAP and MACD use the bar's values.
                const studies = { StudyBar: pt.price };
                for (const s of CHART1_STUDIES)
                {
                    const p = EMA_PERIODS[s];
                    const prevVal = prev && prev.studies ? studyTextToNumber(prev.studies[s] || "0") : 0;
                    studies[s] = p && prevVal > 0 && j < path.length - 1
                        ? round4(prevVal + (pt.price - prevVal) * 2 / (p + 1))
                        : studyNums[s];
                }

                chart1.bars = [partial, ...all1.slice(all1.length - i)];
                chart1.studies = studies;

                // Chart5: bars up to this minute
                const b5 = c5.filter(b => b.Time <= bar.Time);
                chart5.bars = b5;
                chart5.studies = { Study9EMA: b5[0] ? studyTextToNumber(b5[0].studies.Study9EMA) : 0 };

                // Day so far
                const regular = isToday && hhmm >= "09:30";
                const hi = regular ? Math.max(regHi, pt.hi) : Math.max(dayHi, pt.hi);
                const lo = regular ? Math.min(regLo, pt.lo) : Math.min(dayLo, pt.lo);
                const vol = Math.round((cumVol + (isToday ? partial.Volume : 0)) * volumeScale);
                if (cd.length)
                {
                    const d0 = { ...cd[0], Open: (regular ? regOpen || bar.Open : dayOpen || bar.Open), Hi: hi, Lo: lo, Close: pt.price, Volume: vol };
                    chartD.bars = [d0, ...cd.slice(1)];
                }
                sim.quote.set("Last", pt.price);
                sim.quote.set("Volume", vol);
                const bid = round4(pt.price - spread / 2);
                const mont = { Last: pt.price, Hi: hi, Lo: lo, Bid: bid, Ask: round4(bid + spread) };
                for (const [k, v] of Object.entries(mont)) montage.set(k, v);
                sim.second = second0 + Math.min(59, Math.round(frac * 60) - 1);

                // Run the live tests
                sim.speech.length = 0;
                sim.warnings.length = 0;
                let error = null;
                try
                {
                    sim.run("RunTests_Dispatch");
                    if (i === 0 && j === 0) sim.run("RunTests_Dispatch");   // first run only did the symbol change
                    sim.run("RunTests_ChartUpdate");
                }
                catch (e) { error = e.message; }
                const liveSpeech = sim.speech.slice();

                const arm = error ? { ok: 0, speech: [], all: [], error } : scoreArm(sim);

                if (inRange)
                {
                    const buttons = {};
                    for (const b of RULE_BUTTONS)
                    {
                        const rec = sim.buttons["CHART1." + b];
                        if (rec) buttons[b] = { text: rec.text || "", color: rec.bkcolor || "" };
                    }
                    const v = (n) => sim.getVar(n);
                    const step = {
                        bar: barIndex,
                        sample: j,
                        second: sim.second,
                        price: pt.price,
                        ok: arm.ok,
                        speech: arm.speech,     // what Setup Armed said
                        all: arm.all,           // every rule that fails
                        live: liveSpeech,
                        buttons,
                        vars: {
                            AverageRange4: round4(toNum(v("AVERAGERANGE4"))),
                            AverageRange10: round4(toNum(v("AVERAGERANGE10"))),
                            Vol: toNum(v("VOL")),
                            STRVOL10: round4(toNum(v("ST_RVOL10"))),
                            Spread: round4(toNum(v("SPREAD"))),
                            MontageHi: hi,
                            ExtensionMultiple: round4(toNum(v("EXTENSIONRANGEMULTIPLE"))),
                            Rng4Pct: round4(toNum(v("RNG4PCT"))),
                            SpikeMultiple: round4(toNum(v("SPIKEMULTIPLE"))),
                            SpikePct: round4(toNum(v("SPIKEPCT"))),
                            MACD: toNum(v("MACD")),
                            Signal: toNum(v("SIGNAL")),
                        },
                        error: arm.error,
                        warnings: sim.warnings.slice(),
                    };
                    if (keepMemory)
                    {
                        // Not enumerable, so JSON output leaves them out
                        Object.defineProperty(step, "mem", { value: new Map(sim.interp.vars) });
                        Object.defineProperty(step, "montage", { value: mont });
                    }
                    steps.push(step);
                }
            }

            dayHi = Math.max(dayHi, bar.Hi);
            dayLo = Math.min(dayLo, bar.Lo);
            if (isToday) { cumVol += bar.Volume; if (!dayOpen) dayOpen = bar.Open; }
            if (isToday && hhmm >= "09:30")
            {
                regHi = Math.max(regHi, bar.Hi);
                regLo = Math.min(regLo, bar.Lo);
                if (!regOpen) regOpen = bar.Open;
            }
            yield i / chron.length;
        }
    }

    return { timeline, sim, run };
}

// Press Setup Armed again at every sample with new thresholds, using
// each sample's saved memory. Only valid for thresholds that live in
// SpeakTestResults (params.js "instant"); others need a full replay.
// The replay must have been made with keepMemory.
function rescore(r, settings)
{
    prepareRescore(r, settings);
    for (const s of r.timeline.steps) rescoreStep(r, s);
    return r.timeline;
}

// rescore() in parts (the viewer spreads it over animation frames):
// prepareRescore once, then rescoreStep for each step.
function prepareRescore(r, settings)
{
    const { transform, problems } = makeTransform(settings);
    r.sim.transform = transform;
    r.sim.interp.astCache.clear();
    r.timeline.settings = settings;
    r.timeline.problems = problems;
    // A rule variant can add a blocker line, so read them again
    const str = r.sim.resolveScript("SpeakTestResults");
    if (str) r.timeline.blockers = [...new Set([...r.timeline.blockers, ...blockerLines(str.source)])];
}

function rescoreStep(r, s)
{
    const sim = r.sim;
    sim.interp.vars = new Map(s.mem);
    const montage = sim.windows.MONTAGE1;
    for (const [k, v] of Object.entries(s.montage)) montage.set(k, v);
    const arm = scoreArm(sim);
    s.ok = arm.ok;
    s.speech = arm.speech;
    s.all = arm.all;
    s.error = arm.error;
}

function replay(fixture, options = {})
{
    const r = createReplay(fixture, options);
    for (const _ of r.run()) { /* run to the end */ }
    return r.timeline;
}

module.exports = { replay, createReplay, rescore, prepareRescore, rescoreStep, RULE_BUTTONS };
