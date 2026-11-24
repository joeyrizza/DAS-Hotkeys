// =========================================================
// DAS SCRIPT INTERPRETER
// =========================================================
//
// Parses and runs DAS Trader Pro hotkey scripts in Node, so the
// real script files can be tested outside DAS. The DAS objects
// (charts, montage, quotes, buttons) come from simdas.js.
//
// DAS behaviour modelled here. "confirmed" = the user checked it in
// DAS or it was seen in an ExportChartData file; "assumed" = not
// checked yet (see UNCONFIRMED in README.md, Unit tests).
//   confirmed: variables are global and not case-sensitive
//   confirmed: divide by zero returns 0
//   confirmed: Round(x,103) returns a 2-decimal string
//   confirmed: Round(x) with no decimals drops the fraction
//              (Round(92.9694) = 92), while Round(x,1) rounds
//              (Round(10.088965,1) = 10.1)
//   confirmed: Round("123.456",3) turns text into a number
//   confirmed: setvar/getvar share the $variable namespace
//   assumed:   an unset variable reads as 0
//   assumed:   C-style operator precedence (* / % before + -,
//              comparisons before &&, && before ||)
//   assumed:   "+" joins text when either side is text
//   assumed:   SubString(text, start, end) uses 0-based start and
//              an exclusive end (consistent with TestMACD and
//              TestEMATrendState, and StrFind returning 13 for
//              ", Signal:" in "MACD:0.210379, Signal:...")
//   assumed:   text turns into a number by reading its leading
//              number ("0.21, Sig" -> 0.21, "abc" -> 0)
//   assumed:   numbers joined into text show at most 4 decimals
//              (SaveVarToFile never shows more than 4)
//
// Statements the parser can't read as code (montage commands such
// as "CXL ALLSYMB", "TriggerOrder=RT:STOP ...", or "Speak text;")
// are kept as raw commands and passed to the host (simdas.js records
// them, and turns TriggerOrder into an order). "run.js check" reports
// raw statements that aren't a known command shape, since those are
// usually a missing ";".
// =========================================================

"use strict";

// ---------------------------------------------------------
// LEXER
// ---------------------------------------------------------

const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||",
    "<", ">", "+", "-", "*", "/", "%", "!", "=", "(", ")", "{", "}", ",", ".", ";"];

function tokenize(src)
{
    const tokens = [];
    let i = 0;
    const n = src.length;

    while (i < n)
    {
        const c = src[i];

        // whitespace
        if (/\s/.test(c)) { i++; continue; }

        // comments
        if (c === "/" && src[i + 1] === "/")
        {
            while (i < n && src[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "*")
        {
            const end = src.indexOf("*/", i + 2);
            i = end < 0 ? n : end + 2;
            continue;
        }

        const start = i;

        // numbers: 12, 0.75, .05
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || "")))
        {
            const re = /\d+(\.\d+)?|\.\d+/y;
            re.lastIndex = i;
            const m = re.exec(src);
            i += m[0].length;
            tokens.push({ t: "num", v: Number(m[0]), s: start, e: i });
            continue;
        }

        // strings
        if (c === '"')
        {
            i++;
            let v = "";
            while (src[i] !== '"')
            {
                if (i >= n)
                {
                    throw new ParseError("Unclosed string at line " + lineOf(src, start) +
                        " near '" + src.slice(start, start + 30).split("\n")[0] + "'");
                }
                if (src[i] === "\\" && i + 1 < n)
                {
                    const e = src[i + 1];
                    v += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
                    i += 2;
                }
                else
                {
                    v += src[i++];
                }
            }
            i++; // closing quote
            tokens.push({ t: "str", v, s: start, e: i });
            continue;
        }

        // variables
        if (c === "$")
        {
            i++;
            while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
            tokens.push({ t: "var", v: src.slice(start + 1, i).toUpperCase(), s: start, e: i });
            continue;
        }

        // identifiers
        if (/[A-Za-z_]/.test(c))
        {
            while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
            tokens.push({ t: "id", v: src.slice(start, i), s: start, e: i });
            continue;
        }

        // operators
        const op = OPERATORS.find(o => src.startsWith(o, i));
        if (op)
        {
            i += op.length;
            tokens.push({ t: "op", v: op, s: start, e: i });
            continue;
        }

        // anything else (e.g. ":" or "@" in montage commands)
        i++;
        tokens.push({ t: "other", v: c, s: start, e: i });
    }

    tokens.push({ t: "eof", v: "", s: n, e: n });
    return tokens;
}


