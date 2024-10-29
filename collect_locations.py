# collect_locations.py
import requests
import json
import os

def get_locations(query, region):
    url = 'https://nominatim.openstreetmap.org/search'
    params = {
        'q': f'{query} in {region}',
        'format': 'json',
        'limit': 50
    }
    headers = {
        'User-Agent': 'ActivityRecommender/1.0 (your.email@example.com)'  # Replace with your app name and email
    }
    response = requests.get(url, params=params, headers=headers)
    try:
        data = response.json()
    except json.decoder.JSONDecodeError:
        print("Error: Could not decode JSON response. Please check your User-Agent header and API usage limits.")
        print("Response text:", response.text)
        return []
    locations = []
    for place in data:
        if 'lat' in place and 'lon' in place:
            # Reverse geocode to get city and state
            details = get_place_details(place['lat'], place['lon'])
            location = {
                "name": place.get('display_name', 'Unknown'),
                "geometry": {
                    "location": {
                        "lat": float(place['lat']),
                        "lng": float(place['lon'])
                    }
                },
                "city": details.get('city', ''),
                "state": details.get('state', ''),
                "activities": []
            }
            locations.append(location)
    return locations

def get_place_details(lat, lon):
    url = 'https://nominatim.openstreetmap.org/reverse'
    params = {
        'lat': lat,
        'lon': lon,
        'format': 'jsonv2',
        'addressdetails': 1
    }
    headers = {
        'User-Agent': 'ActivityRecommender/1.0 (your.email@example.com)'
    }
    response = requests.get(url, params=params, headers=headers)
    try:
        data = response.json()
        address = data.get('address', {})
        return address
    except json.decoder.JSONDecodeError:
        print("Error: Could not decode JSON response in reverse geocoding.")
        return {}

def main():
    region = 'New England'
    activities = {
        'scuba_diving': 'scuba diving sites',
        'golf': 'golf courses'
    }

    # Load existing locations if available
    existing_locations = []
    locations_file = os.path.join('data', 'locations.json')
    if os.path.exists(locations_file):
        with open(locations_file, 'r') as f:
            existing_locations = json.load(f)

    # Create a dictionary to avoid duplicates
    existing_locations_dict = {(loc['name'], loc['geometry']['location']['lat'], loc['geometry']['location']['lng']): loc for loc in existing_locations}

    for activity_key, activity_query in activities.items():
        print(f'Collecting {activity_query}...')
        collected_locations = get_locations(activity_query, region)

        for loc in collected_locations:
            key = (loc['name'], loc['geometry']['location']['lat'], loc['geometry']['location']['lng'])
            if key in existing_locations_dict:
                # Add activity if not already in activities
                if activity_key not in existing_locations_dict[key]['activities']:
                    existing_locations_dict[key]['activities'].append(activity_key)
            else:
                # New location
                loc['activities'].append(activity_key)
                existing_locations_dict[key] = loc

    # Save to locations.json
    os.makedirs('data', exist_ok=True)
    with open(locations_file, 'w') as f:
        json.dump(list(existing_locations_dict.values()), f, indent=2)
    print('Data collection complete. Locations saved to data/locations.json')

if __name__ == '__main__':
    main()
