# Model Formulas, Assumptions, and Improvement Ideas

This document explains the core formulas in `app.js`, identifies implicit assumptions, and proposes practical fixes.

## Scope and units

The dashboard combines three linked models:

1. **11-year annual energy balance** in **TWh** (mix chart + carbon-free KPI).
2. **Single-day reliability stress test** in **MW/MWh** over 24 hours (risk KPI + reliability chart).
3. **2035 cost snapshot** in **$M and $/MWh** (financial table + estimated generation rate KPI).

Key base assumptions:

- Horizon: `YEARS = 11` (2025–2035).
- Base annual load in 2025: `14.2 TWh`.
- Peak load for reliability test: `3150 MW` in 2025-equivalent terms.
- Growth slider applies to both annual load and 2035 peak.

---

## 1) Annual energy model (TWh)

### Load trajectory

For year index `i` (0..10):

- `Load_TWh[i] = 14.2 * (1 + growth/100)^i`

So 2035 is year index 10.

### Existing generation assumptions

- Nuclear is fixed at `3.4 TWh` each year.
- Existing wind and solar use hard-coded year-by-year arrays.

This implies retirements/curtailment are embedded directly rather than computed from capacities.

### New-build generation assumptions

Inputs for new wind/solar/geothermal are labeled **MW/year**. Annual energy in year `i` is:

- `buildYrs = max(0, i - 1)`
- `Resource_TWh[i] = (MW_per_year * buildYrs * 8760 * CF) / 1e6`

With this structure:

- There is a one-year lag before output starts (`i=0,1 => 0` new output).
- By 2035 (`i=10`), multiplier is `9`, which is why reliability later uses `nSolar * 9`, `nWind * 9`, `nGeo * 9`.

### Dispatchable annual energy assumptions

Gas and coal sliders are **MW** (capacity-like), converted to annual energy with fixed capacity factors:

- `Gas_TWh = (Gas_MW * 8760 * 0.05) / 1e6`
- `Coal_TWh = (Coal_MW * 8760 * 0.60) / 1e6`

### Market gap

- `Gap_TWh[i] = max(0, Load_TWh[i] - TotalSupply_TWh[i])`

No over-supply accounting is retained (negative gap is clipped to zero).

---

## 2) Carbon-free KPI

Calculated only for 2035:

- `CarbonSources = gas + coal + gap`
- `CarbonFreePct = ((Load - CarbonSources) / Load) * 100`

Interpretation: any unmet energy (`gap`) is treated as non-carbon-free.

---

## 3) Reliability stress test (24h, MW/MWh)

The reliability model is a **single representative August day** using normalized hourly profiles:

- `PROF.load[h]` scales daily peak into hourly load.
- `PROF.solar[h]` and `PROF.wind[h]` scale variable renewable output by hour.

### Peak in 2035

- `Peak2035_MW = 3150 * (1 + growth/100)^10`

### Hourly supply without battery

For each hour `h`:

- `Load[h] = PROF.load[h] * Peak2035_MW`
- `SupplyNoBatt[h] = NukeMW + gas + coal + geo + sol*PROF.solar[h] + win*PROF.wind[h]*0.2`

Notable assumption: wind is additionally multiplied by `0.2` during reliability (beyond hourly profile scaling).

### Battery model

- Power limit: `batt MW`.
- Energy capacity: `E_cap = batt * 4 MWh` (fixed 4-hour duration).
- Two-pass SoC approach approximates cyclic day-to-day initial state.
- No round-trip efficiency losses.

### Risk metric

- `risk` increments for each hour where `load > supply + 10` MW.

So risk is a count of deficit hours, with a 10 MW deadband.

---

## 4) Cost and rate model (2035 snapshot)

For each resource `k` in 2035:

- `Cost_k_M = Volume_k_TWh * (BasePrice_k + TxAdder_k)`

Because `1 TWh = 1e6 MWh`, multiplying TWh by `$/MWh` yields dollars in millions (`$M`) directly.