// ---------------------------------------------------------
// PARSER
// ---------------------------------------------------------

class ParseError extends Error {}

function lineOf(src, pos)
{
    return src.slice(0, pos).split("\n").length;
}

function parse(src, file)
{
    const toks = tokenize(src);
    let p = 0;

    const peek = (k = 0) => toks[p + k];
    const isOp = (v, k = 0) => peek(k).t === "op" && peek(k).v === v;
    const isKw = (v) => peek().t === "id" && peek().v.toLowerCase() === v;
    const fail = (msg) =>
    {
        throw new ParseError(msg + " at line " + lineOf(src, peek().s) + " near '" +
            src.slice(peek().s, peek().s + 30).split("\n")[0] + "'");
    };
    const expectOp = (v) =>
    {
        if (!isOp(v)) fail("Expected '" + v + "'");
        return toks[p++];
    };

    function parseProgram()
    {
        const body = [];
        while (peek().t !== "eof")
        {
            if (isOp("}")) fail("Unexpected '}' (an extra '}', or a missing ';' or '{' before it)");
            body.push(parseStatement());
        }
        return { type: "block", body };
    }

    function parseBlock()
    {
        const open = expectOp("{");
        const body = [];
        while (!isOp("}"))
        {
            if (peek().t === "eof")
            {
                p = toks.indexOf(open);
                fail("Unclosed '{'");
            }
            body.push(parseStatement());
        }
        p++;
        return { type: "block", body };
    }

    function parseStatement()
    {
        const line = lineOf(src, peek().s);

        if (isOp("{")) return parseBlock();
        if (isOp(";")) { p++; return { type: "empty" }; }

        if (isKw("if"))
        {
            p++;
            expectOp("(");
            const test = parseExpr();
            expectOp(")");
            const then = parseStatement();
            let other = null;
            if (isKw("else"))
            {
                p++;
                other = parseStatement();
            }
            return { type: "if", test, then, other, line };
        }

        if (isKw("while"))
        {
            p++;
            expectOp("(");
            const test = parseExpr();
            expectOp(")");
            const body = parseStatement();
            return { type: "while", test, body, line };
        }

        if (isKw("return"))
        {
            p++;
            if (isOp(";")) p++;
            return { type: "return", line };
        }

        // Expression or assignment; anything else is a raw command.
        const startTok = p;
        try
        {
            const target = parseExpr();
            let stmt;
            if (isOp("="))
            {
                p++;
                const value = parseExpr();
                if (!["var", "member", "id"].includes(target.type))
                {
                    fail("Can't assign to this");
                }
                stmt = { type: "assign", target, value, line };
            }
            else
            {
                stmt = { type: "expr", expr: target, line };
            }
            if (isOp(";")) p++;
            else if (!(isOp("}") || peek().t === "eof")) fail("Expected ';'");
            return stmt;
        }
        catch (err)
        {
            if (!(err instanceof ParseError)) throw err;
            // Raw command: everything up to the next ";" on this statement
            p = startTok;
            const s = peek().s;
            while (peek().t !== "eof" && !isOp(";") && !isOp("}")) p++;
            const text = src.slice(s, peek().s).trim();
            if (isOp(";")) p++;
            if (!text) fail("Empty statement");
            return { type: "raw", text, line, why: err.message };
        }
    }

    // ---- expressions (C-style precedence) ----

    function parseExpr() { return parseOr(); }

    function binary(next, ops)
    {
        return function ()
        {
            let left = next();
            while (peek().t === "op" && ops.includes(peek().v))
            {
                const op = toks[p++].v;
                const right = next();
                left = { type: "bin", op, left, right };
            }
            return left;
        };
    }

    function parseUnary()
    {
        if (isOp("!") || isOp("-") || isOp("+"))
        {
            const op = toks[p++].v;
            return { type: "unary", op, arg: parseUnary() };
        }
        return parsePostfix();
    }

    const parseMul = binary(parseUnary, ["*", "/", "%"]);
    const parseAdd = binary(parseMul, ["+", "-"]);
    const parseRel = binary(parseAdd, ["<", ">", "<=", ">="]);
    const parseEq = binary(parseRel, ["==", "!="]);
    const parseAnd = binary(parseEq, ["&&"]);
    const parseOr = binary(parseAnd, ["||"]);

    function parseArgs()
    {
        expectOp("(");
        const args = [];
        if (!isOp(")"))
        {
            args.push(parseExpr());
            while (isOp(","))
            {
                p++;
                args.push(parseExpr());
            }
        }
        expectOp(")");
        return args;
    }

    function parsePostfix()
    {
        let node = parsePrimary();
        for (;;)
        {
            if (isOp("."))
            {
                p++;
                if (peek().t !== "id") fail("Expected a name after '.'");
                const name = toks[p++].v;
                if (isOp("("))
                {
                    node = { type: "method", obj: node, name, args: parseArgs() };
                }
                else
                {
                    node = { type: "member", obj: node, name };
                }
            }
            else
            {
                return node;
            }
        }
    }

    function parsePrimary()
    {
        const tk = peek();
        if (tk.t === "num") { p++; return { type: "lit", v: tk.v }; }
        if (tk.t === "str") { p++; return { type: "lit", v: tk.v }; }
        if (tk.t === "var") { p++; return { type: "var", name: tk.v }; }
        if (tk.t === "id")
        {
            p++;
            if (isOp("(")) return { type: "call", name: tk.v, args: parseArgs() };
            return { type: "id", name: tk.v };
        }
        if (isOp("("))
        {
            p++;
            const e = parseExpr();
            expectOp(")");
            return e;
        }
        fail("Unexpected '" + tk.v + "'");
    }

    const ast = parseProgram();
    ast.file = file;
    return ast;
}


