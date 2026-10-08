"""Turn the scraped location lists into one script per activity in public/data/.

The page loads an activity's script the first time it is picked, so it works when
index.html is opened straight from disk, with no server and no build step.

Sources, all under data/:
  clean_locations.json   the original New England scrape (golf, hiking, diving)
  golf_courses.json      nationwide golf courses (osm_places.py)
  trailheads.json        nationwide trailheads (osm_places.py)
  dive_sites_extra.json  nationwide dive sites (diving_zentacle.py)
  dive_sites_osm.json    Northeast dive sites (diving_osm.py)
  surf_spots.json        hand-entered surf breaks
  sea_bearings.json      which way each shore site faces (coast_bearings.py)
  dive_fixes.json        corrected positions for the original dive sites (fix_original_dives.py)
"""
import json
import math
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUT = ROOT / "public" / "data"
ACTIVITIES = ("golf", "hiking", "scuba_diving", "surfing")  # pickleball is parked for now
DUPLICATE_MILES = 0.3  # a new place this close to one we already have is the same place
SAME_NAME_MILES = 3  # sources pin the same named place in slightly different spots
STATE_NAMES = (
    "Alabama Alaska Arizona Arkansas California Colorado Connecticut Delaware Florida Georgia Hawaii "
    "Idaho Illinois Indiana Iowa Kansas Kentucky Louisiana Maine Maryland Massachusetts Michigan "
    "Minnesota Mississippi Missouri Montana Nebraska Nevada Ohio Oklahoma Oregon Pennsylvania "
    "Tennessee Texas Utah Vermont Virginia Washington Wisconsin Wyoming"
).split() + ["New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
             "Rhode Island", "South Carolina", "South Dakota", "West Virginia", "USA", "United States"]
NOT_A_NAME = {"trailhead", "parking", "trail", "trail head", "parking lot"}


def load(name):
    path = DATA / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def miles(a, b):
    lat1, lng1, lat2, lng2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def norm(name):
    return re.sub(r"[^a-z]", "", name.lower().replace("(boat dive)", ""))


class Places:
    """A list of places that refuses near-duplicates, using a coarse grid to stay fast.

    add() returns the place already there when it refuses one, or None when it adds.
    With add=False it only looks for the twin.
    """

    def __init__(self):
        self.items = []
        self.grid = defaultdict(list)

    def _cell(self, place):
        return (round(place["lat"] * 10), round(place["lng"] * 10))

    def add(self, place, check=True, add=True):
        cx, cy = self._cell(place)
        for dx in (-1, 0, 1) if check else ():
            for dy in (-1, 0, 1):
                for other in self.grid[(cx + dx, cy + dy)]:
                    limit = SAME_NAME_MILES if norm(place["name"]) == norm(other["name"]) else DUPLICATE_MILES
                    if miles(place, other) < limit:
                        return other
        if add:
            self.items.append(place)
            self.grid[(cx, cy)].append(place)
        return None


def original(activity, fixed=True):
    """Places from the original scrape, in the page's flat format.

    Dive sites get the corrections from fix_original_dives.py unless fixed=False.
    """
    fixes = load("dive_fixes.json") or {} if fixed and activity == "scuba_diving" else {}
    for loc in load("clean_locations.json"):
        if loc["activities"][0] != activity:
            continue
        geo = (loc.get("geometry") or {}).get("location") or {}
        lat, lng = loc.get("latitude", geo.get("lat")), loc.get("longitude", geo.get("lng"))
        if lat is None or lng is None:
            continue
        item = {
            # Golf names are full Nominatim display strings; keep the course name.
            "name": loc["name"].split(",")[0].strip() if activity == "golf" else loc["name"].strip(),
            "lat": round(lat, 5),
            "lng": round(lng, 5),
            "city": loc.get("city") or "",
            "state": loc.get("state") or "",
        }
        desc = (loc.get("description") or "").strip()
        if desc and desc != loc.get("features"):
            item["desc"] = desc
        if activity == "scuba_diving":
            item["diveType"] = loc.get("diveType") or "shore"
            fix = fixes.get(item["name"], {})
            for key in ("lat", "lng", "diveType", "approx"):
                if key in fix:
                    item[key] = fix[key]
        if activity == "hiking":
            item["difficulty"] = loc.get("difficulty") or ""
            item["features"] = loc.get("features") or ""
            try:
                item["miles"] = float(loc.get("distance_miles"))
            except (TypeError, ValueError):
                pass
        yield item


