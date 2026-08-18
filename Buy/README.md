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
- `MinimumAllowedDrawdown` - Lockout won't occur until at least this amount has been reached.
#### Example

With `$MaxShares=200` and `$MaximumRiskPerShare=.10`:

- Maximum risk budget = `$20`
- Drawdown protection activates once `$PeakRealized` reaches `$10`
- Maximum allowed drawdown = `50%` of peak realized profit
- Drawdown floor set to `$15` (`$MaximumRiskBudget*.75`) 
| Peak Realized | Allowed Drawdown | Lockout At |
|---|---|---|
| $10 | $15 | -$5 |
| $14 | $15 | -$1 |
| $20 | $15 | +$5 |
| $30 | $15 | +$15|
| $40 | $20 | +$20|
| $50 | $25 | +$25|

For example, if the session reaches a **+$30 PeakRealized** and subsequently falls to **+$14**, the trader has given back `$16`, or 53.3% of the peak profit. The hotkey will prevent additional trades and display a **Daily drawdown limit reached** message.

Importantly, this protection is based on **realized P&L only**. Unrealized losses on an open position do not trigger the daily drawdown lockout. Individual trades are still managed separately through the technical stop, stop-limit offset, and position-sizing risk calculations.

Trial: The high-water mark also does **not decrease** when profits are given back. This prevents a losing trade from immediately reducing the earned scaling tier.
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

## Configuration Variables
These variables have configurable values.
| Variable | Example Value | Description |
|---|---|---|
| `$BuyPrice` | `Ask` | The value used as the intended entry price. |
| `$MaxShares` | `200` | Absolute maximum number of shares the hotkey is allowed to purchase. This also determines the maximum risk budget and several scaling thresholds. |
| `$MaximumRiskPerShare` | `.10` | Maximum amount of risk allocated per share when operating at full risk. Used to calculate the maximum risk budget and scaling thresholds. |
| `$StartingRiskPercent` | `.50` | Percentage of the maximum risk budget available when the session has not yet reached the scaling threshold. For example, `.50` means the trader starts at 50% of maximum risk. |
| `$MaxLongVal` | `2000` | Maximum dollar value allowed for a long position. The final share count is reduced if the calculated position would exceed this value. |
| `$StopLimitPriceOffset` | `.05` | Additional price distance applied to the stop-limit order to increase the probability of execution during fast drops. This is included in the effective risk-per-share calculation. |
| `$MinimumAllowedStopDistance` | `.05` | Minimum permitted distance between the entry price and selected stop. The trade is rejected if the stop is at or below this distance. |
| `$MaximumAllowedDrawdownPercent` | `.50` | Maximum percentage of peak realized profit that can be given back before trading is locked out. `.50` represents a 50% drawdown limit. |

## Non-Configurable Variable Definitions
### Position & Account Configuration

| Variable | Example Value | Description |
|---|---|---|
| `$Account` | `AccountObject` | Reference to the current DAS account object. Used to retrieve account-level information such as realized P&L. |
| `$Realized` | `$2.23` | Current realized P&L for the trading session. This is calculated from the account's current and opening equity values. |

### Risk Variables

| Variable | Example Value | Description | Calculated From |
|---|---|---|---|
| `$MaximumRiskBudget` | `$20` | Calculated maximum dollar risk available when operating at 100% risk. | `$MaxShares * $MaximumRiskPerShare`. |
| `$TodaysRiskBudgetBasedOnRealized` | `$10.00` | Current dollar risk budget allowed based on the session's `PeakRealized` profit and scaling level. | `$MaximumRiskBudget * ($StartingRiskPercent + ($RiskScalingPercent*(1-$StartingRiskPercent)))` |
| `$RiskBasedShareCount` | `83.333` | Number of shares that can be purchased based solely on the current risk budget and the effective risk per share. | `$TodaysRiskBudgetBasedOnRealized/$EffectiveRiskPerShare` |
| `$FinalShareCount` | `50.00` | Final number of shares to purchase after applying the risk limit, maximum share limit, and maximum position-value limit. | `$FinalShareCount=$RiskBasedShareCount; if($RiskBasedShareCount > $MaxShares){$FinalShareCount = $MaxShares; }` |

### Profit-Based Position Scaling

| Variable | Example Value | Description | Calculated From |
|---|---|---|---|
| `$ProfitThresholdToBeginScaling` | `$10` | Peak realized profit (Dollars) at which position sizing begins increasing above the minimum risk level. | `($MaxShares*.5)*$MaximumRiskPerShare` |
| `$ProfitThresholdForFullRisk` | `$50` | Peak realized profit (Dollars) at which the hotkey reaches 100% of the maximum risk budget. | `$ProfitThresholdToBeginScaling*5`. |
| `$PeakRealized` | `$2.23` | The highest realized P&L (Dollars) reached during the trading session. This is the high-water mark used for both position-size scaling and drawdown protection. | `if($Realized > $PeakRealized){ $PeakRealized=$Realized; }` |
| `$RiskScalingPercent` | `0 - 1` | Determines how far the trader has progressed from the scaling threshold to the full-risk threshold. `0` represents minimum risk and `1` represents maximum risk. Clamped between `0` and `1`.| `($PeakRealized-$ProfitThresholdToBeginScaling)  /($ProfitThresholdForFullRisk-$ProfitThresholdToBeginScaling)`|

### Peak Profit Drawdown Protection

| Variable | Example Value | Description | Calculated From |
|---|---|---|---|
| `$DrawdownFromPeak` | `$2.76` | Realized profit (Dollars) given back from the session's `$PeakRealized`. | `$PeakRealized - $Realized` |
| `$MinimumPeakProfitForDrawdownProtection` | `$10` | Minimum peak realized profit required before the drawdown protection becomes active. | `$MaximumRiskBudget*.50;` |
| `$MinimumAllowedDrawdown` | `$15` | Lockout won't occur until at least this amount has been reached. | `$MaximumRiskBudget*.75` |
### Stop & Execution Configuration
| Variable | Example Value | Description | Calculated From |
|---|---|---|---|
| `$SelectedStopPrice` | `4.64` | Stop price selected by the trader, typically by clicking/double-clicking on the chart. | `Price` |
| `$TechnicalStopDistance` | `.10` | Distance between the entry price and the selected technical stop. | `$BuyPrice-$SelectedStopPrice` |
| `$EffectiveRiskPerShare` | `.15` | Total planned risk per share, including both the technical stop distance and the stop-limit offset. | `$TechnicalStopDistance + $StopLimitPriceOffset` |
| `$TechnicalStopRisk` | $10.00 | Dollar loss associated with the technical stop alone. | `$FinalShareCount * $TechnicalStopDistance` |
| `$AdditionalOffsetRisk` | $5.00 | Additional potential dollar loss created by the stop-limit offset. | `$FinalShareCount * $StopLimitPriceOffset` |
| `$WorstCasePlannedRisk` | $15.00 | Maximum planned loss based on the final share count and the effective risk per share. | `$FinalShareCount * $EffectiveRiskPerShare` |
| `$CalculatedPositionValue` | 20.0 | Dollar value of the position before applying the maximum position-value restriction. | `$BuyPrice*$FinalShareCount` |
| `$MaxSharesAllowedByPositionValue` | 73 | Maximum number of shares permitted by `$MaxLongVal` at the current buy price. | `$MaxLongVal/$BuyPrice` |
| `$ActualPosVal` | $384.73 | Final dollar value of the position after all share-count restrictions have been applied. | `$BuyPrice*$FinalShareCount` |
