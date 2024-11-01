# TheWealltherMen

to pull golf courses, use 
python scrape_golf_courses_overpass.py
this will write them to locations.json
to pull dive sites, use
python collect_locations.py
this will also write them to locations.json
then, run
python clean_locations.py
this will clean them up, but it takes a while (about 15 minutes)
then run
node server.js