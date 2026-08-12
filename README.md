# Dynamic Sizing Hotkey
This hotkey automatically calculates my position size based on my current risk allowance, the distance to my stop, and the potential execution risk of my stop order. It adjusts my size throughout the day based on my realized gains/losses, prevents me from taking oversized positions, and automatically places the entry with a protective stop.

It's a dynamic risk-based entry hotkey. Instead of buying a fixed share size, it calculates my size from my allowed dollar risk and my stop distance. My risk allowance scales up or down based on my realized P&L, and the sizing includes my stop-limit buffer so I don't underestimate my downside. The goal is that every trade has a consistent maximum loss regardless of the stock price or stop placement.


If I were documenting the logic, I'd break it down like this:

## 1. Determine today's risk budget

> The hotkey starts with a maximum risk amount based on my full position size and desired cents-per-share risk. That risk is scaled down when I am losing or starting the day, and gradually increases as I build profits.

Example:

```
Maximum risk budget: $20

Starting risk:
25% = $5

At $50 realized profit:
100% = $20
```

---

## 2. Determine the real risk per share

> The hotkey calculates the distance from entry to my technical stop, then adds the stop-limit offset because that represents additional downside exposure if the stock moves quickly.

Example:

```
Entry:              $8.03
Technical stop:     $7.96
Technical risk:     $0.07

Stop-limit offset:  $0.05

Effective risk:
$0.07 + $0.05 = $0.12/share
```

---

## 3. Calculate position size

> The hotkey divides my allowed dollar risk by my effective risk per share.

Example:

```
Allowed risk:       $5.00

Effective risk:
$0.12/share

Position:
$5 / $0.12 = 41 shares
```

---

## 4. Apply safety limits

Before sending the order, it checks:

* Maximum share limit
* Maximum dollar position value
* Stop is not above entry
* Stop is not too close to entry

---

## 5. Submit the trade

It then:

1. Sends the buy order.
2. Immediately attaches a stop-loss order.
3. Uses the stop-limit offset to prioritize getting out of the trade.

