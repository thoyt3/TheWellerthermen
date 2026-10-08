"""Collect dive sites tagged sport=scuba_diving in OpenStreetMap (ODbL).

Mostly St. Lawrence, Lake Ontario and Lake Champlain wrecks. Dive shops and
clubs are skipped. Writes data/dive_sites_osm.json. No API key needed.
"""
import json
import sys
from pathlib import Path

import requests

BBOX = "40.3,-80,47.5,-66.8"  # New York and New England, with the border waters
QUERY = f'[out:json][timeout:120];nwr["sport"="scuba_diving"]({BBOX});out center tags;'
ENDPOINTS = [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {"User-Agent": "TheWealltherMen/1.0 (hobby dive-conditions app)"}
OUT = Path(__file__).parent / "data" / "dive_sites_osm.json"
NOT_A_SITE = ("shop", "club", "office", "amenity", "scuba_diving:education")


def fetch():
    for endpoint in ENDPOINTS:
        try:
            response = requests.post(endpoint, data={"data": QUERY}, headers=HEADERS, timeout=150)
            if response.ok and response.text.lstrip().startswith("{"):
                return response.json()["elements"]
            print(f"{endpoint}: HTTP {response.status_code}")
        except requests.RequestException as error:
            print(f"{endpoint}: {error}")
    sys.exit("Overpass is busy. Try again in a few minutes.")


def to_sites(elements):
    sites = []
    for element in elements:
        tags = element.get("tags", {})
        name = tags.get("name")
        if not name or any(key in tags for key in NOT_A_SITE) or tags.get("leisure") == "sports_centre":
            continue
        point = element if "lat" in element else element.get("center", {})
        if "lat" not in point:
            continue
        wreck = tags.get("historic") == "wreck"
        depth = None
        try:
            depth = round(float(tags.get("depth", "").rstrip("m")) * 3.28084)
        except ValueError:
            pass
        sites.append({
            "name": name.replace("(Wrack)", "").replace("(Wreck)", "").replace("(Shipwreck)", "").strip(),
            "lat": round(point["lat"], 5),
            "lng": round(point["lon"], 5),
            "city": "",
            "state": "",
            "diveType": "boat" if wreck else "shore",
            "maxDepthFt": f"{depth} ft" if depth else None,
            "difficulty": "",
            "url": tags.get("website", "") if tags.get("website", "").startswith("https://") else "",
            "source": "osm",
        })
    return sites


def main():
    # pass a saved Overpass response as an argument to skip the network
    elements = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["elements"] if len(sys.argv) > 1 else fetch()
    sites = to_sites(elements)
    OUT.write_text(json.dumps(sites, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(sites)} sites to {OUT.name}")


if __name__ == "__main__":
    main()
