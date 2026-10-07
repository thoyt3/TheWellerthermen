"""Collect dive sites for every US state from Zentacle.

Zentacle took over shorediving.com's directory. Its robots.txt allows the public
location pages (only /api is disallowed), and each page embeds its spots as JSON.
We keep the facts (name, coordinates, access, depth) and link back to the site's
own page for the write-up instead of copying user-written descriptions.

Writes data/dive_sites_extra.json. No API key needed.
"""
import json
import re
import time
from pathlib import Path

import requests

BASE = "https://www.zentacle.com"
STATES = {code.lower(): code for code in (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ "
    "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
).split()}
HEADERS = {"User-Agent": "TheWealltherMen/1.0 (hobby dive-conditions app)"}
OUT = Path(__file__).parent / "data" / "dive_sites_extra.json"
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def page_props(path):
    response = requests.get(BASE + path, headers=HEADERS, timeout=60)
    response.raise_for_status()
    time.sleep(1)  # be polite
    match = NEXT_DATA.search(response.text)
    return json.loads(match.group(1))["props"]["pageProps"] if match else {}


def main():
    sites = {}
    for short, state in STATES.items():
        try:
            props = page_props(f"/loc/us/{short}")
        except requests.RequestException as error:
            print(f"{state}: skipped ({error})")
            continue
        spots = list(props.get("default") or [])
        # county pages list spots the state page leaves out
        for area in props.get("areas") or []:
            if not area.get("url") or not area.get("num_spots"):
                continue
            try:
                spots += page_props(area["url"]).get("default") or []
            except requests.RequestException as error:
                print(f"  {area['url']}: skipped ({error})")

        kept = 0
        for spot in spots:
            if spot.get("is_deleted") or spot.get("latitude") is None or spot.get("longitude") is None:
                continue
            access = {a.get("short_name") for a in spot.get("access") or []}
            sites[spot["id"]] = {
                "name": spot["name"].strip(),
                "lat": round(float(spot["latitude"]), 5),
                "lng": round(float(spot["longitude"]), 5),
                "city": (spot.get("location_city") or "").split(",")[0].strip(),
                "state": state,
                "diveType": "boat" if access == {"boat"} else "shore" if "shore" in access else "",
                "maxDepthFt": spot.get("max_depth"),
                "difficulty": spot.get("difficulty") or "",
                "url": BASE + spot["url"] if spot.get("url") else "",
                "source": "zentacle",
            }
            kept += 1
        print(f"{state}: {kept} spots", flush=True)

    OUT.write_text(json.dumps(list(sites.values()), indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(sites)} sites to {OUT.name}")


if __name__ == "__main__":
    main()
