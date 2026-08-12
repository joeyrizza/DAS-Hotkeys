# Dynamic Sizing Hotkey
This hotkey automatically calculates my position size based on my current risk allowance, the distance to my stop, and the potential execution risk of my stop order. It adjusts my size throughout the day based on my realized gains/losses, prevents me from taking oversized positions, and automatically places the entry with a protective stop.

It's a dynamic risk-based entry hotkey. Instead of buying a fixed share size, it calculates my size from my allowed dollar risk and my stop distance. My risk allowance scales up or down based on my realized P&L, and the sizing includes my stop-limit buffer so I don't underestimate my downside. The goal is that every trade has a consistent maximum loss regardless of the stock price or stop placement.


## How it works
### 1. Peak Profit Drawdown Protection
Upon execution the hotkey uses a **PeakRealized high-water mark** to protect profits earned during the trading session.

`$PeakRealized` records the highest realized P&L reached during the day. Once realized profit reaches the minimum threshold for drawdown protection, the hotkey monitors how much profit has been given back from that peak.

The protection is controlled by:

- `$MinimumPeakProfitForDrawdownProtection` — minimum realized profit required before drawdown protection activates. This scales automatically with `$MaxShares` and `$MaximumRiskPerShare`.
- `$MaximumAllowedDrawdownPercent` — maximum percentage of peak realized profit that can be given back before trading is locked out. Currently set to `50%`.

#### Example

With `$MaxShares=200` and `$MaximumRiskPerShare=.10`:

- Maximum risk budget = `$20`
- Drawdown protection activates once `$PeakRealized` reaches `$10`
- Maximum allowed drawdown = `50%` of peak realized profit

| Peak Realized | Lockout Threshold |
|---:|---:|
| $10 | $5 |
| $15 | $7.50 |
| $20 | $10 |
| $30 | $15 |
| $50 | $25 |

For example, if the session reaches a **+$30 PeakRealized** and subsequently falls to **+$14**, the trader has given back `$16`, or 53.3% of the peak profit. The hotkey will prevent additional trades and display a **Daily drawdown limit reached** message.

Importantly, this protection is based on **realized P&L only**. Unrealized losses on an open position do not trigger the daily drawdown lockout. Individual trades are still managed separately through the technical stop, stop-limit offset, and position-sizing risk calculations.

The high-water mark also does **not decrease** when profits are given back. This prevents a losing trade from immediately reducing the earned scaling tier.
### 2. Determine today's risk budget

If drawdown protection has not been activated, the hotkey starts with a maximum risk amount based on my full position size and desired cents-per-share risk. That risk is scaled down when I am losing or starting the day, and gradually increases as I build profits.

Example:

```
Maximum risk budget: $20

Starting risk:
25% = $5

At $50 realized profit:
100% = $20
```

---

### 3. Determine the real risk per share

The hotkey calculates the distance from entry to my technical stop, then adds the stop-limit offset because that represents additional downside exposure if the stock moves quickly.

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

### 4. Calculate position size

The hotkey divides my allowed dollar risk by my effective risk per share.

Example:

```
Allowed risk:       $5.00

Effective risk:
$0.12/share

Position:
$5 / $0.12 = 41 shares
```

---

### 5. Apply safety limits

Before sending the order, it checks:

* Maximum share limit
* Maximum dollar position value
* Stop is not above entry
* Stop is not too close to entry

---

### 6. Submit the trade

It then:

1. Sends the buy order.
2. Immediately attaches a stop-loss order.
3. Uses the stop-limit offset to prioritize getting out of the trade.

## Variables

### Position & Account Configuration

| Variable | Example Value | Description |
|---|---:|---|
| `$BuyPrice` | `Ask` | The current ask price used as the intended entry price. |
| `$MaxShares` | `200` | Absolute maximum number of shares the hotkey is allowed to purchase. This also determines the maximum risk budget and several scaling thresholds. |
| `$MaxLongVal` | `2000` | Maximum dollar value allowed for a long position. The final share count is reduced if the calculated position would exceed this value. |
| `$Account` | `GetAccountObj(ACCOUNT)` | Reference to the current DAS account object. Used to retrieve account-level information such as realized P&L. |
| `$Realized` | Account P&L | Current realized P&L for the trading session. This is calculated from the account's current and opening equity values. |
