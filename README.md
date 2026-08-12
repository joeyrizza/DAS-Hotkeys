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

### Risk Configuration

| Variable | Example Value | Description |
|---|---:|---|
| `$MaximumRiskPerShare` | `.10` | Maximum amount of risk allocated per share when operating at full risk. Used to calculate the maximum risk budget and scaling thresholds. |
| `$MinimumRiskPercent` | `.50` | Percentage of the maximum risk budget available when the session has not yet reached the scaling threshold. For example, `.50` means the trader starts at 50% of maximum risk. |
| `$MaximumRiskBudget` | `$20` | Maximum dollar risk available when operating at 100% risk. Calculated as `$MaxShares * $MaximumRiskPerShare`. |
| `$TodaysRiskBudgetBasedOnRealized` | Dynamic | Current dollar risk budget allowed based on the session's `PeakRealized` profit and scaling level. |
| `$RiskScalingPercent` | `0.0 - 1.0` | Percentage of the distance between the scaling-start profit threshold and the full-risk profit threshold that has been reached. Clamped between `0` and `1`. |
| `$RiskBasedShareCount` | Dynamic | Number of shares that can be purchased based solely on the current risk budget and the effective risk per share. |
| `$FinalShareCount` | Dynamic | Final number of shares to purchase after applying the risk limit, maximum share limit, and maximum position-value limit. |

### Profit-Based Position Scaling

| Variable | Example Value | Description |
|---|---:|---|
| `$ProfitThresholdToBeginScaling` | `$10` | Peak realized profit at which position sizing begins increasing above the minimum risk level. Calculated dynamically from `$MaxShares` and `$MaximumRiskPerShare`. |
| `$ProfitThresholdForFullRisk` | `$50` | Peak realized profit at which the hotkey reaches 100% of the maximum risk budget. Currently calculated as 5× `$ProfitThresholdToBeginScaling`. |
| `$PeakRealized` | Dynamic | The highest realized P&L reached during the trading session. This is the high-water mark used for both position-size scaling and drawdown protection. |
| `$MinimumRiskPercent` | `.50` | Starting percentage of the maximum risk budget before the scaling threshold is reached. |
| `$RiskScalingPercent` | `0 - 1` | Determines how far the trader has progressed from the scaling threshold to the full-risk threshold. `0` represents minimum risk and `1` represents maximum risk. |

### Peak Profit Drawdown Protection

| Variable | Example Value | Description |
|---|---:|---|
| `$DrawdownFromPeak` | Dynamic | Dollar amount of realized profit given back from the session's `$PeakRealized`. Calculated as `$PeakRealized - $Realized`. |
| `$MaximumAllowedDrawdownPercent` | `.50` | Maximum percentage of peak realized profit that can be given back before trading is locked out. `.50` represents a 50% drawdown limit. |
| `$MinimumPeakProfitForDrawdownProtection` | `$10` | Minimum peak realized profit required before the drawdown protection becomes active. Calculated dynamically as 50% of `$MaximumRiskBudget`. |

### Stop & Execution Configuration
| Variable | Example Value | Description |
| --- | --- | --- |
| `$StopTooCloseWarn` | `.05` | Warning threshold for a stop that is considered too close to the entry price. |
| `$MinimumAllowedStopDistance` | `.05` | Minimum permitted distance between the entry price and selected stop. The trade is rejected if the stop is at or below this distance. |
| `$StopLimitPriceOffset` | `.05` | Additional price distance applied to the stop-limit order to increase the probability of execution during fast moves. This is included in the effective risk-per-share calculation. |
| `$SelectedStopPrice` | `price` | Stop price selected by the trader, typically by clicking/double-clicking on the chart. |
| `$TechnicalStopDistance` | Dynamic | Distance between the entry price and the selected technical stop. |
| `$EffectiveRiskPerShare` | Dynamic | Total planned risk per share, including both the technical stop distance and the stop-limit offset. Calculated as `$TechnicalStopDistance + $StopLimitPriceOffset`. |
| `$TechnicalStopRisk` | Dynamic | Dollar loss associated with the technical stop alone. |
| `$AdditionalOffsetRisk` | Dynamic | Additional potential dollar loss created by the stop-limit offset. |
| `$WorstCasePlannedRisk` | Dynamic | Maximum planned loss based on the final share count and the effective risk per share. |
| `$CalculatedPositionValue` | Dynamic | Dollar value of the position before applying the maximum position-value restriction. |
| `$MaxSharesAllowedByPositionValue` | Dynamic | Maximum number of shares permitted by `$MaxLongVal` at the current buy price. |
| `$ActualPosVal` | Dynamic | Final dollar value of the position after all share-count restrictions have been applied. |
