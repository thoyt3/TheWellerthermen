"""Download NOAA's list of tide prediction stations.

The app looks up high and low tides for each salt-water dive site and surf break
from its nearest station (NOAA CO-OPS, public domain, no key). This saves the
station list the build uses to pick that station: data/noaa_tide_stations.json.
"""
import json
from pathlib import Path

import requests

URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions"
OUT = Path(__file__).parent / "data" / "noaa_tide_stations.json"


def main():
    stations = requests.get(URL, timeout=120).json()["stations"]
    slim = [
        {"id": s["id"], "name": s["name"], "state": s.get("state") or "", "lat": round(s["lat"], 4), "lng": round(s["lng"], 4)}
        for s in stations
        if s.get("lat") is not None and s.get("lng") is not None
    ]
    OUT.write_text(json.dumps(slim, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(slim)} stations to {OUT.name}")


if __name__ == "__main__":
    main()
