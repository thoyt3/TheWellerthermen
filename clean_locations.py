import json
import os
import sys
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

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
    geocode_cache = {}

    def is_unknown(value):
        return value is None or str(value).strip().lower() in ['unknown', 'none', '']

    def process_location(loc):
        name = loc.get('name', '').strip()
        geometry = loc.get('geometry', {})
        location_field = geometry.get('location', {})
        lat = location_field.get('lat', None)
        lng = location_field.get('lng', None)
        city = loc.get('city', '').strip()
        state = loc.get('state', '').strip()
        activities = loc.get('activities', [])

        # Log start of processing for each location
        print(f"\nProcessing location: {name}")

        # Convert lat/lng to floats if possible
        lat = float(lat) if lat not in [None, '', 'None'] else None
        lng = float(lng) if lng not in [None, '', 'None'] else None

        # If lat/lng are missing or unknown, but city/state are present, attempt geocoding
        if (lat is None or lng is None or is_unknown(lat) or is_unknown(lng)) and not is_unknown(city) and not is_unknown(state):
            address = f"{city}, {state}"
            if address in geocode_cache:
                lat, lng = geocode_cache[address]
                print(f"Cache hit for address {address}: ({lat}, {lng})")
            else:
                location = geocode_with_retry(geolocator, address)
                if location:
                    lat, lng = location.latitude, location.longitude
                    geocode_cache[address] = (lat, lng)
                    print(f"Geocoded {address}: ({lat}, {lng})")
                else:
                    print(f"Failed to geocode address: {address}")

        # If city/state are missing or unknown, but lat/lng are present, attempt reverse geocoding
        if (is_unknown(city) or is_unknown(state)) and lat is not None and lng is not None:
            coords = (lat, lng)
            if coords in geocode_cache:
                city, state = geocode_cache[coords]
                print(f"Cache hit for coordinates {coords}: {city}, {state}")
            else:
                location = reverse_geocode_with_retry(geolocator, lat, lng)
                if location:
                    address_components = location.raw.get('address', {})
                    city = address_components.get('city', '') or address_components.get('town', '') or address_components.get('village', '') or address_components.get('hamlet', '')
                    state = address_components.get('state', '')
                    geocode_cache[coords] = (city, state)
                    print(f"Reverse geocoded ({lat}, {lng}): {city}, {state}")
                else:
                    print(f"Failed to reverse geocode coordinates: ({lat}, {lng})")

        # Skip if lat or lng is still missing after all attempts
        if lat is None or lng is None or is_unknown(lat) or is_unknown(lng):
            print(f"Skipping {name} - Could not determine coordinates.")
            return None

        # Skip if city or state is still missing after all attempts
        if is_unknown(city) or is_unknown(state):
            print(f"Skipping {name} - Could not determine city/state.")
            return None

        # Generate unique key to avoid duplicates
        location_key = (
            name.lower(),
            city.lower(),
            state.lower(),
            round(lat, 6),
            round(lng, 6)
        )

        if location_key in seen_locations:
            print(f"Duplicate found: {name} in {city}, {state} ({lat}, {lng}). Skipping.")
            return None  # Skip duplicates

        seen_locations.add(location_key)
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
        print(f"Added location: {name} - {city}, {state} ({lat}, {lng})")
        return loc

    # Use ThreadPoolExecutor for parallel processing of locations
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(process_location, loc) for loc in locations]
        for future in as_completed(futures):
            result = future.result()
            if result:
                cleaned_locations.append(result)

    # Assign unique IDs to each location
    for idx, loc in enumerate(cleaned_locations, start=1):
        loc['id'] = idx  # Assigning incremental IDs starting from 1

    # Save cleaned locations to 'clean_locations.json'
    cleaned_locations_file = os.path.join('data', 'clean_locations.json')
    with open(cleaned_locations_file, 'w') as f:
        json.dump(cleaned_locations, f, indent=2)

    print(f"\nData cleaning complete. Cleaned locations saved to {cleaned_locations_file}")

def geocode_with_retry(geolocator, address, max_retries=3):
    """Geocode with shorter exponential backoff retry."""
    for attempt in range(max_retries):
        try:
            return geolocator.geocode(address, timeout=10)
        except GeocoderTimedOut:
            delay = 0.2 * (2 ** attempt)  # Reduced delay
            print(f"Timeout while geocoding {address}. Retrying in {delay} seconds...")
            time.sleep(delay)
        except GeocoderServiceError as e:
            print(f"Service error while geocoding {address}: {e}")
            break
        except Exception as e:
            print(f"Unexpected error while geocoding {address}: {e}")
            break
    return None

def reverse_geocode_with_retry(geolocator, lat, lng, max_retries=3):
    """Reverse geocode with shorter exponential backoff retry."""
    for attempt in range(max_retries):
        try:
            return geolocator.reverse((lat, lng), exactly_one=True, timeout=10)
        except GeocoderTimedOut:
            delay = 0.2 * (2 ** attempt)  # Reduced delay
            print(f"Timeout while reverse geocoding ({lat}, {lng}). Retrying in {delay} seconds...")
            time.sleep(delay)
        except GeocoderServiceError as e:
            print(f"Service error while reverse geocoding ({lat}, {lng}): {e}")
            break
        except Exception as e:
            print(f"Unexpected error while reverse geocoding ({lat}, {lng}): {e}")
            break
    return None

if __name__ == '__main__':
    clean_locations()
