// =========================================================
// SIMULATED DAS
// =========================================================
//
// Builds the DAS objects the scripts use (Chart1, Chart5,
// ChartDaily, MONTAGE1, LADDER1, quotes, buttons, trend lines,
// account) from a fixture written by convert_das_export.js,
// and records what the scripts do: button text and colour,
// speech, orders, montage commands and message boxes.
//
// Usage:
//   const sim = new SimDas(fixture, { repoRoot });
//   sim.run("RunTests_Dispatch");
//   sim.result()  ->  { vars, assigned, buttons, speech, orders, ... }
// =========================================================

"use strict";

const fs = require("fs");
const path = require("path");
const { Interpreter, toNum, toStr, fmtNum } = require("./interpreter");

const REPO_ROOT = path.join(__dirname, "..", "..");

// exechotkey() names that differ from the filename
const HOTKEY_ALIASES = {
    "setup armed": "SetupArmed",
    "setup disarmed": "SetupDisarmed",
    "test_pricechange": "TestPriceChange",
    "sell @ bid": "Sell Bid",         // "@" isn't used in filenames
    "sell @ ask": "Sell Ask",
};

// Folders that never hold live hotkey scripts
const SKIP_DIRS = new Set([".git", ".claude", "DynamicSizing", "UnitTests", "node_modules"]);


// ---------------------------------------------------------
// Script lookup: hotkey name -> file
// ---------------------------------------------------------

function indexScripts(root)
{
    const byName = new Map();
    const buttons = [];

    function walk(dir)
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory())
            {
                if (!SKIP_DIRS.has(e.name)) walk(p);
            }
            // Scripts have no extension. Dot-files (.gitignore) aren't scripts.
            else if (path.extname(e.name) === "" && !e.name.startsWith("DASExport") && !e.name.startsWith("."))
            {
                // Button scripts aren't hotkeys: only use them when no
                // hotkey has the same name (e.g. DrawKeyResistance).
                if (path.basename(dir) === "ButtonClickScripts") buttons.push(p);
                else byName.set(e.name.toLowerCase(), p);
            }
        }
    }
    walk(root);
    for (const p of buttons)
    {
        const k = path.basename(p).toLowerCase();
        if (!byName.has(k)) byName.set(k, p);
    }
    return byName;
}


// ---------------------------------------------------------
// Generic object with case-insensitive properties
// ---------------------------------------------------------

class DasObject
{
    constructor(kind, props = {})
    {
        this.kind = kind;
        this.props = {};
        for (const [k, v] of Object.entries(props)) this.props[k.toUpperCase()] = v;
    }
    get(name)
    {
        const k = name.toUpperCase();
        return k in this.props ? this.props[k] : 0;
    }
    set(name, value)
    {
        this.props[name.toUpperCase()] = value;
    }
    call(name)
    {
        throw new Error("Unsupported method " + this.kind + "." + name + "()");
    }
    toJSON() { return "[" + this.kind + "]"; }
}

function emptyBar()
{
    return new DasObject("bar", { Time: "", Open: 0, Hi: 0, Lo: 0, Close: 0, Volume: 0 });
}

// " AVG:3.751\n" -> 3.751, "MACD:0.2, Signal:0.1\n" -> 0.2
function studyTextToNumber(text)
{
    const m = String(text).match(/:\s*([+-]?\d*\.?\d+)/);
    return m ? Number(m[1]) : toNum(text);
}


// ---------------------------------------------------------
// Windows
// ---------------------------------------------------------

class Button extends DasObject
{
    constructor(sim, windowName, name)
    {
        super("button");
        this.sim = sim;
        this.key = windowName + "." + name;
    }
    set(name, value)
    {
        super.set(name, value);
        const rec = this.sim.buttons[this.key] || (this.sim.buttons[this.key] = {});
        rec[name.toLowerCase()] = toStr(value);
    }
}

class TrendLine extends DasObject
{
    constructor(chart, type)
    {
        super("trendline", { Type: type });
        this.chart = chart;
    }
    set(name, value)
    {
        super.set(name, value);
        if (name.toUpperCase() === "NAME") this.chart.lines.set(toStr(value).toUpperCase(), this);
    }
    call(name)
    {
        if (name.toLowerCase() === "delete")
        {
            const n = toStr(this.get("Name")).toUpperCase();
            if (this.chart.lines.get(n) === this) this.chart.lines.delete(n);
            return 0;
        }
        return super.call(name);
    }
}

