"""Collect named golf courses and trailheads for every US state from OpenStreetMap (ODbL).

One Overpass query per state, cached in data/osm_cache/ so a rerun only fetches
what is missing. Writes data/golf_courses.json and data/trailheads.json.
Pass --cached to rebuild those files from the cache without fetching anything.
No API key needed.
"""
import json
import sys
import time
from pathlib import Path

import requests

DATA = Path(__file__).parent / "data"
CACHE = DATA / "osm_cache"
STATES = (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ "
    "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC"
).split()
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {"User-Agent": "TheWealltherMen/1.0 (hobby outdoor-conditions app)"}
QUERY = """[out:json][timeout:180];
area["ISO3166-2"="US-{state}"]->.a;
(
  nwr["leisure"="golf_course"]["name"](area.a);
  nwr["highway"="trailhead"]["name"](area.a);
);
out center tags;"""
MAX_TRIES = 8


def fetch_state(state):
    cached = CACHE / f"{state}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    if "--cached" in sys.argv:
        return None
    for attempt in range(MAX_TRIES):
        endpoint = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            response = requests.post(endpoint, data={"data": QUERY.format(state=state)}, headers=HEADERS, timeout=240)
            if response.ok and response.text.lstrip().startswith("{"):
                elements = response.json()["elements"]
                cached.write_text(json.dumps(elements), encoding="utf-8")
                time.sleep(3)  # be polite
                return elements
            print(f"  {state}: HTTP {response.status_code} from {endpoint}", flush=True)
        except requests.RequestException as error:
            print(f"  {state}: {type(error).__name__} from {endpoint}", flush=True)
        time.sleep(20 + 10 * attempt)  # the public servers are often busy
    return None


def to_place(element, state):
    tags = element["tags"]
    point = element if "lat" in element else element.get("center") or {}
    if "lat" not in point:
        return None
    place = {
        "name": tags["name"].strip(),
        "lat": round(point["lat"], 5),
        "lng": round(point["lon"], 5),
        "city": tags.get("addr:city", ""),
        "state": state,
    }
    if tags.get("leisure") == "golf_course":
        # raw material for the public / private / municipal label and the booking link
        website = tags.get("website") or tags.get("contact:website") or tags.get("url") or ""
        if website.startswith("http"):
            place["website"] = website
        for key, tag in (("phone", "phone"), ("access", "access"), ("ownership", "ownership"),
                         ("operatorType", "operator:type"), ("operator", "operator"), ("fee", "fee")):
            if tags.get(tag):
                place[key] = tags[tag]
    return place


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    golf, trailheads, missed = [], [], []
    for state in STATES:
        elements = fetch_state(state)
        if elements is None:
            missed.append(state)
            continue
        counts = [0, 0]
        for element in elements:
            place = to_place(element, state)
            if not place:
                continue
            is_golf = element["tags"].get("leisure") == "golf_course"
            (golf if is_golf else trailheads).append(place)
            counts[0 if is_golf else 1] += 1
        print(f"{state}: {counts[0]} golf courses, {counts[1]} trailheads", flush=True)

    (DATA / "golf_courses.json").write_text(json.dumps(golf, ensure_ascii=False), encoding="utf-8")
    (DATA / "trailheads.json").write_text(json.dumps(trailheads, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(golf)} golf courses and {len(trailheads)} trailheads")
    if missed:
        print(f"no answer for: {' '.join(missed)}. Run again to retry just those.")


if __name__ == "__main__":
    main()
