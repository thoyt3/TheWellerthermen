# TheWealltherMen

to pull golf courses, use 
python golfing.py (was python scrape_golf_courses_overpass.py)
this will write them to locations.json
to pull dive sites, use
python diving.py (was python collect_locations.p)
this will also write them to locations.json
to pull hiking locations, use
python hiking.py
this will also write them to locations.json
then, run
python clean_locations.py
this will clean them up, but it takes a while (about 15 minutes)
then run
node server.js

Things to work on
ambitious goal: add hiking 
    scraper tool for hiking websites
ambitious goal: add a dialogue option for planning a weekend trip (use the app integrated with chat plus mapping features like hotels and restaurants)
    chat bot more interactive?