class Window extends DasObject
{
    constructor(sim, name)
    {
        super("window", { Symbol: sim.symbol, Symb: sim.symbol });
        this.sim = sim;
        this.name = name;
        this.buttonObjs = new Map();
    }
    call(name, args)
    {
        if (name.toLowerCase() === "getcustbutobj")
        {
            const b = toStr(args[0]);
            const k = b.toLowerCase();
            if (!this.buttonObjs.has(k)) this.buttonObjs.set(k, new Button(this.sim, this.name, b));
            return this.buttonObjs.get(k);
        }
        return super.call(name, args);
    }
}

class Chart extends Window
{
    constructor(sim, name, data, currentStudies)
    {
        super(sim, name);
        this.bars = (data && data.bars) || [];
        this.historyEnded = !!(data && data.historyEnded);
        this.studies = currentStudies || {};
        this.lines = new Map();
    }

    getBar(offset)
    {
        const n = -toNum(offset);
        if (n < 0 || n >= this.bars.length)
        {
            if (n >= this.bars.length && !this.historyEnded)
            {
                this.sim.warnOnce(this.name + ".GetBar(" + (-n) + ") is older than the exported bars");
            }
            return emptyBar();
        }
        return new DasObject("bar", this.bars[n]);
    }

    getStudyVal(args)
    {
        const study = toStr(args[0]);
        if (args.length >= 3)
        {
            // ByBarNum: the study text for that bar, exactly as exported
            const n = -toNum(args[2]);
            const bar = this.bars[n];
            if (!bar) return "0";
            const text = findKey(bar.studies || {}, study);
            if (text === undefined)
            {
                this.sim.warnOnce(this.name + " has no per-bar values for " + study);
                return "0";
            }
            return text;
        }
        // Current value: exported number, else the latest bar's text
        const cur = findKey(this.studies, study);
        if (cur !== undefined) return toNum(cur);
        if (study.toLowerCase() === "studybar" && this.bars[0]) return this.bars[0].Close;
        const text = this.bars[0] && findKey(this.bars[0].studies || {}, study);
        if (text !== undefined) return studyTextToNumber(text);
        this.sim.warnOnce(this.name + " has no study " + study);
        return 0;
    }

    call(name, args)
    {
        switch (name.toLowerCase())
        {
            case "getbar": return this.getBar(args[0]);
            case "getstudyval": return this.getStudyVal(args);
            case "gettrendline":
                return this.lines.get(toStr(args[0]).toUpperCase()) || 0;
            case "createtrendline":
                return new TrendLine(this, toStr(args[0]));
        }
        return super.call(name, args);
    }
}

class Montage extends Window
{
    constructor(sim, data)
    {
        super(sim, "MONTAGE1");
        for (const [k, v] of Object.entries(data || {})) this.props[k.toUpperCase()] = v;
        if (!("ACCOUNT" in this.props)) this.props.ACCOUNT = "SIM";
    }
    set(name, value)
    {
        const k = name.toUpperCase();
        if ((k === "BUY" || k === "SELL") && toStr(value).toLowerCase() === "send")
        {
            const route = toStr(this.get("Route"));
            const isStop = route.toUpperCase() === "STOP";
            // Confirmed: DAS rounds a fractional share count down
            const share = this.get("Share");
            this.sim.addOrder({
                side: k,
                shares: typeof share === "number" ? Math.floor(share + 1e-9) : share,
                price: this.get("Price"),
                route,
                tif: this.get("TIF") || "",
                stopType: isStop ? this.get("StopType") : "",
                stopPrice: isStop ? this.get("StopPrice") : "",
                at: this.sim.interp.where(),
            });
            return;
        }
        super.set(name, value);
    }
}


// One line per order for the activity log, e.g.
//   "SELL 15 LIMIT @ 11.63"
//   "SELL 5 STOP LimitP stop 11.5 @ 11.45"
//   "TRIGGER SELL Pos STOP LIMITP stop 11.5 @ 11.45 DAY+"
function describeOrder(o)
{
    const v = (x) => typeof x === "number" ? fmtNum(x) : toStr(x);
    let s = (o.trigger ? "TRIGGER " : "") + o.side + " " + v(o.shares) + " " + v(o.route);
    if (o.stopType !== "" || o.stopPrice !== "") s += " " + v(o.stopType) + " stop " + v(o.stopPrice);
    s += " @ " + v(o.price);
    if (o.tif) s += " " + v(o.tif);
    return s;
}

function findKey(obj, key)
{
    const lower = key.toLowerCase();
    for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return obj[k];
    return undefined;
}


// ---------------------------------------------------------
// The simulated platform
// ---------------------------------------------------------

const COLORS = ["green", "red", "orange", "yellow", "blue", "white", "black", "gray", "grey", "purple", "violet"];

