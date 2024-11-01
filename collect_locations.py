# collect_locations.py

import json
import os
import time
from urllib.parse import urlparse, parse_qs
from geopy.geocoders import Nominatim
from playwright.sync_api import sync_playwright

def collect_dive_sites():
    base_url = "https://www.idivenewengland.com"
    locations = []
    geolocator = Nominatim(user_agent="ActivityRecommender/1.0 (your.email@example.com)")

    with sync_playwright() as p:
        # Launch the browser
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Navigate to the main page
        page.goto(base_url, wait_until="networkidle")

        # Wait for the navigation menu to load
        page.wait_for_selector("div.site-menu ul", timeout=60000)

        # Expand all menu items to ensure all links are accessible
        page.evaluate("""
            () => {
                const checkboxes = document.querySelectorAll('div.site-menu input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = true);
            }
        """)

        # Find all dive site links in the navigation menu
        dive_site_links = page.query_selector_all("div.site-menu ul a[href^='/dive-sites/']")

        # Filter out links that are just state links (e.g., /dive-sites/ma)
        dive_site_links = [link for link in dive_site_links if link.get_attribute('href').count('/') > 2]

        print(f"Found {len(dive_site_links)} dive site links.")

        for site_link_elem in dive_site_links:
            try:
                site_href = site_link_elem.get_attribute('href')
                site_url = base_url + site_href

                # Open the dive site page
                site_page = context.new_page()
                site_page.goto(site_url, wait_until="networkidle")
                site_page.wait_for_selector("div.narrow-section-wrapper", timeout=60000)

                # Extract the site name and city
                site_name_elem = site_page.query_selector("div.narrow-section-wrapper h2.title")
                site_name = site_name_elem.inner_text().strip()

                city_elem = site_page.query_selector("div.narrow-section-wrapper h3.title")
                city_name = city_elem.inner_text().strip()

                print(f"Processing dive site: {site_name}")

                # Extract dive site details
                description_elems = site_page.query_selector_all("div.narrow-section-wrapper p")
                description = "\n".join([elem.inner_text().strip() for elem in description_elems])

                # Determine dive type based on description and site name
                dive_type = 'shore'
                combined_text = (site_name + " " + description).lower()
                if 'boat dive' in combined_text or 'accessible by boat' in combined_text:
                    dive_type = 'boat'

                # Extract address from Google Maps iframe
                iframe_elem = site_page.query_selector("iframe")
                if iframe_elem:
                    iframe_src = iframe_elem.get_attribute('src')
                    # Extract address from iframe URL parameters
                    parsed_url = urlparse(iframe_src)
                    query_params = parse_qs(parsed_url.query)
                    address = query_params.get('q', [''])[0]
                else:
                    address = ''

                # Extract state abbreviation from URL
                state_abbr = site_href.split('/')[2].upper()

                # Geocode the address
                location = None
                if address:
                    address = address.strip()
                    # Try reverse geocoding if address is coordinates
                    latlon = address.split(',')
                    if len(latlon) == 2:
                        try:
                            lat = float(latlon[0].strip())
                            lon = float(latlon[1].strip())
                            location = geolocator.reverse((lat, lon), exactly_one=True)
                            print(f"Coordinates from reverse geocoding: {lat}, {lon}")
                        except ValueError:
                            # Not coordinates, proceed to geocode the address
                            pass
                    if not location:
                        # Try geocoding the address with variations
                        attempts = [address]
                        # Remove ZIP code if present
                        if address[-5:].isdigit():
                            address_no_zip = address[:-5].strip(' ,')
                            attempts.append(address_no_zip)
                        # Remove last component
                        address_parts = address.split(',')
                        if len(address_parts) > 2:
                            address_no_last = ','.join(address_parts[:-1])
                            attempts.append(address_no_last)
                        # Include site name, city, and state in attempts
                        attempts.append(f"{site_name}, {city_name}, {state_abbr}, USA")
                        attempts.append(f"{city_name}, {state_abbr}, USA")
                        # Try geocoding each attempt
                        for addr in attempts:
                            location = geolocator.geocode(addr)
                            if location:
                                print(f"Found location for address: {addr}")
                                break
                else:
                    # Try to geocode using site name and state
                    location = geolocator.geocode(f"{site_name}, {state_abbr}, USA")
                    if not location:
                        location = geolocator.geocode(f"{city_name}, {state_abbr}, USA")

                if location:
                    lat = location.latitude
                    lng = location.longitude
                    print(f"Coordinates: {lat}, {lng}")
                else:
                    print(f"Could not geocode address or site name for {site_name}")
                    site_page.close()
                    continue

                # Get city and state
                address_components = location.raw.get('address', {})
                city = (
                    address_components.get('city', '')
                    or address_components.get('town', '')
                    or address_components.get('village', '')
                )
                state_full = address_components.get('state', '')

                site_data = {
                    "name": site_name,
                    "description": description,
                    "geometry": {
                        "location": {
                            "lat": lat,
                            "lng": lng,
                        }
                    },
                    "city": city,
                    "state": state_full,
                    "activities": ["scuba_diving"],
                    "diveType": dive_type  # Add the diveType field
                }

                locations.append(site_data)

                site_page.close()
                time.sleep(1)
            except Exception as e:
                print(f"An error occurred while processing dive site {site_name}: {e}")
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

    # Add new locations to existing locations
    for location in locations:
        key = (
            location['name'],
            location['geometry']['location']['lat'],
            location['geometry']['location']['lng'],
        )
        if key not in existing_set:
            existing_locations.append(location)
            existing_set.add(key)
        else:
            # Update activities if not already present
            for loc in existing_locations:
                if loc['name'] == location['name']:
                    if 'scuba_diving' not in loc['activities']:
                        loc['activities'].append('scuba_diving')
                    if 'diveType' not in loc:
                        loc['diveType'] = location['diveType']
                    break

    # Save updated locations
    os.makedirs('data', exist_ok=True)
    with open(locations_file, 'w') as f:
        json.dump(existing_locations, f, indent=2)
    print('Data collection complete. Locations saved to data/locations.json')

if __name__ == '__main__':
    collect_dive_sites()