// ---------------------------------------------------------
// VALUES
// ---------------------------------------------------------

// Read text the way DAS seems to: its leading number, or 0.
function toNum(v)
{
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string")
    {
        const m = v.trim().match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
        return m ? Number(m[0]) : 0;
    }
    return 0;
}

function isNumericText(v)
{
    return typeof v === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test(v);
}

// Numbers joined into text: at most 4 decimals (assumed)
function fmtNum(n)
{
    if (!Number.isFinite(n)) return "0";
    const r = Math.round(n * 10000) / 10000;
    return String(Object.is(r, -0) ? 0 : r);
}

function toStr(v)
{
    if (typeof v === "string") return v;
    if (typeof v === "number") return fmtNum(v);
    if (v && typeof v === "object") return "[object]";
    return String(v);
}

function looseEqual(a, b)
{
    if (typeof a === "object" || typeof b === "object")
    {
        return a === b;
    }
    if (typeof a === "number" && typeof b === "number") return a === b;
    if (typeof a === "number" && isNumericText(b)) return a === toNum(b);
    if (typeof b === "number" && isNumericText(a)) return toNum(a) === b;
    if (typeof a === "number" || typeof b === "number")
    {
        // Text that isn't a number compared with a number
        return toStr(a) === toStr(b);
    }
    return a === b;
}

function compare(op, a, b)
{
    let x, y;
    if (typeof a === "string" && typeof b === "string" &&
        !(isNumericText(a) && isNumericText(b)))
    {
        x = a; y = b;
    }
    else
    {
        x = toNum(a); y = toNum(b);
    }
    switch (op)
    {
        case "<": return x < y;
        case ">": return x > y;
        case "<=": return x <= y;
        case ">=": return x >= y;
    }
}

function truthy(v)
{
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return isNumericText(v) ? toNum(v) !== 0 : v !== "";
    return !!v;
}


// ---------------------------------------------------------
// BUILT-IN FUNCTIONS
// ---------------------------------------------------------

function dasRound(x, mode)
{
    const n = toNum(x);
    // Seen in an export: Round(92.9694) gave 92, so with no decimals
    // given, Round drops the fraction (assumed toward zero for negatives).
    if (mode === undefined) return Math.trunc(n);
    const m = toNum(mode);
    if (m === 103) return (Math.round(n * 100) / 100).toFixed(2);
    const f = Math.pow(10, m);
    return Math.round(n * f) / f;
}

