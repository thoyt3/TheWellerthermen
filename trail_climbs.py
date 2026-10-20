"""Work out how much climbing each matched day-hike trail involves.

For every trailhead with a trail named like it (the ones the app gives a length,
see build_site_data.py), this fetches that trail's shape from the USGS National
Digital Trails layer, samples elevation every 60 m from the AWS Terrain Tiles,
and adds up the climbing. Small wiggles under 5 m are ignored, since the terrain
data is only good to a few metres.

The number is the climbing for the trail walked out and back: every rise on the
way out plus every drop, which becomes a rise on the way back.

Writes data/trail_climbs.json, keyed by "lat,lng", and resumes where it stopped.
No API key needed.
"""
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

import build_site_data as build
import coast_bearings

DATA = Path(__file__).parent / "data"
OUT = DATA / "trail_climbs.json"
LAYER = "https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37/query"
HEADERS = {"User-Agent": "TheWealltherMen/1.0 (hobby outdoor-conditions app)"}
TRAIL_BOX_DEGREES = 0.3  # same reach as trail_lengths.py
STEP_METERS = 60
IGNORE_METERS = 5
WORKERS = 3
FEET = 3.28084

coast_bearings.TILE_CACHE_MAX = 1500
tile_lock = threading.Lock()


def elevation(lat, lng):
    with tile_lock:  # the tile cache is shared between threads
        return coast_bearings.elevation(lat, lng)


def meters(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * 111320 * math.cos(lat), (b[1] - a[1]) * 110540)


def profile(path):
    """Elevations every STEP_METERS along a path of [lng, lat] points."""
    out = [elevation(path[0][1], path[0][0])]
    carried = 0.0
    for a, b in zip(path, path[1:]):
        length = meters(a, b)
        position = STEP_METERS - carried
        while position <= length:
            t = position / length
            out.append(elevation(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t))
            position += STEP_METERS
        carried = (carried + length) % STEP_METERS
    out.append(elevation(path[-1][1], path[-1][0]))
    return out


def climbing(heights):
    """Rises and drops bigger than IGNORE_METERS, in metres."""
    total, reference = 0.0, heights[0]
    for h in heights[1:]:
        if abs(h - reference) >= IGNORE_METERS:
            total += abs(h - reference)
            reference = h
    return total


def trail_paths(name, lat, lng):
    box = TRAIL_BOX_DEGREES
    for attempt in range(4):
        try:
            data = requests.get(LAYER, headers=HEADERS, timeout=90, params={
                "geometry": f"{lng - box},{lat - box},{lng + box},{lat + box}",
                "geometryType": "esriGeometryEnvelope", "inSR": 4326, "outSR": 4326,
                "spatialRel": "esriSpatialRelIntersects", "where": "name = '" + name.replace("'", "''") + "'",
                "outFields": "name", "returnGeometry": "true", "geometryPrecision": 5, "f": "json",
            }).json()
            if "error" not in data:
                return [path for f in data.get("features", []) for path in f.get("geometry", {}).get("paths", [])]
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 + 3 * attempt)
    return None


def matched_trails():
    """Trailheads the build gives a length to, with the USGS name of that trail."""
    lengths = json.loads((DATA / "trail_lengths.json").read_text(encoding="utf-8"))
    for key, trails in lengths.items():
        if trails and trails[0]["match"] >= build.NAME_MATCH and trails[0]["miles"] <= build.DAY_HIKE_MILES:
            lat, lng = map(float, key.split(","))
            yield key, trails[0]["name"], lat, lng


def main():
    done = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = [t for t in matched_trails() if t[0] not in done]
    print(f"{len(todo)} trails to measure, {len(done)} done", flush=True)
    lock = threading.Lock()
    count = 0

    def work(item):
        nonlocal count
        key, name, lat, lng = item
        # trail_lengths.py title-cased the name; the layer stores it as given, so try both
        paths = trail_paths(name, lat, lng) or trail_paths(name.upper(), lat, lng)
        result = None
        if paths:
            try:
                result = round(sum(climbing(profile(p)) for p in paths if len(p) > 1) * FEET)
            except (requests.RequestException, OSError):
                result = None
        with lock:
            if result is not None:
                done[key] = {"climbFt": result}
            count += 1
            if count % 100 == 0:
                OUT.write_text(json.dumps(done), encoding="utf-8")
                print(f"  {count} measured", flush=True)

    with ThreadPoolExecutor(WORKERS) as pool:
        list(pool.map(work, todo))
    OUT.write_text(json.dumps(done), encoding="utf-8")
    print(f"wrote {len(done)} trail climbs")


if __name__ == "__main__":
    main()