class SimDas
{
    constructor(fixture, options = {})
    {
        this.fixture = fixture;
        this.symbol = fixture.symbol;
        this.root = options.repoRoot || REPO_ROOT;
        // options.sources: Map of hotkey name (lower case) -> { file, source },
        // used instead of reading files (the replay viewer runs in a browser).
        // options.transform(file, source): edits a script's text before it
        // runs (the replay's adjustable thresholds).
        this.sources = options.sources || null;
        this.transform = options.transform || null;
        this.scripts = this.sources ? null : (options.scripts || indexScripts(this.root));

        this.buttons = {};
        this.speech = [];
        this.orders = [];
        this.activity = [];   // montage commands and orders, in the order sent
        this.commands = [];
        this.messages = [];
        this.warnings = [];
        this.warned = new Set();

        this.second = options.second !== undefined ? options.second
            : (fixture.capture && fixture.capture.getSecond) || 0;

        const studies = fixture.studies || {};
        const charts = fixture.charts || {};
        this.windows = {
            CHART1: new Chart(this, "CHART1", charts.Chart1, studies.Chart1),
            CHART5: new Chart(this, "CHART5", charts.Chart5, studies.Chart5),
            CHARTDAILY: new Chart(this, "CHARTDAILY", charts.ChartDaily, studies.ChartDaily),
            MONTAGE1: new Montage(this, fixture.montage),
            LADDER1: new Window(this, "LADDER1"),
        };
        this.quote = new DasObject("quote", fixture.quote || {});

        const vars = fixture.variables || {};
        // Realized P&L defaults to what CheckForMultipleLosses last saw,
        // so it does nothing unless a test changes it
        const realized = vars.TEMPTOTAL !== undefined ? vars.TEMPTOTAL : 0;
        this.account = new DasObject("account", { Realized: realized, ...(fixture.account || {}) });

        this.interp = new Interpreter(this, options);

        // Memory as it was in DAS, then the window variables
        // DesktopLoadScript sets
        if (options.presetVariables !== false)
        {
            for (const [k, v] of Object.entries(vars)) this.interp.presetVar(k, v);
        }
        for (const [k, v] of Object.entries(options.vars || {})) this.interp.presetVar(k, v);
        this.interp.presetVar("CHART1", this.windows.CHART1);
        this.interp.presetVar("CHART5", this.windows.CHART5);
        this.interp.presetVar("CHARTD", this.windows.CHARTDAILY);
        this.interp.presetVar("MONTAGE1", this.windows.MONTAGE1);
        this.interp.presetVar("M", this.windows.MONTAGE1);
        this.interp.presetVar("LADDER1", this.windows.LADDER1);
    }

    warn(msg) { this.warnings.push(msg); }
    warnOnce(msg) { if (!this.warned.has(msg)) { this.warned.add(msg); this.warn(msg); } }

    // ---- interpreter host ----
    resolveScript(name)
    {
        const key = (HOTKEY_ALIASES[name.toLowerCase()] || name).toLowerCase();
        let script = null;
        if (this.sources)
        {
            script = this.sources.get(key) || null;
        }
        else
        {
            let file = this.scripts.get(key);
            if (!file)
            {
                // also accept a path such as "Tests/Test_Dip"
                const p = path.join(this.root, name);
                if (fs.existsSync(p) && fs.statSync(p).isFile()) file = p;
            }
            if (file) script = { file: path.relative(this.root, file).replace(/\\/g, "/"), source: fs.readFileSync(file, "utf8") };
        }
        if (script && this.transform) script = { file: script.file, source: this.transform(script.file, script.source) };
        return script;
    }

    call(name, args, where)
    {
        switch (name)
        {
            case "getwindowobj":
            {
                const n = toStr(args[0]).toUpperCase();
                return this.windows[n] || (n === "CHARTD" ? this.windows.CHARTDAILY : 0);
            }
            case "getstudyval": return this.windows.CHART1.getStudyVal(args);
            case "getquoteobj": return this.quote;
            case "getaccountobj": return this.account;
            case "getsecond": return this.second;
            case "speak": this.speech.push(toStr(args[0])); return 0;
            case "msgbox": this.messages.push(toStr(args[0])); return 0;
            case "color": return "color(" + args.map(toNum).join(",") + ")";
            case "globaltrendlinetolocal": return 0;
            case "wait": return 0;
            case "input":
                this.warn("input() at " + where + " returned 0");
                return 0;
        }
        return undefined;
    }

