# scrape_golf_courses_overpass.py
import overpy
import json
import os

def scrape_golf_courses():
    api = overpy.Overpass()

    # Define the query
    query = """
    [out:json];
    (
      area["name"="Maine"]->.maine;
      area["name"="Vermont"]->.vermont;
      area["name"="New Hampshire"]->.new_hampshire;
      area["name"="Massachusetts"]->.massachusetts;
      area["name"="Connecticut"]->.connecticut;
      area["name"="Rhode Island"]->.rhode_island;
      node["leisure"="golf_course"](area.maine);
      way["leisure"="golf_course"](area.maine);
      relation["leisure"="golf_course"](area.maine);
      node["leisure"="golf_course"](area.vermont);
      way["leisure"="golf_course"](area.vermont);
      relation["leisure"="golf_course"](area.vermont);
      node["leisure"="golf_course"](area.new_hampshire);
      way["leisure"="golf_course"](area.new_hampshire);
      relation["leisure"="golf_course"](area.new_hampshire);
      node["leisure"="golf_course"](area.massachusetts);
      way["leisure"="golf_course"](area.massachusetts);
      relation["leisure"="golf_course"](area.massachusetts);
      node["leisure"="golf_course"](area.connecticut);
      way["leisure"="golf_course"](area.connecticut);
      relation["leisure"="golf_course"](area.connecticut);
      node["leisure"="golf_course"](area.rhode_island);
      way["leisure"="golf_course"](area.rhode_island);
      relation["leisure"="golf_course"](area.rhode_island);
    );
    out center;
    """

    print("Sending query to Overpass API...")
    result = api.query(query)
    print("Query completed.")

    courses = []

    # Process nodes
    for node in result.nodes:
        name = node.tags.get('name', 'Unnamed Golf Course')
        lat = float(node.lat)
        lon = float(node.lon)
        city = node.tags.get('addr:city', '')
        state = node.tags.get('addr:state', '')
        course_data = {
            "name": name,
            "geometry": {
                "location": {
                    "lat": lat,
                    "lng": lon
                }
            },
            "city": city,
            "state": state,
            "activities": ["golf"]
        }
        courses.append(course_data)

    # Process ways and relations
    for element in result.ways + result.relations:
        name = element.tags.get('name', 'Unnamed Golf Course')
        if hasattr(element, 'center_lat') and hasattr(element, 'center_lon'):
            lat = float(element.center_lat)
            lon = float(element.center_lon)
        else:
            # Compute centroid
            lats = [float(node.lat) for node in element.nodes if hasattr(node, 'lat')]
            lons = [float(node.lon) for node in element.nodes if hasattr(node, 'lon')]
            if lats and lons:
                lat = sum(lats) / len(lats)
                lon = sum(lons) / len(lons)
            else:
                continue  # Skip if no coordinates are available
        city = element.tags.get('addr:city', '')
        state = element.tags.get('addr:state', '')
        course_data = {
            "name": name,
            "geometry": {
                "location": {
                    "lat": lat,
                    "lng": lon
                }
            },
            "city": city,
            "state": state,
            "activities": ["golf"]
        }
        courses.append(course_data)

    print(f"Total courses collected: {len(courses)}")

    # Load existing locations
    locations_file = os.path.join('data', 'locations.json')
    existing_locations = []
    if os.path.exists(locations_file):
        with open(locations_file, 'r') as f:
            existing_locations = json.load(f)
    else:
        print("locations.json not found. Creating a new one.")

    # Create a set to avoid duplicates
    existing_set = set(
        (loc['name'], loc['geometry']['location']['lat'], loc['geometry']['location']['lng'])
        for loc in existing_locations
    )

    # Add new courses to existing locations
    new_courses_added = 0
    for course in courses:
        key = (course['name'], course['geometry']['location']['lat'], course['geometry']['location']['lng'])
        if key not in existing_set:
            existing_locations.append(course)
            existing_set.add(key)
            new_courses_added += 1
        else:
            # Update activities if not already present
            for loc in existing_locations:
                if loc['name'] == course['name']:
                    if 'golf' not in loc['activities']:
                        loc['activities'].append('golf')
                    break

    # Save updated locations
    os.makedirs('data', exist_ok=True)
    with open(locations_file, 'w') as f:
        json.dump(existing_locations, f, indent=2)
    print(f'Data collection complete. {new_courses_added} new courses added. Locations saved to {locations_file}')

if __name__ == '__main__':
    scrape_golf_courses()
