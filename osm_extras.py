"""Collect two small lists from OpenStreetMap (ODbL):

  data/dive_sites_us_osm.json  places tagged for scuba diving (not shops or clubs)
  data/slot_canyons_osm.json  features in the Southwest with "slot canyon" in the name

Each query is cached in data/osm_cache/, so a rerun only fetches what is missing.
No API key needed.
"""
import json
import time
from pathlib import Path

import requests

DATA = Path(__file__).parent / "data"
CACHE = DATA / "osm_cache"
ENDPOINTS = [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {"User-Agent": "TheWealltherMen/1.0 (hobby outdoor-conditions app)"}
# One nationwide request times out on the public servers, so the country goes in pieces.
REGIONS = {
    "west": "32,-125,49.5,-114", "mountain": "31,-114,49.5,-102", "plains": "25.5,-102,49.5,-90",
    "midwest": "36,-90,49.5,-80", "southeast": "24,-90,36,-75", "northeast": "36,-80,47.6,-66.5",
    "alaska": "51,-170,71.5,-129", "hawaii": "18.5,-161,22.5,-154.5",
}
SOUTHWEST = "31,-120,42.5,-102"  # slot canyon country: AZ, UT, NV, NM, and the edges of CA and CO
# Surfing was tried too: sport=surfing has under 40 usable US entries, mostly river
# waves and one town's breaks, so the surf list stays hand-entered.
FILTERS = {"dive": '["sport"="scuba_diving"]["name"]'}
QUERIES = {
    f"{kind}_{region}": f"[out:json][timeout:180];nwr{tags}({box});out center tags;"
    for kind, tags in FILTERS.items() for region, box in REGIONS.items()
}
QUERIES["slot"] = f'[out:json][timeout:180];nwr["name"~"slot canyon",i]({SOUTHWEST});out center tags;'
# tags that mark a business or building, not a place to surf or dive
NOT_A_SITE = ("shop", "club", "office", "amenity", "tourism", "building", "craft", "scuba_diving:education")
MAX_TRIES = 8


def fetch(key):
    cached = CACHE / f"extra_{key}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    for attempt in range(MAX_TRIES):
        endpoint = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            response = requests.post(endpoint, data={"data": QUERIES[key]}, headers=HEADERS, timeout=300)
            if response.ok and response.text.lstrip().startswith("{"):
                elements = response.json()["elements"]
                cached.write_text(json.dumps(elements), encoding="utf-8")
                return elements
            print(f"  {key}: HTTP {response.status_code} from {endpoint}", flush=True)
        except requests.RequestException as error:
            print(f"  {key}: {type(error).__name__} from {endpoint}", flush=True)
        time.sleep(20 + 10 * attempt)
    print(f"  {key}: gave up. Run again to retry.", flush=True)
    return []


def fetch_all(kind):
    """Every region's elements for one kind, without the repeats where regions touch."""
    seen = {}
    for key in QUERIES:
        if key.startswith(kind + "_"):
            for element in fetch(key):
                seen[(element["type"], element["id"])] = element
            time.sleep(3)
    return list(seen.values())


def places(elements, keep=lambda tags: True):
    out = []
    for element in elements:
        tags = element.get("tags", {})
        point = element if "lat" in element else element.get("center") or {}
        if "lat" not in point or not keep(tags):
            continue
        out.append({
            "name": tags["name"].strip(),
            "lat": round(point["lat"], 5),
            "lng": round(point["lon"], 5),
            "city": tags.get("addr:city", ""),
            "state": tags.get("addr:state", ""),
            "tags": {k: tags[k] for k in ("natural", "leisure", "historic", "depth", "website") if k in tags},
        })
    return out


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    is_site = lambda tags: not any(key in tags for key in NOT_A_SITE) and tags.get("leisure") != "sports_centre"
    outputs = {
        "dive_sites_us_osm.json": places(fetch_all("dive"), is_site),
        "slot_canyons_osm.json": places(fetch("slot"), lambda tags: "amenity" not in tags and "shop" not in tags),
    }
    for name, items in outputs.items():
        (DATA / name).write_text(json.dumps(items, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"{name}: {len(items)}", flush=True)


if __name__ == "__main__":
    main()
