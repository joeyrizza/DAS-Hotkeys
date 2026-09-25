// =========================================================
// DAS BULLISH IMPULSE TEST HARNESS
// =========================================================
//
// Candle indexing:
//
//   BAR1 = most recent completed candle
//   BAR2 = previous candle
//   BAR3 = previous candle
//   BAR4 = oldest candle
//
// IMPULSE LOGIC:
//
//   ONE-CANDLE:
//      - bullish candle
//      - meaningful price expansion
//      - meaningful volume
//      - HH/HL structure NOT required
//
//   MULTI-CANDLE:
//      - meaningful cumulative price expansion
//      - meaningful volume
//      - bullish HH/HL structure
//
// =========================================================


// =========================================================
// IMPULSE DETECTOR
// =========================================================

function detectBullishImpulse(BAR1, BAR2, BAR3, BAR4)
{
    const MIN_IMPULSE_PERCENT = 3;
    const MIN_IMPULSE_VOLUME  = 250000;

    let result = {
        bullishImpulse: false,
        impulseType: "NONE",

        impulseLow: 0,
        impulseHigh: 0,
        impulseMove: 0,
        impulsePercent: 0,
        impulseVolume: 0,

        bullishStructure: false,

        reasons: []
    };


    // =====================================================
    // ONE-CANDLE IMPULSE
    // =====================================================
    //
    // A single large bullish candle can itself be an
    // impulse. HH/HL structure does not apply here.
    //
    // =====================================================

    const oneCandleMove =
        BAR1.high - BAR1.open;

    let oneCandlePercent = 0;

    if (BAR1.open > 0)
    {
        oneCandlePercent =
            (oneCandleMove / BAR1.open) * 100;
    }

    const oneCandleBullish =
        BAR1.close > BAR1.open;

    const oneCandleVolume =
        BAR1.volume >= MIN_IMPULSE_VOLUME;

    const oneCandleExpansion =
        oneCandlePercent >= MIN_IMPULSE_PERCENT;


    if (oneCandleBullish)
    {
        if (oneCandleExpansion)
        {
            if (oneCandleVolume)
            {
                result.bullishImpulse = true;
                result.impulseType = "ONE-CANDLE";

                result.impulseLow = BAR1.low;
                result.impulseHigh = BAR1.high;
                result.impulseMove =
                    BAR1.high - BAR1.low;
                result.impulsePercent =
                    oneCandlePercent;
                result.impulseVolume =
                    BAR1.volume;

                result.bullishStructure = null;

                return result;
            }
        }
    }


    // =====================================================
    // MULTI-CANDLE IMPULSE
    // =====================================================
    //
    // Use the four available candles to look for a
    // cumulative expansion.
    //
    // HH/HL structure applies here.
    //
    // =====================================================


if (!BAR2 || !BAR3 || !BAR4)
{
    return result;
}
    // -----------------------------------------------------
    // FIND LOWEST LOW
    // -----------------------------------------------------

    let impulseLow = BAR4.low;

    if (BAR3.low < impulseLow)
    {
        impulseLow = BAR3.low;
    }

    if (BAR2.low < impulseLow)
    {
        impulseLow = BAR2.low;
    }

    if (BAR1.low < impulseLow)
    {
        impulseLow = BAR1.low;
    }


    // -----------------------------------------------------
    // FIND HIGHEST HIGH
    // -----------------------------------------------------

    let impulseHigh = BAR1.high;

    if (BAR2.high > impulseHigh)
    {
        impulseHigh = BAR2.high;
    }

    if (BAR3.high > impulseHigh)
    {
        impulseHigh = BAR3.high;
    }

    if (BAR4.high > impulseHigh)
    {
        impulseHigh = BAR4.high;
    }


    // -----------------------------------------------------
    // PRICE EXPANSION
    // -----------------------------------------------------

    const impulseMove =
        impulseHigh - impulseLow;

    let impulsePercent = 0;

    if (impulseLow > 0)
    {
        impulsePercent =
            (impulseMove / impulseLow) * 100;
    }


    // -----------------------------------------------------
    // TOTAL VOLUME
    // -----------------------------------------------------

    const impulseVolume =
        BAR1.volume +
        BAR2.volume +
        BAR3.volume +
        BAR4.volume;


    // -----------------------------------------------------
    // BULLISH STRUCTURE
    // -----------------------------------------------------

    let bullishStructure = false;

    if (BAR3.high > BAR4.high)
    {
        if (BAR2.high > BAR3.high)
        {
            if (BAR1.high > BAR2.high)
            {
                if (BAR3.low >= BAR4.low)
                {
                    if (BAR2.low >= BAR3.low)
                    {
                        if (BAR1.low >= BAR2.low)
                        {
                            bullishStructure = true;
                        }
                    }
                }
            }
        }
    }


    // -----------------------------------------------------
    // STORE MULTI-CANDLE CALCULATIONS
    // -----------------------------------------------------

    result.impulseLow = impulseLow;
    result.impulseHigh = impulseHigh;
    result.impulseMove = impulseMove;
    result.impulsePercent = impulsePercent;
    result.impulseVolume = impulseVolume;
    result.bullishStructure = bullishStructure;


    // -----------------------------------------------------
    // FAILURE REASONS
    // -----------------------------------------------------

    if (impulsePercent < MIN_IMPULSE_PERCENT)
    {
        result.reasons.push(
            "Price expansion below 3%"
        );
    }

    if (impulseVolume < MIN_IMPULSE_VOLUME)
    {
        result.reasons.push(
            "Volume below 250K"
        );
    }

    if (!bullishStructure)
    {
        result.reasons.push(
            "Bullish HH/HL structure not present"
        );
    }


    // -----------------------------------------------------
    // MULTI-CANDLE IMPULSE
    // -----------------------------------------------------

    if (impulsePercent >= MIN_IMPULSE_PERCENT)
    {
        if (impulseVolume >= MIN_IMPULSE_VOLUME)
        {
            if (bullishStructure)
            {
                result.bullishImpulse = true;
                result.impulseType = "MULTI-CANDLE";
            }
        }
    }


    return result;
}

