# The Wellerthermen

[Watch the original presentation video here](https://youtu.be/P6FjIJv17YA)

Pick an activity, a place and a day. The app scores every hour of the forecast at the
nearest golf courses, trailheads, dive sites or surf breaks, then tells you where to go
and when.

## No keys, no server

The app is a static site in `public/`. It needs no API keys, no account and no install.

| Need | Source | Replaces |
| --- | --- | --- |
| Hourly weather, sunrise and sunset | [Open-Meteo forecast API](https://open-meteo.com/) | OpenWeatherMap One Call 3.0 (paid key) |
| Waves, swell, water temperature, tides | [Open-Meteo marine API](https://open-meteo.com/en/docs/marine-weather-api) | StormGlass (paid key) |
| The written recommendation | Scoring rules in `public/app.js` | OpenAI (paid key) |
| Place lookup | OpenStreetMap Nominatim, with Open-Meteo geocoding as a fallback | unchanged |
| Locations | OpenStreetMap, Zentacle and GolfLink public pages | New England only |
| Moon phase | Computed in the browser | OpenWeatherMap |

Open-Meteo is free for non-commercial use. Responses are cached in memory for the
session, and place lookups are cached in the browser.

## Run it

Open `public/index.html` in a browser. "Locate me" needs the page to be served
rather than opened from disk, so for that run

```bash
python -m http.server 8000 --directory public
```

and visit http://localhost:8000.

The site is also published with GitHub Pages at https://thoyt3.github.io/TheWellerthermen/.
A workflow in `.github/workflows/pages.yml` republishes `public/` on every push to `main`.

## How the scoring works

Each hour gets a score from 0 to 100, and each place is ranked by its best stretch of
daylight hours (4 hours for golf, 2 for pickleball, diving and surfing, and a length
based on trail mileage for hiking). Give a start time and that window is scored instead.
Nearer places win ties.

- Golf and hiking: rain chance, feels-like temperature and wind.
- Hiking near slot canyons: any trailhead within 10 miles of a known slot canyon, or
  named for one, carries a flash flood warning. It cannot score above Poor unless the
  forecast shows 24 dry hours leading up to the hike.
- Hike length: where a trail named like the trailhead is on file, the outing is that
  trail out and back at 2 mph. Otherwise the app looks for the best three hours and
  says no length is on file.
- Golf courses are labelled Public, Private, Semi-private, Municipal or Resort, and
  the recommendations always include at least three you can book without a membership,
  reaching past the distance limit if they have to. Semi-private means a private club
  that sells tee times to non-members with no member present. A "Likely" label is a
  guess from the course name.
- Scuba diving: wave height and wind, weighted harder for boat dives. Anything over
  5 ft of waves scores zero. Water temperature sets the minimum exposure suit.
- Shore dives also lose points for onshore wind, because shallow sites silt up when
  the wind blows straight onto the coast. The app knows which way each shore site
  faces and takes the onshore part of the wind over the previous six hours. About
  12 mph straight onshore drops a site to Fair, and 15 mph or more makes it Poor.
- Diving results are shore-first: three to five shore dives, then one or two boat dives.
- Surfing: swell height and period, then wind.
- Thunderstorms score zero for everything.

The thresholds are rules of thumb. Check conditions yourself before you go.

## Known limits

- Tide times are read off the marine model's hourly sea level, so treat them as
  approximate and use a tide table for anything that matters.
- Forecasts run about two weeks out for weather and about a week for waves.
- Golf courses and trailheads cover all 50 states and DC. Dive sites cover every
  state, though Ohio and Virginia are thin: a few quarries entered by hand plus wrecks
  from OpenStreetMap, because the main source has no pages for them.
- Trail lengths come from the USGS National Digital Trails layer, which has a trail
  at about 60% of trailheads and a clearly matching one at about a third. Lengths are
  one way and take no account of climbing. The original New England hikes keep their
  own mileage and difficulty.
- The slot canyon list is OpenStreetMap features named "slot canyon" plus about 30
  well-known canyons entered by hand. It will miss obscure ones, and the forecast is
  for the trailhead, not for the drainage upstream.
- Surf breaks are still the 14 hand-entered New England spots. OpenStreetMap has too
  few US surf spots to use, and the good national lists are proprietary.
- Course types come from a directory that only says public or private. Semi-private,
  municipal and resort are worked out from the name and OpenStreetMap tags.
- The shore-facing direction is estimated from elevation data on a ring around each
  site. It is missing for quarries, most lakes and sites the data sees as enclosed
  water, and it can be off on a jagged coast. Those sites get an asterisk and fall
  back to plain wind speed.
- Boat dives from the original scrape are located only to the nearest harbor.
- Surf break coordinates in `data/surf_spots.json` are approximate.
- Pickleball is parked. Its scraper and data are still in the repository.
- If a forecast lookup fails, the nearest places are still listed with an asterisk
  in place of a score.

## Refreshing the location data

None of the scrapers need a key. The ones that matter now are

```bash
python osm_places.py
python golf_types.py
python trail_lengths.py
python diving_zentacle.py
python diving_osm.py
python osm_extras.py
python fix_original_dives.py
python coast_bearings.py
python build_site_data.py
```

- `osm_places.py` fetches named golf courses and trailheads for every state from
  OpenStreetMap. The public servers are often busy, so it retries, caches each state
  in `data/osm_cache/` and reports any it could not get. Run it again for the gaps.
- `golf_types.py` reads GolfLink's public course directory for whether each course is
  public or private. It saves as it goes and resumes where it stopped.
- `diving_zentacle.py` collects dive sites for every state from Zentacle's public
  location pages, and `diving_osm.py` adds sites tagged for diving in OpenStreetMap.
  Only names, coordinates, access and depth are kept, with a link back to the source.
- `trail_lengths.py` asks the USGS National Digital Trails layer which trails leave
  from each trailhead and how long they are.
- `osm_extras.py` collects dive sites tagged in OpenStreetMap nationwide and features
  named "slot canyon" in the Southwest.
- `fix_original_dives.py` re-checks where the original New England dive sites are.
  Positions looked up by hand go in `data/dive_fixes_manual.json`, extra dive sites in
  `data/dive_sites_manual.json` and extra slot canyons in
  `data/slot_canyons_manual.json`, each with its source.
- `coast_bearings.py` works out which way each dive site and surf break faces, from
  the free Terrain Tiles elevation data on AWS. Results are cached in
  `data/sea_bearings.json`.
- `build_site_data.py` merges everything into one script per activity in
  `public/data/`, which the page loads on demand.

The original New England scrapers (`golfing.py`, `diving.py`, `hiking.py`,
`pickleball.py`, then `clean_locations.py`) still produce `data/clean_locations.json`,
which the build also reads. They need `overpy`, `geopy` and `playwright`.