const BUILTINS = {
    round: (it, a) => dasRound(a[0], a[1]),
    abs: (it, a) => Math.abs(toNum(a[0])),
    min: (it, a) => Math.min(...a.map(toNum)),
    max: (it, a) => Math.max(...a.map(toNum)),
    substring: (it, a) =>
    {
        const s = toStr(a[0]);
        const start = toNum(a[1]);
        const end = a.length > 2 ? toNum(a[2]) : s.length;
        return s.slice(start, end);
    },
    strlen: (it, a) => toStr(a[0]).length,
    strfind: (it, a) => toStr(a[0]).indexOf(toStr(a[1])),
    isobj: (it, a) => (a[0] && typeof a[0] === "object") ? 1 : 0,
    exechotkey: (it, a) => { it.execHotkey(toStr(a[0])); return 0; },
    setvar: (it, a) => { it.setVar(toStr(a[0]).replace(/^\$/, ""), a[1]); return 0; },
    getvar: (it, a) => it.getVar(toStr(a[0]).replace(/^\$/, "")),
};


// ---------------------------------------------------------
// INTERPRETER
// ---------------------------------------------------------

class ReturnSignal {}

class DasRuntimeError extends Error {}

class Interpreter
{
    // host: { resolveScript(name) -> {file, source} | null,
    //         call(name, args) -> value | undefined (host functions),
    //         ident(name) -> value | undefined (bare names: Send, green...),
    //         assignIdent(name, value) (bare "Price=..." montage syntax),
    //         raw(text) (raw commands),
    //         warn(msg) }
    constructor(host, options = {})
    {
        this.host = host;
        this.vars = new Map();
        this.assigned = new Set();
        this.astCache = new Map();
        this.stack = [];
        this.maxSteps = options.maxSteps || 2000000;
        this.maxDepth = options.maxDepth || 50;
        this.steps = 0;
    }

    // ---- variables ----
    getVar(name)
    {
        const k = name.toUpperCase();
        return this.vars.has(k) ? this.vars.get(k) : 0;
    }
    setVar(name, value)
    {
        const k = name.toUpperCase();
        this.vars.set(k, value);
        this.assigned.add(k);
    }
    presetVar(name, value)
    {
        this.vars.set(name.toUpperCase(), value);
    }

    // ---- running scripts ----
    parseScript(file, source)
    {
        if (!this.astCache.has(file)) this.astCache.set(file, parse(source, file));
        return this.astCache.get(file);
    }

    runSource(file, source)
    {
        const ast = this.parseScript(file, source);
        if (this.stack.length >= this.maxDepth)
        {
            throw new DasRuntimeError("exechotkey nested too deep at " + file);
        }
        this.stack.push(file);
        try
        {
            this.execBlock(ast);
        }
        catch (e)
        {
            if (!(e instanceof ReturnSignal)) throw e;
        }
        finally
        {
            this.stack.pop();
        }
    }

    execHotkey(name)
    {
        const script = this.host.resolveScript(name);
        if (!script)
        {
            this.host.warn("exechotkey: no script for hotkey '" + name + "'");
            return;
        }
        this.runSource(script.file, script.source);
    }

    where(node)
    {
        return (this.stack[this.stack.length - 1] || "?") + (node && node.line ? ":" + node.line : "");
    }

    // ---- statements ----
    execBlock(block)
    {
        for (const s of block.body) this.exec(s);
    }

    exec(s)
    {
        if (++this.steps > this.maxSteps)
        {
            throw new DasRuntimeError("Step limit reached (endless loop?) at " + this.where(s));
        }
        switch (s.type)
        {
            case "block": return this.execBlock(s);
            case "empty": return;
            case "return": throw new ReturnSignal();
            case "if":
                if (truthy(this.eval(s.test))) this.exec(s.then);
                else if (s.other) this.exec(s.other);
                return;
            case "while":
                while (truthy(this.eval(s.test)))
                {
                    this.exec(s.body);
                    if (++this.steps > this.maxSteps)
                    {
                        throw new DasRuntimeError("Step limit reached in while loop at " + this.where(s));
                    }
                }
                return;
            case "expr":
                this.eval(s.expr);
                return;
            case "assign":
                return this.assign(s);
            case "raw":
                this.host.raw(this.substitute(s.text), this.where(s), s.text);
                return;
        }
        throw new DasRuntimeError("Unknown statement " + s.type);
    }

