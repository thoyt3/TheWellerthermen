"""Re-check where the original New England dive sites are.

The first scrape geocoded each site from a street address, so boat dives ended
up on the nearest town green and a few shore dives landed inland. For every
original site that is not sitting on a shoreline, this looks for a better
position, in order:

  1. the same site in the newer dive list (data/dive_sites_extra.json)
  2. a named feature in OpenStreetMap (Nominatim) within 12 miles
  3. give up and mark the site as approximately located

Positions looked up by hand live in data/dive_fixes_manual.json, each with its
source, and win over anything found here.

Writes data/dive_fixes.json, keyed by site name, and prints what it changed.
Run coast_bearings.py afterwards so the moved sites get a shore direction.
"""
import json
import re
import time
from pathlib import Path

import requests

import build_site_data as build
import coast_bearings

OUT = build.DATA / "dive_fixes.json"
HEADERS = {"User-Agent": "TheWealltherMen/1.0 (hobby dive-conditions app)"}
SAME_SITE_MILES = 15
SEARCH_MILES = 12
PARK_SEARCH_MILES = 60  # a state park's name is unique enough to trust from farther away
FRESHWATER = re.compile(r"\b(pond|quarry)\b", re.I)
# kinds of OpenStreetMap feature a dive site is named after
PLACE_CLASSES = {"natural", "place", "man_made", "leisure", "tourism", "historic", "waterway", "boundary"}


def water_share(lat, lng):
    return coast_bearings.summarize([coast_bearings.elevation(a, b) for a, b in coast_bearings.ring(lat, lng)])[1]


def on_a_lake(lat, lng):
    """True when the point sits on a flat surface above sea level that is the lowest ground around."""
    lowest = min(coast_bearings.elevation(a, b) for a, b in coast_bearings.ring(lat, lng))
    return lowest > coast_bearings.SEA_LEVEL_M and coast_bearings.elevation(lat, lng) - lowest <= coast_bearings.LAKE_BAND_M


def suspicious(site, water):
    if FRESHWATER.search(site["name"]):
        return False
    if site["diveType"] == "boat":
        if on_a_lake(site["lat"], site["lng"]):
            return False  # a lake wreck
        return water < 0.85  # a boat dive should be out on the water
    return water < 0.1  # a shore dive should touch it


def search_name(site):
    name = re.sub(r"\(.*?\)|wreck", "", site["name"], flags=re.I)
    return re.split(r"[-/]", name)[0].strip()


def nominatim(site):
    response = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": f"{search_name(site)}, {site['state']}", "format": "json", "limit": 5},
        headers=HEADERS,
        timeout=30,
    )
    time.sleep(1.1)  # Nominatim allows one request a second
    response.raise_for_status()
    reach = PARK_SEARCH_MILES if "state park" in site["name"].lower() else SEARCH_MILES
    for hit in response.json():
        spot = {"lat": round(float(hit["lat"]), 5), "lng": round(float(hit["lon"]), 5)}
        if hit.get("class") in PLACE_CLASSES and build.miles(site, spot) <= reach:
            return spot
    return None


def main():
    newer = {}
    for site in build.load("dive_sites_extra.json"):
        newer.setdefault(build.norm(site["name"]), []).append(site)

    by_hand = build.load("dive_fixes_manual.json") or {}
    fixes = {}
    for site in build.original("scuba_diving", fixed=False):
        if site["name"] in by_hand:
            fixes[site["name"]] = dict(by_hand[site["name"]], movedMiles=round(build.miles(site, by_hand[site["name"]]), 1))
            print(f"{site['name'][:40]:40} by hand, moved {fixes[site['name']]['movedMiles']} mi", flush=True)
            continue
        water = water_share(site["lat"], site["lng"])
        twins = [s for s in newer.get(build.norm(site["name"]), []) if build.miles(site, s) <= SAME_SITE_MILES]
        fix = None
        if twins:
            twin = min(twins, key=lambda s: build.miles(site, s))
            if build.miles(site, twin) > build.DUPLICATE_MILES or (twin["diveType"] and twin["diveType"] != site["diveType"]):
                fix = {"lat": twin["lat"], "lng": twin["lng"], "how": "newer dive list"}
                if twin["diveType"]:
                    fix["diveType"] = twin["diveType"]
        elif suspicious(site, water):
            spot = nominatim(site)
            fix = {**spot, "how": "OpenStreetMap name search"} if spot else {"approx": True, "how": "not found"}
        if not fix and site["diveType"] == "shore" and water > 0.85:
            # surrounded by water: an offshore ledge or island, reached by boat
            fix = {"diveType": "boat", "how": "surrounded by water"}
        if fix and "lat" in fix:
            fix["movedMiles"] = round(build.miles(site, fix), 1)
            if fix["movedMiles"] < 0.1 and fix.get("diveType", site["diveType"]) == site["diveType"]:
                fix = None  # the search found the spot we already had
        if fix:
            fixes[site["name"]] = fix
            print(f"{site['name'][:40]:40} {fix}", flush=True)

    OUT.write_text(json.dumps(fixes, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(fixes)} fixes to {OUT.name}")


if __name__ == "__main__":
    main()