def plain(site):
    return {
        "name": site["name"],
        "lat": site["lat"],
        "lng": site["lng"],
        # sources often put a state or region ("California North") in the city field
        "city": "" if (site.get("city") or "").startswith(tuple(STATE_NAMES)) else site.get("city") or "",
        "state": site.get("state", ""),
    }


MUNICIPAL_WORDS = re.compile(
    r"\b(municipal|muni|city of|town of|village of|county|park district|parks (and|&) rec\w*|"
    r"state park|metropark|metropolitan park)\b", re.I)
RESORT_WORDS = re.compile(r"\b(resort|inn|lodge|spa|hotel|casino)\b", re.I)
PUBLIC_WORDS = re.compile(
    r"\b(public|golf course|golf links|links|golf cent(er|re)|golf park|par.?3|executive|family golf|pitch (and|&) putt)\b", re.I)
PRIVATE_WORDS = re.compile(r"\b(country club|private)\b", re.I)


def golf_access(course):
    """Public, private or municipal. OpenStreetMap tags when present, else a guess from the name."""
    owner = f"{course.get('ownership', '')} {course.get('operatorType', '')}".lower()
    access = course.get("access", "").lower()
    if "municipal" in owner or "government" in owner:
        return "Municipal"
    if access in ("private", "members", "no"):
        return "Private"
    if access in ("yes", "public", "permissive", "customers") or course.get("fee") == "yes" or "public" in owner:
        return "Public"
    text = f"{course['name']} {course.get('operator', '')}"
    host = course.get("website", "").split("/")[2] if course.get("website", "").count("/") >= 2 else ""
    # "Richmond County Country Club" is a country club, not a county course
    if PRIVATE_WORDS.search(text):
        return "Likely private"
    # a course on a government site is run by a city, county or state
    if MUNICIPAL_WORDS.search(text) or host.endswith((".gov", ".us")):
        return "Likely municipal"
    if RESORT_WORDS.search(course["name"]):
        return "Likely resort"
    # Most US courses take public tee times, and clubs that do not tend to say "club".
    if PUBLIC_WORDS.search(course["name"]):
        return "Likely public"
    return ""


GOLF_FILLER = re.compile(
    r"\b(the|golf|course|courses|club|country|cc|gc|links|resort|and|at|of|inc|llc)\b|[^a-z0-9 ]")
STATE_CODES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY",
}


def golf_key(name):
    """A course name boiled down to its distinctive words, for matching across sources."""
    return " ".join(GOLF_FILLER.sub(" ", name.lower().replace("&", " and ")).split())


def directory_types():
    """Course types from golf_types.py, as {state: {name key: [(city, type), ...]}}."""
    path = DATA / "golf_types.json"
    if not path.exists():
        return {}
    table = defaultdict(lambda: defaultdict(list))
    for course in json.loads(path.read_text(encoding="utf-8"))["courses"].values():
        key = golf_key(course["name"])
        if key:
            table[course["state"]][key].append((course["citySlug"].replace("-", " "), course["type"]))
    return table


def close_names(key, other):
    """True when every word of the shorter name has a near-twin in the longer one.

    Catches "Higlands" for "Hudson Highlands" and "Storm King" for "Storm King Mountain".
    """
    short, long = sorted((key.split(), other.split()), key=len)
    if sum(map(len, short)) < 5 or not {w[:2] for w in short} <= {w[:2] for w in long}:
        return False
    return all(any(SequenceMatcher(None, w, v).ratio() >= 0.88 for v in long) for w in short)


def directory_type(item, table):
    """The directory's type for this course, or "" when there is no confident match."""
    state = table.get(STATE_CODES.get(item.get("state", ""), item.get("state", "")), {})
    key = golf_key(item["name"])
    matches = state.get(key, [])
    if not matches and key:
        # no exact name: accept a near match only if it is the single one in the state
        near = [other for other in state if close_names(key, other)]
        if len(near) == 1:
            matches = state[near[0]]
    if len({kind for _, kind in matches}) == 1:
        return matches[0][1]
    # same name twice in a state with different types: only the city can settle it
    city = (item.get("city") or "").lower()
    in_city = {kind for where, kind in matches if where == city}
    return in_city.pop() if len(in_city) == 1 else ""


