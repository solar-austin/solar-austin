import json
import re
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq
import requests


BUCKET_INDEX_URL = "https://oedi-data-lake.s3.amazonaws.com/?prefix=tracking-the-sun/"
BUCKET_BASE_URL = "https://oedi-data-lake.s3.amazonaws.com/"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "personal-solar" / "install-cost-lookup.json"

ZIP_MIN_SAMPLES = 15
UTILITY_MIN_SAMPLES = 30
STATE_MIN_SAMPLES = 50
MIN_SYSTEM_SIZE_KW = 1.0
MAX_SYSTEM_SIZE_KW = 25.0
MIN_PRICE_PER_KW = 500.0
MAX_PRICE_PER_KW = 20000.0

KEY_PATTERN = re.compile(r"<Key>tracking-the-sun/(\d{4})/state=([A-Z]{2})/([^<]+\.parquet)</Key>")
RESIDENTIAL_HINTS = ("res", "resi", "single", "home", "house")


def fetch_bucket_index():
    response = requests.get(BUCKET_INDEX_URL, timeout=60)
    response.raise_for_status()
    return response.text


def latest_keys_by_state(xml_text):
    latest = {}
    for year_text, state_code, filename in KEY_PATTERN.findall(xml_text):
        year = int(year_text)
        key = f"tracking-the-sun/{year_text}/state={state_code}/{filename}"
        current = latest.get(state_code)
        if current is None or year > current["year"]:
            latest[state_code] = {
                "year": year,
                "key": key,
            }
    return latest


def download_to_temp(url):
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".parquet")
    tmp.write(response.content)
    tmp.flush()
    tmp.close()
    return Path(tmp.name)


def normalize_string(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == "-1":
        return None
    return text


def normalize_zip(value):
    text = normalize_string(value)
    if not text:
        return None
    digits = "".join(char for char in text if char.isdigit())
    if len(digits) < 5:
        return None
    return digits[:5]


def looks_residential(value):
    text = normalize_string(value)
    if text is None:
        return True
    lowered = text.lower()
    return any(hint in lowered for hint in RESIDENTIAL_HINTS)


def read_state_rows(parquet_path):
    parquet_file = pq.ParquetFile(str(parquet_path))
    schema_names = set(parquet_file.schema.names)
    system_size_field = None
    for candidate in ("pv_system_size_dc", "system_size_dc", "system_size"):
        if candidate in schema_names:
            system_size_field = candidate
            break
    if system_size_field is None:
        raise ValueError(f"Could not find a system size field in {parquet_path}")
    battery_fields = [
        field for field in ("battery_price", "battery_rated_capacity_kw", "battery_rated_capacity_kwh", "battery_system")
        if field in schema_names
    ]
    columns = [
        "zip_code",
        "utility_service_territory",
        "total_installed_price",
        system_size_field,
        "customer_segment",
        "third_party_owned" if "third_party_owned" in schema_names else None,
    ] + battery_fields
    columns = [column for column in columns if column]
    table = pq.read_table(str(parquet_path), columns=columns)
    rows = table.to_pylist()
    for row in rows:
        row["pv_system_size_dc"] = row.pop(system_size_field, None)
    return rows


def has_battery(row):
    if row.get("battery_system") not in (None, -1, 0, False):
        return True
    if row.get("battery_price") not in (None, -1, 0):
        return True
    if row.get("battery_rated_capacity_kw") not in (None, -1, 0):
        return True
    if row.get("battery_rated_capacity_kwh") not in (None, -1, 0):
        return True
    return False


def is_third_party_owned(row):
    return row.get("third_party_owned") not in (None, -1, 0, False)


def median(sorted_values):
    count = len(sorted_values)
    if count == 0:
        return None
    middle = count // 2
    if count % 2 == 1:
        return sorted_values[middle]
    return (sorted_values[middle - 1] + sorted_values[middle]) / 2


def summarize_values(values):
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "medianCostPerKw": round(median(ordered), 2),
    }


