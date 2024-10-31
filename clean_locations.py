# clean_locations.py

import json
import os
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
import time

def clean_locations():
    # Load existing locations
    locations_file = os.path.join('data', 'locations.json')
    if not os.path.exists(locations_file):
        print(f"{locations_file} not found.")
        return

    with open(locations_file, 'r') as f:
        locations = json.load(f)

    geolocator = Nominatim(user_agent="ActivityRecommender/1.0 (your.email@example.com)")
    cleaned_locations = []
    seen_locations = set()

    for index, loc in enumerate(locations):
        print(f"Processing location {index+1}/{len(locations)}: {loc.get('name', 'Unknown')}")
        name = loc.get('name', '').strip()
        geometry = loc.get('geometry', {})
        location_field = geometry.get('location', {})
        lat = location_field.get('lat')
        lng = location_field.get('lng')
        city = loc.get('city', '').strip()
        state = loc.get('state', '').strip()
        activities = loc.get('activities', [])

        # If lat/lng are missing, but city/state are present, geocode to get lat/lng
        if (lat is None or lng is None) and city and state:
            address = f"{city}, {state}"
            try:
                location = geolocator.geocode(address, timeout=10)
                if location:
                    lat = location.latitude
                    lng = location.longitude
                    print(f"Geocoded {address}: {lat}, {lng}")
                else:
                    print(f"Could not geocode address: {address}")
                    continue
            except (GeocoderTimedOut, GeocoderServiceError) as e:
                print(f"Geocoding error for address {address}: {e}")
                continue

        # If city/state are missing, but lat/lng are present, reverse geocode to get city/state
        if (not city or not state) and lat is not None and lng is not None:
            try:
                location = geolocator.reverse((lat, lng), exactly_one=True, timeout=10)
                if location and location.address:
                    address_components = location.raw.get('address', {})
                    city = address_components.get('city', '') or address_components.get('town', '') or address_components.get('village', '')
                    state = address_components.get('state', '')
                    print(f"Reverse geocoded {lat}, {lng}: {city}, {state}")
                else:
                    print(f"Could not reverse geocode coordinates: {lat}, {lng}")
                    continue
            except (GeocoderTimedOut, GeocoderServiceError) as e:
                print(f"Reverse geocoding error for coordinates {lat}, {lng}: {e}")
                continue

        # Update the location data
        loc['name'] = name
        loc['geometry'] = {
            'location': {
                'lat': lat,
                'lng': lng
            }
        }
        loc['city'] = city
        loc['state'] = state
        loc['activities'] = activities

        # Create a unique key for each location based on name and coordinates
        location_key = (name.lower(), round(lat, 6), round(lng, 6))

        if location_key in seen_locations:
            print(f"Duplicate found: {name} at ({lat}, {lng}). Skipping.")
            continue  # Ignore exact matches (duplicates)
        else:
            seen_locations.add(location_key)
            cleaned_locations.append(loc)

        time.sleep(1)  # Be polite and avoid overwhelming the geocoding service

    # Save cleaned locations to 'clean_locations.json'
    cleaned_locations_file = os.path.join('data', 'clean_locations.json')
    with open(cleaned_locations_file, 'w') as f:
        json.dump(cleaned_locations, f, indent=2)

    print(f"Data cleaning complete. Cleaned locations saved to {cleaned_locations_file}")

if __name__ == '__main__':
    clean_locations()
