# scrape_golf_courses.py
from requests_html import HTMLSession
import json
import os
from geopy.geocoders import Nominatim
import time

def scrape_golf_courses():
    url = "http://www.newenglandgolf.com/map/"
    session = HTMLSession()
    response = session.get(url)
    
    # Render the JavaScript
    response.html.render(sleep=5, timeout=30)
    
    # Use the CSS selectors you provided to extract the data
    # Since the popups appear when you click on the markers, we need to simulate clicks
    # However, requests_html doesn't support clicking on the map markers directly
    # Instead, we'll extract the JavaScript variables or network requests if possible

    # Alternative approach: Extract data from JavaScript variables
    # After inspecting the page, unfortunately, the markers data is not readily available

    # Since we cannot interact with the map directly, we'll look for alternative data sources
    # In this case, the website has a directory of golf courses we can scrape

    # Let's fetch the list of golf courses from another page
    directory_url = "http://www.newenglandgolf.com/golfcourses/"
    directory_response = session.get(directory_url)
    directory_response.html.render(sleep=5, timeout=30)
    
    # Extract course links from the directory
    course_links = directory_response.html.xpath('//div[@class="categoryListing"]/ul/li/a/@href')
    
    courses = []
    geolocator = Nominatim(user_agent="ActivityRecommender/1.0 (your.email@example.com)")

    for link in course_links:
        # Visit each course page
        course_page = session.get(link)
        course_page.html.render(sleep=2, timeout=20)
        
        # Extract course name
        course_name_elem = course_page.html.find('h1', first=True)
        if course_name_elem:
            course_name = course_name_elem.text.strip()
        else:
            continue  # Skip if course name not found

        # Extract address
        address_elem = course_page.html.find('div.address', first=True)
        if address_elem:
            address = address_elem.text.strip()
        else:
            address = ''

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
        time.sleep(1)  # Be polite and avoid overwhelming the server

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
