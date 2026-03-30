"""
Compute monthly electricity usage profiles by heating type for Texas
using RECS 2020 microdata + Austin HDD/CDD to distribute loads.

RECS gives annual end-use kWh (KWHSPH=heating, KWHCOL=cooling, others).
We distribute heating across months by HDD share and cooling by CDD share,
then combine with a flat baseline for all other uses.

Usage:
  pip install pandas requests
  python data/fetch-heating-profiles.py

Output: normalized monthly profiles for gas, electric resistance, heat pump.
"""

import os
import requests
import pandas as pd

MICRODATA_URL = 'https://www.eia.gov/consumption/residential/data/2020/csv/recs2020_public_v7.csv'
CACHE_PATH = os.path.join(os.path.dirname(__file__), 'recs2020_microdata.csv')

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

# Austin HDD/CDD (base 65°F), 30-year normals
AUSTIN_HDD = [374, 261, 124, 23,  1,   0,   0,   0,   4,   56,  195, 330]
AUSTIN_CDD = [0,   0,   18,  92,  254, 462, 617, 601, 374, 121, 5,   0]

# RECS 2020 FUELHEAT codes
HEATING_GROUPS = {
    'gas':        [1, 2],   # Natural gas or propane (no significant winter electricity for heat)
    'electric':   [5],      # Electric resistance
    'heat_pump':  [8],      # Heat pump (electric, but efficient)
}

# End-use columns available in RECS 2020
HEAT_COL  = 'KWHSPH'   # Space heating electricity
COOL_COL  = 'KWHCOL'   # Space cooling electricity
WATER_COL = 'KWHWTH'   # Water heating
OTHER_COLS = ['KWHRFG', 'KWHRFG1', 'KWHFRZ', 'KWHCOK', 'KWHMICRO',
              'KWHCW', 'KWHCDR', 'KWHDWH', 'KWHLGT', 'KWHTVREL',
              'KWHCFAN', 'KWHNEC', 'KWHOTH']


def download_microdata():
    print(f'Downloading RECS 2020 microdata (~30 MB)...')
    r = requests.get(MICRODATA_URL, stream=True, timeout=120,
                     headers={'User-Agent': 'Mozilla/5.0'})
    r.raise_for_status()
    with open(CACHE_PATH, 'wb') as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)
    print(f'Saved to {CACHE_PATH}')


def load_data():
    if not os.path.exists(CACHE_PATH):
        download_microdata()
    else:
        print(f'Using cached microdata: {CACHE_PATH}')

    needed = ['state_postal', 'FUELHEAT', 'NWEIGHT',
              HEAT_COL, COOL_COL, WATER_COL] + OTHER_COLS
    df = pd.read_csv(CACHE_PATH, usecols=lambda c: c in needed)
    df = df.fillna(0)
    return df


def normalize_shares(values):
    total = sum(values)
    if total == 0:
        return [1/len(values)] * len(values)
    return [v / total for v in values]


def build_monthly_profile(avg_heat_kwh, avg_cool_kwh, avg_other_kwh):
    """Distribute annual end-use kWh across 12 months using HDD/CDD shares."""
    hdd_share = normalize_shares(AUSTIN_HDD)
    cdd_share = normalize_shares(AUSTIN_CDD)
    other_share = [1/12] * 12  # flat baseline

    monthly = []
    for i in range(12):
        kwh = (avg_heat_kwh  * hdd_share[i] +
               avg_cool_kwh  * cdd_share[i] +
               avg_other_kwh * other_share[i])
        monthly.append(kwh)
    return monthly


def weighted_avg(df, col):
    return (df[col] * df['NWEIGHT']).sum() / df['NWEIGHT'].sum()


def normalize_profile(values):
    mean = sum(values) / len(values)
    return [round(v / mean, 3) for v in values]


def main():
    df = load_data()

    # Filter to Texas
    tx = df[df['state_postal'] == 'TX'].copy()
    print(f'\nTexas households in RECS: {len(tx):,}  '
          f'(weighted: {tx["NWEIGHT"].sum():,.0f})')

    results = {}
    for name, fuel_codes in HEATING_GROUPS.items():
        subset = tx[tx['FUELHEAT'].isin(fuel_codes)]
        if len(subset) == 0:
            print(f'\n{name}: no samples found')
            continue

        avg_heat  = weighted_avg(subset, HEAT_COL)
        avg_cool  = weighted_avg(subset, COOL_COL)
        avg_other = sum(weighted_avg(subset, c) for c in OTHER_COLS
                        if c in subset.columns)

        print(f'\n{name} (n={len(subset):,}):')
        print(f'  Avg annual kWh — heat: {avg_heat:.0f}, '
              f'cool: {avg_cool:.0f}, other: {avg_other:.0f}')

        monthly = build_monthly_profile(avg_heat, avg_cool, avg_other)
        profile = normalize_profile(monthly)
        results[name] = profile

        print(f'  Monthly kWh:  {[round(v) for v in monthly]}')
        print(f'  Normalized:   {profile}')

    print('\n\n--- JS-ready arrays ---')
    for name, profile in results.items():
        arr = '[' + ', '.join(str(v) for v in profile) + ']'
        print(f'// {name}')
        print(f'normalizeProfile({arr})\n')


if __name__ == '__main__':
    main()