def build_golf():
    # The nationwide OpenStreetMap list is the record. The original New England scrape
    # only fills in what it lacks: a city for a course it also has, and whole courses
    # for states the new scrape has not reached yet. An original course missing from a
    # state that has been scraped is gone or was never real, so it is dropped.
    places = Places()
    courses = load("golf_courses.json")
    scraped = {course["state"] for course in courses}
    for course in courses:
        item = plain(course)
        for key in ("website", "phone"):
            if course.get(key):
                item[key] = course[key]
        item["access"] = golf_access(course)
        places.add(item)
    for item in original("golf"):
        state = STATE_CODES.get(item["state"], item["state"])
        if state not in STATE_CODES.values():
            continue  # the old scrape picked up a few courses outside the US
        if state in scraped:
            twin = places.add(item, add=False)
            if twin and not twin.get("city"):
                twin["city"] = item["city"]
        else:
            places.add(item)
    # the directory's answer beats OpenStreetMap tags and name guesses
    table = directory_types()
    for item in places.items:
        listed = directory_type(item, table)
        guess = item.get("access") or golf_access(item)
        if listed == "Public":
            # The directory only says public or private. Semi-private means a private
            # club that sells tee times to non-members with no member present: the
            # directory lists it as open to the public, yet it is a country club or is
            # tagged members-only. A public course run by a city or county is municipal,
            # and one at a hotel is a resort.
            if "municipal" in guess.lower():
                item["access"] = "Municipal"
            elif "private" in guess.lower():
                item["access"] = "Semi-private"
            elif "resort" in guess.lower():
                item["access"] = "Resort"
            else:
                item["access"] = "Public"
        elif listed:
            item["access"] = listed
        else:
            item["access"] = guess
    return places.items


def build_hiking():
    places = Places()
    # several of the original hikes share a trailhead, so keep them all
    for item in original("hiking"):
        places.add(item, check=False)
    for trailhead in load("trailheads.json"):
        if norm(trailhead["name"]) and trailhead["name"].lower() not in NOT_A_NAME:
            places.add(plain(trailhead))
    return places.items


def build_diving(bearings):
    places = Places()
    for item in original("scuba_diving"):
        places.add(item, check=False)
    for site in load("dive_sites_extra.json") + load("dive_sites_osm.json"):
        water = (bearings.get(f"{site['lat']},{site['lng']}") or {}).get("water", 0)
        item = plain(site)
        # no access listed: a point surrounded by water is a boat dive
        item["diveType"] = site["diveType"] or ("boat" if water > 0.85 else "shore")
        if site.get("maxDepthFt"):
            item["maxDepth"] = site["maxDepthFt"]
        if site.get("url"):
            item["url"] = site["url"]
        places.add(item)
    return places.items


def main():
    bearings = load("sea_bearings.json") or {}
    built = {
        "golf": build_golf(),
        "hiking": build_hiking(),
        "scuba_diving": build_diving(bearings),
        "surfing": [dict(spot) for spot in load("surf_spots.json")],
    }

    # which way the water lies, for the onshore-wind rule (see coast_bearings.py)
    # boat dives are offshore, and many are only located to the nearest harbor
    for item in built["scuba_diving"] + built["surfing"]:
        bearing = (bearings.get(f"{item['lat']},{item['lng']}") or {}).get("seaBearing")
        if bearing is not None and item.get("diveType") != "boat":
            item["seaBearing"] = bearing

    OUT.mkdir(parents=True, exist_ok=True)
    for activity in ACTIVITIES:
        items = [{k: v for k, v in item.items() if v != ""} for item in built[activity]]
        path = OUT / f"{activity}.js"
        path.write_text(
            "window.WM_DATA = window.WM_DATA || {};\n"
            f"window.WM_DATA[{json.dumps(activity)}] = "
            + json.dumps(items, ensure_ascii=False, separators=(",", ":")) + ";\n",
            encoding="utf-8",
        )
        print(f"{activity}: {len(items)} places, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
