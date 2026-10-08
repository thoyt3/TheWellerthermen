"""Find the trails that start at each trailhead, and how long they are.

OpenStreetMap trailheads carry no mileage, so this asks the USGS National
Digital Trails layer (public domain, no key) which hiking trails pass within
300 m of each trailhead, then adds up every segment of those trails nearby to
get each trail's full length.

Writes data/trail_lengths.json, keyed by "lat,lng". It saves as it goes and
resumes where it stopped. About 60% of trailheads have a trail in the layer.
"""
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

DATA = Path(__file__).parent / "data"
OUT = DATA / "trail_lengths.json"
LAYER = "https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37/query"
HEADERS = {"User-Agent": "TheWealltherMen/1.0 (hobby outdoor-conditions app)"}
NEAR_METERS = 300
TRAIL_BOX_DEGREES = 0.3  # how far a trail may run from its trailhead, about 20 miles
MAX_TRAILS = 4
WORKERS = 4
FILLER = re.compile(r"\b(trailhead|trail|th|trlhd|parking|lot|access|the|national|recreation)\b|[^a-z0-9 ]")

local = threading.local()


def get(params):
    if not hasattr(local, "session"):
        local.session = requests.Session()
        local.session.headers.update(HEADERS)
    for attempt in range(4):
        try:
            response = local.session.get(LAYER, params={**params, "f": "json"}, timeout=60)
            data = response.json()
            if "error" not in data:
                return data
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 + 3 * attempt)
    return None


def words(name):
    return set(FILLER.sub(" ", name.lower()).split())


def lookup(place):
    """Trails at this trailhead as [{name, miles, match}], best name match first. None on failure."""
    near = get({
        "geometry": f"{place['lng']},{place['lat']}", "geometryType": "esriGeometryPoint", "inSR": 4326,
        "distance": NEAR_METERS, "units": "esriSRUnit_Meter", "spatialRel": "esriSpatialRelIntersects",
        "where": "hikerpedestrian IS NULL OR hikerpedestrian <> 'N'", "outFields": "name", "returnGeometry": "false",
        "returnDistinctValues": "true",
    })
    if near is None:
        return None
    names = sorted({f["attributes"]["name"] for f in near.get("features", []) if f["attributes"].get("name")})
    if not names:
        return []
    quoted = ",".join("'" + name.replace("'", "''") + "'" for name in names[:12])
    box = TRAIL_BOX_DEGREES
    totals = get({
        "geometry": f"{place['lng'] - box},{place['lat'] - box},{place['lng'] + box},{place['lat'] + box}",
        "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
        "where": f"name IN ({quoted})", "groupByFieldsForStatistics": "name",
        "outStatistics": json.dumps([{"statisticType": "sum", "onStatisticField": "lengthmiles", "outStatisticFieldName": "miles"}]),
    })
    if totals is None:
        return None
    wanted = words(place["name"])
    trails = []
    for feature in totals.get("features", []):
        attributes = {k.lower(): v for k, v in feature["attributes"].items()}
        miles = round(attributes.get("miles") or 0, 1)
        if miles < 0.1:
            continue
        mine = words(attributes["name"])
        match = len(wanted & mine) / len(mine) if mine else 0
        trails.append({"name": attributes["name"].title(), "miles": miles, "match": round(match, 2)})
    trails.sort(key=lambda t: (-t["match"], -t["miles"]))
    return trails[:MAX_TRAILS]


def main():
    done = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = [p for p in json.loads((DATA / "trailheads.json").read_text(encoding="utf-8"))
            if f"{p['lat']},{p['lng']}" not in done]
    print(f"{len(todo)} trailheads to look up, {len(done)} done", flush=True)
    lock = threading.Lock()
    count = 0

    def work(place):
        nonlocal count
        trails = lookup(place)
        with lock:
            if trails is not None:
                done[f"{place['lat']},{place['lng']}"] = trails
            count += 1
            if count % 250 == 0:
                OUT.write_text(json.dumps(done), encoding="utf-8")
                print(f"  {count} looked up, {sum(1 for t in done.values() if t)} with trails", flush=True)

    with ThreadPoolExecutor(WORKERS) as pool:
        list(pool.map(work, todo))
    OUT.write_text(json.dumps(done), encoding="utf-8")
    print(f"wrote {len(done)} trailheads, {sum(1 for t in done.values() if t)} with trails")


if __name__ == "__main__":
    main()