    // Raw commands keep their text; fill in $variables for the log
    substitute(text)
    {
        return text.replace(/\$([A-Za-z0-9_]+)/g, (m, name) =>
        {
            const v = this.getVar(name);
            return v && typeof v === "object" ? m : toStr(v);
        });
    }

    assign(s)
    {
        const value = this.eval(s.value);
        const t = s.target;
        if (t.type === "var") return this.setVar(t.name, value);
        if (t.type === "id") return this.host.assignIdent(t.name, value, this.where(s));
        if (t.type === "member")
        {
            const obj = this.eval(t.obj);
            if (!obj || typeof obj !== "object" || !obj.set)
            {
                throw new DasRuntimeError("Can't set ." + t.name + " on a non-object at " + this.where(s));
            }
            obj.set(t.name, value);
            return;
        }
        throw new DasRuntimeError("Bad assignment at " + this.where(s));
    }

    // Evaluate expression text, e.g. "$SelectedStopPrice-$StopLimitPriceOffset"
    // inside a TriggerOrder command
    evalText(text)
    {
        const ast = parse("$__EXPR=" + text + ";", "expression");
        const s = ast.body[0];
        if (ast.body.length !== 1 || s.type !== "assign") throw new ParseError("Not an expression: " + text);
        return this.eval(s.value);
    }

    // ---- expressions ----
    eval(e)
    {
        switch (e.type)
        {
            case "lit": return e.v;
            case "var": return this.getVar(e.name);
            case "id":
            {
                const v = this.host.ident(e.name);
                return v === undefined ? e.name : v;
            }
            case "unary":
            {
                const v = this.eval(e.arg);
                if (e.op === "!") return truthy(v) ? 0 : 1;
                if (e.op === "-") return -toNum(v);
                return toNum(v);
            }
            case "bin": return this.binary(e);
            case "member":
            {
                const obj = this.eval(e.obj);
                if (!obj || typeof obj !== "object" || !obj.get)
                {
                    throw new DasRuntimeError(
                        "Can't read ." + e.name + " from " + JSON.stringify(obj) + " at " + this.where());
                }
                return obj.get(e.name);
            }
            case "method":
            {
                const obj = this.eval(e.obj);
                const args = e.args.map(a => this.eval(a));
                if (!obj || typeof obj !== "object" || !obj.call)
                {
                    throw new DasRuntimeError(
                        "Can't call ." + e.name + "() on " + JSON.stringify(obj) + " at " + this.where());
                }
                return obj.call(e.name, args);
            }
            case "call":
            {
                const args = e.args.map(a => this.eval(a));
                const lower = e.name.toLowerCase();
                if (BUILTINS[lower]) return BUILTINS[lower](this, args);
                const v = this.host.call(lower, args, this.where());
                if (v === undefined)
                {
                    throw new DasRuntimeError("Unsupported function " + e.name + "() at " + this.where());
                }
                return v;
            }
        }
        throw new DasRuntimeError("Unknown expression " + e.type);
    }

    binary(e)
    {
        if (e.op === "&&") return truthy(this.eval(e.left)) && truthy(this.eval(e.right)) ? 1 : 0;
        if (e.op === "||") return truthy(this.eval(e.left)) || truthy(this.eval(e.right)) ? 1 : 0;

        const a = this.eval(e.left);
        const b = this.eval(e.right);
        switch (e.op)
        {
            case "+":
                if (typeof a === "string" || typeof b === "string") return toStr(a) + toStr(b);
                return toNum(a) + toNum(b);
            case "-": return toNum(a) - toNum(b);
            case "*": return toNum(a) * toNum(b);
            case "/": { const d = toNum(b); return d === 0 ? 0 : toNum(a) / d; }
            case "%": { const d = toNum(b); return d === 0 ? 0 : toNum(a) % d; }
            case "==": return looseEqual(a, b) ? 1 : 0;
            case "!=": return looseEqual(a, b) ? 0 : 1;
            case "<": case ">": case "<=": case ">=":
                return compare(e.op, a, b) ? 1 : 0;
        }
        throw new DasRuntimeError("Unknown operator " + e.op);
    }
}

module.exports = { tokenize, parse, Interpreter, ParseError, DasRuntimeError, BUILTINS, toNum, toStr, fmtNum };
