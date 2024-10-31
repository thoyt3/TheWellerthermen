# scrape_golf_courses.py
import json
import os
import time
from geopy.geocoders import Nominatim
from playwright.sync_api import sync_playwright

def scrape_golf_courses():
    courses = []
    geolocator = Nominatim(user_agent="ActivityRecommender/1.0 (your.email@example.com)")

    with sync_playwright() as p:
        # Launch the browser
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Navigate to the website
        page.goto("http://www.newenglandgolf.com/map/")

        # Wait for the map to load
        page.wait_for_selector(".leaflet-marker-icon", timeout=10000)

        # Get all the markers
        markers = page.query_selector_all(".leaflet-marker-icon")
        print(f"Found {len(markers)} markers on the map.")

        for index, marker in enumerate(markers):
            try:
                print(f"Processing marker {index + 1}/{len(markers)}")
                # Click on the marker
                marker.click()
                time.sleep(1)  # Wait for the popup to appear

                # Extract the popup content
                popup_content = page.query_selector(".leaflet-popup-content")
                if not popup_content:
                    print("Popup content not found.")
                    continue

                # Extract course name and address
                course_name = popup_content.query_selector("strong").inner_text().strip()
                address_elements = popup_content.inner_text().split("\n")
                address = address_elements[-1].strip()

                print(f"Course Name: {course_name}")
                print(f"Address: {address}")

                # Geocode the address
                location = geolocator.geocode(address)
                if location:
                    lat = location.latitude
                    lng = location.longitude
                    print(f"Coordinates: {lat}, {lng}")
                else:
                    print(f"Could not geocode address: {address}")
                    continue

                # Get city and state
                address_components = location.raw.get('address', {})
                city = address_components.get('city', '') or address_components.get('town', '') or address_components.get('village', '')
                state = address_components.get('state', '')

                course_data = {
                    "name": course_name,
                    "geometry": {
                        "location": {
                            "lat": lat,
                            "lng": lng
                        }
                    },
                    "city": city,
                    "state": state,
                    "activities": ["golf"]
                }

                courses.append(course_data)

                # Close the popup by clicking elsewhere
                page.click("body", position={"x": 0, "y": 0})
                time.sleep(0.5)

            except Exception as e:
                print(f"An error occurred: {e}")
                continue

        browser.close()

    # Load existing locations
    locations_file = os.path.join('data', 'locations.json')
    existing_locations = []
    if os.path.exists(locations_file):
        with open(locations_file, 'r') as f:
            existing_locations = json.load(f)

    # Create a set to avoid duplicates
    existing_set = set(
        (loc['name'], loc['geometry']['location']['lat'], loc['geometry']['location']['lng'])
        for loc in existing_locations
    )

    # Add new courses to existing locations
    for course in courses:
        key = (course['name'], course['geometry']['location']['lat'], course['geometry']['location']['lng'])
        if key not in existing_set:
            existing_locations.append(course)
            existing_set.add(key)
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
    print('Data collection complete. Locations saved to data/locations.json')

if __name__ == '__main__':
    scrape_golf_courses()