// =========================================================
// LOAD TEST FILE
// =========================================================

const fs = require("fs");

const filename = process.argv[2];

if (!filename)
{
    console.error(
        "Usage: node bullish_impulse_test.js <json-file>"
    );

    process.exit(1);
}


// =========================================================
// READ JSON
// =========================================================

let data;

try
{
    data = JSON.parse(
        fs.readFileSync(filename, "utf8")
    );
}
catch (error)
{
    console.error(
        "Could not read JSON file:"
    );

    console.error(error.message);

    process.exit(1);
}


// =========================================================
// VALIDATE INPUT
// =========================================================

if (!data.bars)
{
    console.error(
        "JSON file does not contain a 'bars' object."
    );

    process.exit(1);
}

if (!data.bars.BAR1)
{
    console.error(
        "JSON file must contain at least BAR1."
    );

    process.exit(1);
}


// =========================================================
// GET BARS
// =========================================================
//
// For a one-candle test, BAR2-4 are not required.
//
// For the multi-candle test, we need BAR1-4.
//
// =========================================================

const BAR1 = data.bars.BAR1;
const BAR2 = data.bars.BAR2;
const BAR3 = data.bars.BAR3;
const BAR4 = data.bars.BAR4;


// =========================================================
// RUN TEST
// =========================================================

let result;


// ---------------------------------------------------------
// ONE-CANDLE TEST
// ---------------------------------------------------------

if (!BAR2)
{
    result = detectBullishImpulse(
        BAR1,
        null,
        null,
        null
    );
}


// ---------------------------------------------------------
// MULTI-CANDLE TEST
// ---------------------------------------------------------

if (BAR2)
{
    if (!BAR3)
    {
        console.error(
            "BAR2 exists but BAR3 is missing."
        );

        process.exit(1);
    }

    if (!BAR4)
    {
        console.error(
            "BAR3 exists but BAR4 is missing."
        );

        process.exit(1);
    }

    result = detectBullishImpulse(
        BAR1,
        BAR2,
        BAR3,
        BAR4
    );
}


// =========================================================
// DISPLAY RESULT
// =========================================================

console.log("---------------------------------------------");
console.log(data.name || filename);
console.log("---------------------------------------------");

console.log(
    "Result:",
    result.bullishImpulse
);

console.log(
    "Expected:",
    data.expected
);

console.log(
    "Impulse type:",
    result.impulseType
);

console.log(
    "Price expansion:",
    result.impulsePercent.toFixed(2) + "%"
);

console.log(
    "Volume:",
    result.impulseVolume.toLocaleString()
);

if (result.bullishStructure === null)
{
    console.log(
        "Bullish structure: N/A (one candle)"
    );
}
else
{
    console.log(
        "Bullish structure:",
        result.bullishStructure
    );
}

console.log(
    "Impulse low:",
    result.impulseLow
);

console.log(
    "Impulse high:",
    result.impulseHigh
);

const passed =
    result.bullishImpulse === data.expected;

console.log(
    "PASS:",
    passed
);

if (!passed)
{
    console.log(
        "Reasons:",
        result.reasons
    );
}