Transmission adder (`tx`) applies only to “remote” resources:

- `nuke, coal, exWind, exSolar, newWind, newSolar, gap`

Average cost:

- `Avg$/MWh = TotalCost_M / Load_TWh`

Displayed generation rate KPI:

- `Rate_cents_per_kWh = (TotalCost_M / Load_TWh) / 10`

(Conversion: `$/MWh` to `¢/kWh` divides by 10.)

---

## Key assumptions to be aware of

1. **Hard-coded existing wind/solar trajectories** (arrays) rather than capacity-based lifecycle modeling.
2. **Single annual CF for each technology** (no weather-year variability).
3. **Gas annual CF fixed at 5%** while reliability treats gas as fully dispatchable at nameplate each hour.
4. **Reliability uses one synthetic day** instead of many weather/load days.
5. **Battery has no efficiency, degradation, or reserve constraints**.
6. **Gap is always available at fixed price (`$120/MWh`) and fully remote with TX adder**.
7. **No explicit emissions accounting** beyond a binary carbon-free proxy.
8. **No curtailment/export economics** (surplus energy is not valued).

---

## Suggested fixes and improvements

## A) High-impact consistency fixes (do first)

1. **Unify gas/coal treatment between annual and hourly models**
   - Today, gas can be very low-energy (5% CF annually) but fully firm hourly in reliability.
   - Fix: either (a) add explicit fuel/availability limits in reliability, or (b) derive annual gas/coal energy from simulated dispatch instead of fixed CF.

2. **Parameterize the wind reliability derate (`*0.2`)**
   - Make this a visible assumption input (e.g., “peak wind availability”).
   - Add tooltip text to explain why reliability wind differs from annual CF.

3. **Replace hard-coded exWind/exSolar arrays with capacity-retirement inputs**
   - Keep default arrays as presets, but compute from `existing MW * CF * availability` where possible.

4. **Define and display a formal reserve margin metric**
   - Add KPI like `min(hourly supply - load)` and `planning reserve %`.

## B) Reliability realism improvements

5. **Run multi-day / multi-scenario reliability instead of one day**
   - Add a small set of stress profiles (hot calm day, cloudy low-wind day, shoulder season, etc.).
   - Report percentile risk (e.g., P95 deficit hours).

6. **Add battery round-trip efficiency and optional charge source rules**
   - Example: 90% RTE, optional constraint that charging must come from surplus renewables.

7. **Represent outage/forced-derate for thermal/geothermal/nuclear**
   - Introduce availability factors by hour or scenario.

## C) Cost model improvements

8. **Split energy and capacity value for firm resources**
   - Add simple fixed annual capacity payment (`$/kW-yr`) for gas/geo/battery and keep variable `$/MWh` for energy.

9. **Model gap as scarcity pricing tiers**
   - Instead of one `gap` price, use piecewise values (`normal imports`, `scarcity imports`, `unserved energy VOLL`).

10. **Expose TX adder by resource class**
    - Wind/solar imports may not share the same effective adder as nuclear/coal/gap.

## D) Transparency and UX improvements

11. **Add an “Assumptions panel” in UI**
    - Display key constants (CFs, wind derate, battery duration, risk deadband, base load/peak).

12. **Add unit annotations in tooltips/table headers**
    - Reduce ambiguity between MW, MW/yr, MWh, TWh.

13. **Add downloadable scenario JSON**
    - Save/load slider state and edited prices for reproducibility.

---

## Recommended implementation roadmap

1. **Refactor model into pure functions** (`buildAnnualMix`, `simulateReliability`, `computeCosts`) and add unit tests.
2. **Lift constants into a centralized `ASSUMPTIONS` object** and render it in UI.
3. **Introduce scenario set for reliability** and aggregate risk metrics.
4. **Evolve cost model to include capacity costs + scarcity tiers**.
5. **Add calibration mode** (fit assumptions to known historical year values).

This sequence gives immediate trust/consistency gains before larger feature expansion.