def build_lookup():
    xml_text = fetch_bucket_index()
    all_keys = defaultdict(list)
    for year_text, state_code, filename in KEY_PATTERN.findall(xml_text):
        all_keys[state_code].append({
            "year": int(year_text),
            "key": f"tracking-the-sun/{year_text}/state={state_code}/{filename}",
        })
    latest = latest_keys_by_state(xml_text)

    zip_prices = defaultdict(list)
    utility_prices = defaultdict(list)
    state_prices = defaultdict(list)
    zip_utility_votes = defaultdict(Counter)
    state_sources = {}

    for state_code in sorted(latest):
        candidates = sorted(all_keys[state_code], key=lambda item: item["year"], reverse=True)
        selected_rows = None
        selected_info = None
        for info in candidates:
            url = BUCKET_BASE_URL + info["key"]
            parquet_path = download_to_temp(url)
            try:
                current_rows = []
                for row in read_state_rows(parquet_path):
                    system_size_kw = row.get("pv_system_size_dc")
                    installed_price = row.get("total_installed_price")
                    if system_size_kw in (None, -1) or installed_price in (None, -1):
                        continue
                    system_size_kw = float(system_size_kw)
                    installed_price = float(installed_price)
                    if system_size_kw < MIN_SYSTEM_SIZE_KW or system_size_kw > MAX_SYSTEM_SIZE_KW:
                        continue
                    if not looks_residential(row.get("customer_segment")):
                        continue
                    if has_battery(row):
                        continue
                    if is_third_party_owned(row):
                        continue

                    price_per_kw = installed_price / system_size_kw
                    if price_per_kw < MIN_PRICE_PER_KW or price_per_kw > MAX_PRICE_PER_KW:
                        continue

                    current_rows.append({
                        "zip_code": normalize_zip(row.get("zip_code")),
                        "utility": normalize_string(row.get("utility_service_territory")),
                        "price_per_kw": price_per_kw,
                    })
            finally:
                parquet_path.unlink(missing_ok=True)

            if current_rows:
                selected_rows = current_rows
                selected_info = info
                break

        if not selected_rows or not selected_info:
            continue

        state_sources[state_code] = {
            "year": selected_info["year"],
            "key": selected_info["key"],
        }

        for row in selected_rows:
            price_per_kw = row["price_per_kw"]
            zip_code = row["zip_code"]
            utility = row["utility"]
            state_prices[state_code].append(price_per_kw)
            if utility:
                utility_prices[f"{state_code}|{utility}"].append(price_per_kw)
            if zip_code:
                zip_prices[f"{state_code}|{zip_code}"].append(price_per_kw)
                if utility:
                    zip_utility_votes[f"{state_code}|{zip_code}"][utility] += 1

    export = {
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": "Berkeley Lab Tracking the Sun via OEDI",
            "bucketIndexUrl": BUCKET_INDEX_URL,
        },
        "filters": {
            "systemSizeKw": {
                "min": MIN_SYSTEM_SIZE_KW,
                "max": MAX_SYSTEM_SIZE_KW,
            },
            "pricePerKw": {
                "min": MIN_PRICE_PER_KW,
                "max": MAX_PRICE_PER_KW,
            },
            "residentialRule": "customer_segment is residential-like when present; unknown values allowed; system size band used as main residential proxy",
            "batteryRule": "exclude rows with any battery field populated or battery_system flagged",
            "ownershipRule": "exclude rows flagged as third_party_owned",
        },
        "thresholds": {
            "zipMinSamples": ZIP_MIN_SAMPLES,
            "utilityMinSamples": UTILITY_MIN_SAMPLES,
            "stateMinSamples": STATE_MIN_SAMPLES,
        },
        "states": {},
        "utilities": {},
        "zips": {},
    }

    for state_code, values in sorted(state_prices.items()):
        if not values:
            continue
        summary = summarize_values(values)
        summary["year"] = state_sources[state_code]["year"]
        summary["sourceKey"] = state_sources[state_code]["key"]
        export["states"][state_code] = summary

    for key, values in sorted(utility_prices.items()):
        if not values:
            continue
        state_code, utility = key.split("|", 1)
        summary = summarize_values(values)
        summary["stateCode"] = state_code
        summary["utility"] = utility
        summary["year"] = state_sources[state_code]["year"]
        export["utilities"][key] = summary

    for key, values in sorted(zip_prices.items()):
        if not values:
            continue
        state_code, zip_code = key.split("|", 1)
        summary = summarize_values(values)
        summary["stateCode"] = state_code
        summary["zipCode"] = zip_code
        summary["year"] = state_sources[state_code]["year"]
        dominant_utility = None
        if zip_utility_votes[key]:
            dominant_utility = zip_utility_votes[key].most_common(1)[0][0]
        summary["dominantUtility"] = dominant_utility
        export["zips"][key] = summary

    OUTPUT_PATH.write_text(json.dumps(export, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")
    print(f"States: {len(export['states'])}, utilities: {len(export['utilities'])}, zips: {len(export['zips'])}")


if __name__ == "__main__":
    build_lookup()
