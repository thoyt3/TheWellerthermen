"""Work out which way the water lies from each shore dive site and surf break.

Shallow shore dives silt up when the wind blows onshore, so the app needs the
seaward bearing of each site. We sample elevation on two rings around the site
and average the bearings that come back as water. Sites that are nearly all
water (offshore) or nearly all land get no bearing.

Elevation comes from the public Terrain Tiles dataset on AWS (Mapzen terrarium
tiles): no key and no rate limit, so this scales to thousands of sites.

Results are cached in data/sea_bearings.json, keyed by "lat,lng".
"""
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
import requests
from PIL import Image

DATA = Path(__file__).parent / "data"
CACHE = DATA / "sea_bearings.json"
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 12  # about 30 m per pixel at these latitudes
RINGS_KM = (0.4, 1.2)
BEARINGS = 16
SEA_LEVEL_M = 0.5
LAKE_BAND_M = 0.3  # a lake surface is flat: points this close to the lowest sample
LAKE_MIN_SHARE = 0.2  # ...and there must be this many of them to call it a lake

session = requests.Session()
tiles = {}


def tile(x, y):
    if (x, y) not in tiles:
        if len(tiles) > 200:
            tiles.clear()
        response = session.get(TILE_URL.format(z=ZOOM, x=x, y=y), timeout=60)
        response.raise_for_status()
        rgb = np.asarray(Image.open(io.BytesIO(response.content)).convert("RGB"), dtype=np.float64)
        tiles[(x, y)] = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
    return tiles[(x, y)]


def elevation(lat, lng):
    n = 2 ** ZOOM
    x = (lng + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    grid = tile(int(x), int(y))
    return float(grid[min(255, int((y % 1) * 256)), min(255, int((x % 1) * 256))])


def ring(lat, lng):
    for km in RINGS_KM:
        for k in range(BEARINGS):
            bearing = math.radians(k * 360 / BEARINGS)
            yield (
                lat + km / 111.32 * math.cos(bearing),
                lng + km / (111.32 * math.cos(math.radians(lat))) * math.sin(bearing),
            )


def summarize(elevations):
    """Return (seaward bearing or None, fraction of sampled points that are water)."""
    low = min(elevations)
    if low <= SEA_LEVEL_M:
        wet = [e <= SEA_LEVEL_M for e in elevations]
    else:
        # above sea level: treat a big flat patch at the lowest elevation as a lake
        wet = [e - low <= LAKE_BAND_M for e in elevations]
        if sum(wet) < LAKE_MIN_SHARE * len(elevations):
            return None, 0.0
    x = y = 0
    for i, is_wet in enumerate(wet):
        if is_wet:
            bearing = math.radians((i % BEARINGS) * 360 / BEARINGS)
            x += math.sin(bearing)
            y += math.cos(bearing)
    water = sum(wet)
    fraction = round(float(water) / len(elevations), 2)
    if not 0.1 <= fraction <= 0.85 or math.hypot(x, y) / water < 0.3:
        return None, fraction
    return round(math.degrees(math.atan2(x, y)) % 360), fraction


def site_points():
    points = set()
    for loc in json.loads((DATA / "clean_locations.json").read_text(encoding="utf-8")):
        if "scuba_diving" in loc["activities"]:
            geo = loc["geometry"]["location"]
            points.add((round(geo["lat"], 5), round(geo["lng"], 5)))
    for name in ("dive_sites_extra.json", "dive_sites_osm.json", "surf_spots.json"):
        path = DATA / name
        if path.exists():
            points.update((s["lat"], s["lng"]) for s in json.loads(path.read_text(encoding="utf-8")))
    return sorted(points)


def main():
    fresh = "--fresh" in sys.argv
    cache = {} if fresh or not CACHE.exists() else json.loads(CACHE.read_text(encoding="utf-8"))
    todo = [p for p in site_points() if f"{p[0]},{p[1]}" not in cache]
    print(f"{len(todo)} sites to look up, {len(cache)} cached", flush=True)
    for n, site in enumerate(todo, 1):
        try:
            bearing, fraction = summarize([elevation(lat, lng) for lat, lng in ring(*site)])
        except (requests.RequestException, OSError) as error:
            print(f"  {site}: skipped ({error})", flush=True)
            continue
        cache[f"{site[0]},{site[1]}"] = {"seaBearing": bearing, "water": fraction}
        if n % 100 == 0:
            print(f"  {n} done", flush=True)
            CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    print(f"wrote {len(cache)} entries to {CACHE.name}")


if __name__ == "__main__":
    main()