    ident(name)
    {
        const lower = name.toLowerCase();
        if (COLORS.includes(lower)) return lower;
        if (lower === "bybarnum") return "ByBarNum";
        if (lower === "send") return "Send";
        // Bare montage fields (old syntax: Bid, Ask, Pos, Price ...)
        const m = this.windows.MONTAGE1;
        if (lower.toUpperCase() in m.props) return m.get(name);
        return undefined;
    }

    assignIdent(name, value)
    {
        // Old bare montage syntax: Price=..., Share=..., BUY=Send
        this.windows.MONTAGE1.set(name, value);
    }

    raw(text, where, original)
    {
        const m = text.match(/^speak\s+(.*)$/i);
        if (m)
        {
            this.speech.push(m[1].replace(/^"(.*)"$/, "$1"));
            return;
        }
        this.commands.push({ text, at: where });

        const src = original || text;
        const t = src.match(/^(?:\$\w+\.)?TriggerOrder\s*=\s*(.*)$/i);
        if (t)
        {
            this.addOrder(this.parseTriggerOrder(t[1], where));
            return;
        }
        // Montage commands such as "$MONTAGE1.CXL ALLSYMB" go in the
        // activity log with the window name dropped
        this.activity.push(text.replace(/^\$\w+\./, ""));
    }

    // "RT:STOP STOPTYPE:LIMITP PX:$a-$b ACT:SELL STOPPRICE:$a QTY:Pos TIF:DAY+"
    // -> an order that DAS places once the entry fills. Values with
    // $variables are worked out the way DAS fills them in.
    parseTriggerOrder(spec, where)
    {
        const f = {};
        for (const part of spec.trim().split(/\s+/))
        {
            const i = part.indexOf(":");
            if (i < 0) { this.warn("TriggerOrder: can't read '" + part + "' at " + where); continue; }
            const key = part.slice(0, i).toUpperCase();
            let val = part.slice(i + 1);
            if (val.includes("$"))
            {
                try { val = this.interp.evalText(val); }
                catch (e) { this.warn("TriggerOrder: can't work out " + key + ":" + val + " at " + where); }
            }
            else if (/^-?\d*\.?\d+$/.test(val)) val = Number(val);
            f[key] = val;
        }
        return {
            trigger: true,
            side: toStr(f.ACT || "").toUpperCase(),
            shares: f.QTY !== undefined ? f.QTY : "",
            price: f.PX !== undefined ? f.PX : "",
            route: toStr(f.RT || ""),
            tif: f.TIF || "",
            stopType: f.STOPTYPE || "",
            stopPrice: f.STOPPRICE !== undefined ? f.STOPPRICE : "",
            at: where,
        };
    }

    addOrder(o)
    {
        this.orders.push(o);
        this.activity.push(describeOrder(o));
    }

    // ---- running ----
    run(name)
    {
        // The endless-loop guard counts statements per hotkey press,
        // not across a whole replay that reuses this simulation
        this.interp.steps = 0;
        this.interp.execHotkey(name);
        return this;
    }

    result()
    {
        const assigned = {};
        for (const k of this.interp.assigned)
        {
            const v = this.interp.vars.get(k);
            if (v === null || typeof v !== "object") assigned[k] = v;
        }
        return {
            assigned,
            buttons: this.buttons,
            speech: this.speech,
            orders: this.orders,
            activity: this.activity,
            commands: this.commands,
            messages: this.messages,
            lines: [...this.windows.CHART1.lines.keys()],
            warnings: this.warnings,
        };
    }

    getVar(name) { return this.interp.getVar(name); }
}

// Functions and bare names the simulation knows, for "run.js check".
// Add a DAS function here (and in call() above) when a script starts using it.
const HOST_FUNCTIONS = ["getwindowobj", "getstudyval", "getquoteobj", "getaccountobj", "getsecond",
    "speak", "msgbox", "color", "globaltrendlinetolocal", "wait", "input"];
// Real DAS functions the simulation doesn't run: ExportChartData saves files,
// TriggerStop (not live) creates alerts
const UNSIMULATED_FUNCTIONS = ["savevartofile", "loadvarfromfile", "newalertobj"];

// Every live script's text, keyed like resolveScript: for options.sources
function loadSources(root = REPO_ROOT)
{
    const out = new Map();
    for (const [key, file] of indexScripts(root))
    {
        out.set(key, { file: path.relative(root, file).replace(/\\/g, "/"), source: fs.readFileSync(file, "utf8") });
    }
    return out;
}

module.exports = { SimDas, indexScripts, loadSources, studyTextToNumber, describeOrder, REPO_ROOT,
    HOTKEY_ALIASES, HOST_FUNCTIONS, UNSIMULATED_FUNCTIONS };
