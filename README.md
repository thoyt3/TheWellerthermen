# TheWealltherMen

[Watch the final presentation video here](https://youtu.be/P6FjIJv17YA)

Esentially, this application provies the user with activity recommendations based on user inputs like activity type, date, time, and location. It uses data scraped from various websites that are compiled and cleaned before placing into a JSON file.
The server file loads the cleaned JSON and handles API requests. It uses asynchronous functions to fetch wewather, wave, tide, and lunar data from external APIs. It caches these responses in a SQLite database.
The script and index are client facing. They capture user inputs and send asychronous functions to the server. There is dynamic updating of the UI and images to make a more fun experience.
Finally, all the API query data is cached using SQLite to minimize the need for API calls. The server first checks to see whether the data exists in this database and retrieves it from there if possible before otherwise sending a query to the APIs.

to pull golf courses, use 
python golfing.py (was python scrape_golf_courses_overpass.py)
this will write them to locations.json
to pull dive sites, use
python diving.py (was python collect_locations.p)
this will also write them to locations.json
to pull hiking locations, use
python hiking.py
this will also write them to locations.json
to pull pickleball locations, use 
python pickleball.py
then, run
python clean_locations.py
this will clean them up, but it takes a while (about 15 minutes)
then run
node server.js



