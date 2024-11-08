import requests
from bs4 import BeautifulSoup
import json
import os
import re

# Base URL and output file
base_url = "https://www.hikenewengland.com/index.php"
output_file = "data/locations.json"  # Updated to write to locations.json

# Headers to mimic a browser request
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

# Ensure the output directory exists
os.makedirs("data", exist_ok=True)

# Load existing data to avoid duplicates
if os.path.exists(output_file):
    with open(output_file, "r") as file:
        try:
            hikes_data = json.load(file)
        except json.JSONDecodeError:
            hikes_data = []
else:
    hikes_data = []

# Function to clean name by removing parenthetical content
def clean_name(name):
    return re.sub(r"\(.*?\)", "", name).strip()

# Function to scrape a single page of hikes
def scrape_hikes_page(page_url):
    response = requests.get(page_url, headers=headers)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    # Find the main table containing hike listings
    hikes_table = soup.find("table", class_="ListingTable")
    if not hikes_table:
        print("Hikes table not found on page.")
        return []

    hikes = []
    for row in hikes_table.find_all("tr")[1:]:  # Skip header row
        columns = row.find_all("td")
        if len(columns) < 10:
            continue

        try:
            # Extract name and clean it
            raw_name = columns[0].get_text(strip=True)
            name = clean_name(raw_name)

            # Locate the second <span class="small"> for the actual city and state
            location_spans = columns[1].find_all("span", class_="small")
            if len(location_spans) >= 2:
                city_state = location_spans[1].get_text(strip=True)  # Second span for city and state
                if ", " in city_state:
                    city, state = city_state.split(", ")
                else:
                    city, state = city_state, ""
            else:
                city, state = "", ""

            # Construct the hike data without the slower coordinate lookup
            hike = {
                "name": name,
                "description": columns[6].get_text(strip=True),  # Use features as description
                "geometry": {
                    "location": {
                        "lat": "",  # Coordinates removed for troubleshooting
                        "lng": ""
                    }
                },
                "city": city,
                "state": state,
                "activities": ["hiking"],
                "difficulty": columns[4].get_text(strip=True),
                "distance_miles": columns[5].get_text(strip=True),
                "features": columns[6].get_text(strip=True)
            }

            # Add only unique hikes
            if not any(existing_hike["name"] == hike["name"] and existing_hike["city"] == hike["city"] for existing_hike in hikes_data):
                hikes.append(hike)
                print(f"Added hike: {hike['name']} - {city}, {state}")
        except Exception as e:
            print(f"Error parsing row: {e}")
    
    return hikes

# Scrape the first page only for troubleshooting
page_number = 1
page_url = f"{base_url}?PageNbr={page_number}"
print(f"Scraping page {page_number} for troubleshooting...")
new_hikes = scrape_hikes_page(page_url)
hikes_data.extend(new_hikes)

# Save the data to locations.json
with open(output_file, "w") as file:
    json.dump(hikes_data, file, indent=4)
    print(f"Saved data to {output_file}")

print("Troubleshooting scrape complete.")
