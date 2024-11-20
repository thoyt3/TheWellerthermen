import requests
from bs4 import BeautifulSoup
import json
import os
import time
import re
from urllib.parse import urlencode

# Constants
BASE_URL = "https://masspickleballguide.com/directory-pickleball-clubs-courts/"
TOTAL_PAGES = 28
OUTPUT_DIR = "data"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "locations.json")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PickleballScraper/1.0; +https://yourdomain.com/)"
}
GEOCODING_URL = "https://nominatim.openstreetmap.org/search"
GEOCODING_EMAIL = "your-email@example.com"  # Replace with your email as per Nominatim's policy

def create_data_folder():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created directory: {OUTPUT_DIR}")

def load_existing_data():
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                print(f"Loaded {len(data)} existing records from {OUTPUT_FILE}")
                return data
            except json.JSONDecodeError:
                print(f"Warning: {OUTPUT_FILE} is empty or invalid. Starting with an empty list.")
                return []
    else:
        return []

def save_data(data):
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)
    print(f"Saved {len(data)} records to {OUTPUT_FILE}")

def parse_address(full_address):
    """
    Parses the full address to extract address, city, and state.
    Assumes the address format: '64 C Street, Boston, Massachusetts 02127'
    """
    try:
        parts = full_address.split(',')
        if len(parts) >= 3:
            street_address = parts[0].strip()
            city = parts[1].strip()
            state_zip = parts[2].strip()
            state_match = re.match(r'([A-Za-z\s]+)\s+\d{5}', state_zip)
            if state_match:
                state_full = state_match.group(1).strip()
                state = state_full  # Keeping full state name; can convert to abbreviation if needed
            else:
                state = ""
            return street_address, city, state
        else:
            return "", "", ""
    except Exception as e:
        print(f"Error parsing address '{full_address}': {e}")
        return "", "", ""

def geocode_address(address, city, state):
    """
    Geocodes the address using Nominatim API to get latitude and longitude.
    """
    try:
        query = f"{address}, {city}, {state}"
        params = {
            'q': query,
            'format': 'json',
            'limit': 1,
            'addressdetails': 0,
            'email': GEOCODING_EMAIL  # Nominatim requires a valid email
        }
        url = f"{GEOCODING_URL}?{urlencode(params)}"
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        if data:
            lat = float(data[0]['lat'])
            lon = float(data[0]['lon'])
            print(f"Geocoded '{query}' to lat: {lat}, lon: {lon}")
            return lat, lon
        else:
            print(f"No geocoding result for '{query}'.")
            return None, None
    except Exception as e:
        print(f"Error geocoding address '{address}, {city}, {state}': {e}")
        return None, None

def main():
    create_data_folder()
    existing_data = load_existing_data()
    new_records = []

    for page in range(1, TOTAL_PAGES + 1):
        if page == 1:
            url = BASE_URL
        else:
            url = f"{BASE_URL}?_page={page}&num=10&sort=random"
        
        print(f"\nScraping page {page}: {url}")
        try:
            response = requests.get(url, headers=HEADERS)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")

            # Find all listing containers
            # Assuming each listing is within an <a> tag with specific classes
            listings = soup.find_all("a", class_=re.compile(r"drts-entity-permalink"))
            print(f"Found {len(listings)} listings on page {page}")

            for listing in listings:
                try:
                    name = listing.get_text(strip=True)
                    listing_url = listing.get('href')

                    # The address is within a sibling or parent container
                    # Navigate the DOM to find the address
                    # Assuming the structure based on the provided HTML excerpt
                    address_span = listing.find_next("span", class_=re.compile(r"drts-location-address"))
                    if address_span:
                        full_address = address_span.get_text(strip=True)
                        address, city, state = parse_address(full_address)
                    else:
                        full_address = ""
                        address, city, state = "", "", ""
                    
                    # Optionally, extract phone number
                    phone = ""
                    phone_link = listing.find_next("a", href=re.compile(r"tel:"))
                    if phone_link:
                        phone = phone_link.get_text(strip=True)
                    
                    # Geocode the address to get lat and lng
                    if address and city and state:
                        lat, lng = geocode_address(address, city, state)
                        # Respect Nominatim's usage policy by sleeping for 1 second between requests
                        time.sleep(1)
                    else:
                        lat, lng = None, None
                    
                    # Construct the record
                    record = {
                        "name": name,
                        "description": "",  # Can be enhanced to include more details
                        "address": address,
                        "city": city,
                        "state": state,
                        "geometry": {
                            "location": {
                                "lat": lat,
                                "lng": lng
                            }
                        },
                        "activities": [
                            "pickleball"
                        ]
                    }

                    # Optionally, add phone to description or as a separate field
                    if phone:
                        record["description"] = f"Phone: {phone}"

                    # Check for duplicates based on name and address
                    if not any(d["name"] == record["name"] and d["address"] == record["address"] for d in existing_data + new_records):
                        new_records.append(record)
                        print(f"Added: {name}, {address}, {city}, {state}")
                    else:
                        print(f"Duplicate found. Skipping: {name}, {address}, {city}, {state}")

                except Exception as e:
                    print(f"Error processing a listing: {e}")
                    continue

            # Be polite and wait a bit before the next page request
            time.sleep(1)

        except requests.HTTPError as http_err:
            print(f"HTTP error occurred while fetching page {page}: {http_err}")
            continue
        except Exception as err:
            print(f"Other error occurred while fetching page {page}: {err}")
            continue

    # Combine existing data with new records
    combined_data = existing_data + new_records
    save_data(combined_data)
    print("\nScraping completed.")

if __name__ == "__main__":
    main()
