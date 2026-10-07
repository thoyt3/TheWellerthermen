"""Look up whether each US golf course is public, private or municipal.

OpenStreetMap rarely says, so this reads GolfLink's public course directory
(allowed by its robots.txt). Each city page lists every course within 20 miles
with its type, so a city is skipped once a nearby page has already covered it.

Writes data/golf_types.json and can be stopped and rerun: it picks up where it
left off. No API key needed.
"""
import json
import re
import time
from pathlib import Path

import requests

BASE = "https://www.golflink.com"
SITEMAP = BASE + "/sitemap/golfcourses-states-cities001.xml"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; TheWealltherMen/1.0; hobby outdoor-conditions app)"}
OUT = Path(__file__).parent / "data" / "golf_types.json"
STATES = set(
    "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj "
    "nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split()
)
COVERED_WITHIN_MILES = 12  # a city this close to a fetched page has all its courses on that page
CARD = re.compile(
    r'<div class="course-card">.*?<h3><a[^>]*href="(/golf-courses/([a-z]{2})/([^/"]+)/[^"]+)">([^<]+)</a></h3>'
    r'\s*<span class="\w+">([^<]+)</span>.*?<div class="text">\s*<span>([^<]*)</span>.*?<i>([\d.]+) miles? from',
    re.S,
)


def unescape(text):
    return text.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"').strip()


def main():
    saved = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"courses": {}, "done": []}
    courses, done = saved["courses"], set(saved["done"])

    sitemap = requests.get(SITEMAP, headers=HEADERS, timeout=60).text
    cities = [m for m in re.findall(r"<loc>https://www\.golflink\.com/golf-courses/([a-z]{2})/([^/<]+)</loc>", sitemap)
              if m[0] in STATES]
    covered = {tuple(key.split("/")) for key in done}
    for course in courses.values():
        if course["milesFromPage"] <= COVERED_WITHIN_MILES:
            covered.add((course["state"].lower(), course["citySlug"]))
    print(f"{len(cities)} city pages, {len(courses)} courses known, {len(done)} pages already read", flush=True)

    fetched = 0
    for state, city in cities:
        if (state, city) in covered:
            continue
        try:
            response = requests.get(f"{BASE}/golf-courses/{state}/{city}", headers=HEADERS, timeout=60)
            response.raise_for_status()
        except requests.RequestException as error:
            print(f"  {state}/{city}: skipped ({error})", flush=True)
            time.sleep(5)
            continue
        for href, st, city_slug, name, kind, address, distance in CARD.findall(response.text):
            miles = float(distance)
            known = courses.get(href)
            if not known or miles < known["milesFromPage"]:
                courses[href] = {
                    # "West Point Golf Course, West Point Course": keep the facility name
                    "name": unescape(name).split(",")[0].strip(),
                    "type": unescape(kind),
                    "state": st.upper(),
                    "citySlug": city_slug,
                    "address": unescape(address),
                    "milesFromPage": miles,
                }
            if miles <= COVERED_WITHIN_MILES:
                covered.add((st, city_slug))
        covered.add((state, city))
        done.add(f"{state}/{city}")
        fetched += 1
        if fetched % 25 == 0:
            OUT.write_text(json.dumps({"courses": courses, "done": sorted(done)}), encoding="utf-8")
            print(f"  {fetched} pages read, {len(courses)} courses, now in {state.upper()}", flush=True)
        time.sleep(1)  # be polite

    OUT.write_text(json.dumps({"courses": courses, "done": sorted(done)}), encoding="utf-8")
    print(f"read {fetched} pages this run, {len(courses)} courses in {OUT.name}")


if __name__ == "__main__":
    main()
