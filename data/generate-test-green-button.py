"""
Generate a synthetic Austin Energy Green Button CSV for testing.
Produces 15-minute interval data for a full year matching a realistic
Austin gas-heat household (~1,167 kWh/month average, summer-peaked).
"""

import csv
import math
import random
from datetime import datetime, timedelta

random.seed(99)

ANNUAL_KWH = 1450 * 12  # ~17,400 kWh/year — larger home, clearly different from default 1,167

# Realistic Austin gas-heat shape with ±20% month-to-month noise baked in
BASE_SHAPE = [0.783, 0.774, 0.784, 0.859, 1.039, 1.270,
              1.443, 1.425, 1.173, 0.894, 0.775, 0.779]
MONTHLY_SHAPE = [v * random.uniform(0.82, 1.18) for v in BASE_SHAPE]
mean_shape = sum(MONTHLY_SHAPE) / 12
MONTHLY_SHAPE = [v / mean_shape for v in MONTHLY_SHAPE]

# Hourly load shape (fraction of daily total, peaks late afternoon)
BASE_HOURLY = [0.62, 0.56, 0.53, 0.51, 0.52, 0.58, 0.71, 0.82,
               0.85, 0.81, 0.77, 0.75, 0.76, 0.79, 0.84, 0.92,
               1.00, 0.98, 0.94, 0.90, 0.88, 0.83, 0.76, 0.68]
_base_sum = sum(BASE_HOURLY)
BASE_HOURLY = [v / _base_sum for v in BASE_HOURLY]  # sums to 1.0


def daily_hourly_shape():
    """Return a normalized 24-value load profile with realistic day-level noise.

    Three sources of variation per day:
    1. Per-hour multiplicative noise (~25% std) — some hours randomly high/low.
    2. Peak-shift: slide the whole curve ±1 hour (weekend/habit variation).
    3. Morning-spike coin-flip: occasional early-morning load bump (9 AM coffee etc).
    """
    # Per-hour noise
    noisy = [v * random.gauss(1.0, 0.25) for v in BASE_HOURLY]

    # Random peak-hour shift of -1, 0, or +1
    shift = random.randint(-1, 1)
    if shift:
        noisy = noisy[shift:] + noisy[:shift]

    # Occasional morning bump (hour 7-9)
    if random.random() < 0.35:
        for h in range(7, 10):
            noisy[h] *= random.uniform(1.3, 1.8)

    # Clamp negatives and normalize
    noisy = [max(0.0, v) for v in noisy]
    total = sum(noisy) or 1.0
    return [v / total for v in noisy]


def days_in_month(year, month):
    if month == 12:
        return 31
    return (datetime(year, month + 1, 1) - datetime(year, month, 1)).days


def monthly_kwh(month_idx):
    """Target kWh for this month (0-based)."""
    return ANNUAL_KWH * MONTHLY_SHAPE[month_idx] / 12


def interval_kwh(day_shape, month_idx, hour, days):
    """kWh for one 15-min interval, with small random noise."""
    day_kwh = monthly_kwh(month_idx) / days
    kwh = day_kwh * day_shape[hour] / 4  # 4 intervals per hour
    noise = random.gauss(1.0, 0.06)  # small interval-level jitter on top
    return max(0.0, kwh * noise)


OUTPUT = 'C:/Users/altbi/Documents/GitHub/solar-austin/data/test-green-button.csv'

with open(OUTPUT, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['DATE', 'START TIME', 'END TIME', 'USAGE', 'UNITS', 'COST', 'NOTES'])

    year = 2024
    for month in range(1, 13):
        days = days_in_month(year, month)
        for day in range(1, days + 1):
            date_str = f'{year}-{month:02d}-{day:02d}'
            day_shape = daily_hourly_shape()  # unique profile per day
            for hour in range(24):
                for quarter in range(4):
                    start_min = hour * 60 + quarter * 15
                    end_min = start_min + 15
                    start_str = f'{start_min // 60:02d}:{start_min % 60:02d}'
                    end_str = f'{end_min // 60:02d}:{end_min % 60:02d}'
                    kwh = interval_kwh(day_shape, month - 1, hour, days)
                    cost = kwh * 0.12  # ~12 cents/kWh
                    writer.writerow([date_str, start_str, end_str,
                                     f'{kwh:.4f}', 'kWh', f'${cost:.4f}', ''])

print(f'Written to {OUTPUT}')

# Print monthly summary
print('\nMonthly totals (kWh):')
import collections
totals = collections.defaultdict(float)
with open(OUTPUT) as f:
    reader = csv.DictReader(f)
    for row in reader:
        month = row['DATE'][5:7]
        totals[month] += float(row['USAGE'])
for m, v in sorted(totals.items()):
    print(f'  {m}: {v:.0f} kWh')
