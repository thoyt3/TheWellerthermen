// public/script.js

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('query-form');
  const resultDiv = document.getElementById('response-container');
  const queryInput = document.getElementById('user-query');
  const manualLocationInput = document.getElementById('manual-location');
  const activitySelect = document.getElementById('activity-select');
  const distanceSelect = document.getElementById('distance-select');
  const unitsSelect = document.getElementById('units-select');
  const submitButton = form.querySelector('button[type="submit"]');

  // Initialize the map
  const map = L.map('map').setView([42.3601, -71.0589], 10); // Default to Boston

  // Add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  // Layer group for markers
  const markersLayer = L.featureGroup().addTo(map);

  // Check if elements exist
  if (!form || !resultDiv || !queryInput || !activitySelect || !distanceSelect || !unitsSelect) {
    console.error('One or more form elements not found.');
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    console.log('Form submitted'); // Debugging

    // Clear previous results or errors
    resultDiv.innerHTML = '';
    markersLayer.clearLayers();

    const query = queryInput.value;
    const selectedActivity = activitySelect.value;
    const selectedDistance = distanceSelect.value;
    const selectedUnits = unitsSelect.value;

    // Disable the submit button to prevent multiple submissions
    submitButton.disabled = true;

    // Show "Processing..." message
    resultDiv.innerHTML = '<p>Processing your request. Please wait...</p>';

    // Get user's location (latitude and longitude)
    const manualLocation = manualLocationInput.value.trim();
    let latitude, longitude;

    if (manualLocation) {
      // Geocode manual location
      try {
        const geocodeResponse = await fetch(`/api/geocode?address=${encodeURIComponent(manualLocation)}`);
        const geocodeData = await geocodeResponse.json();
        if (geocodeData.latitude && geocodeData.longitude) {
          latitude = geocodeData.latitude;
          longitude = geocodeData.longitude;
        } else {
          throw new Error('Location not found.');
        }

        await sendQuery();
      } catch (error) {
        console.error('Error during geocoding:', error);
        resultDiv.innerHTML = '<p>Failed to geocode the address. Please check your input.</p>';
        submitButton.disabled = false;
        return;
      }
    } else if ('geolocation' in navigator) {
      // Use geolocation
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;

          console.log('Geolocation obtained:', latitude, longitude); // Debugging

          await sendQuery();
        },
        (error) => {
          console.error('Geolocation error:', error);
          resultDiv.innerHTML =
            '<p>Unable to retrieve your location. Please allow location access or enter your location manually.</p>';
          // Re-enable the submit button
          submitButton.disabled = false;
        }
      );
    } else {
      resultDiv.innerHTML = '<p>Geolocation is not supported by your browser. Please enter your location manually.</p>';
      // Re-enable the submit button
      submitButton.disabled = false;
      return;
    }

    async function sendQuery() {
      try {
        const requestData = {
          query: query,
          activity: selectedActivity,
          distance: selectedDistance,
          units: selectedUnits,
          latitude: latitude,
          longitude: longitude,
        };

        console.log('Sending fetch request with data:', requestData); // Debugging

        const response = await fetch('/api/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestData),
        });

        console.log('Fetch response:', response); // Debugging

        if (!response.ok) {
          throw new Error(`Network response was not ok. Status: ${response.status}`);
        }

        const data = await response.json();

        console.log('Response data:', data); // Debugging

        if (data.error) {
          resultDiv.innerHTML = `<p>${data.error}</p>`;
        } else {
          resultDiv.innerHTML = `<p>${data.response}</p>`;
          // Display recommendations
          if (data.recommendations && data.recommendations.length > 0) {
            if (selectedActivity === 'scuba_diving') {
              data.recommendations.forEach((section) => {
                const sectionTitle = section.type === 'shore' ? 'Shore Dives' : 'Boat Dives';
                const sectionHeader = document.createElement('h2');
                sectionHeader.textContent = sectionTitle;
                resultDiv.appendChild(sectionHeader);

                const recommendationsList = document.createElement('ul');
                section.dives.forEach((location) => {
                  const listItem = document.createElement('li');
                  listItem.textContent = `${location.name} in ${location.city}, ${location.state}`;
                  recommendationsList.appendChild(listItem);

                  // Add marker to map
                  const marker = L.marker([location.geometry.location.lat, location.geometry.location.lng])
                    .addTo(markersLayer)
                    .bindPopup(`${location.name} in ${location.city}, ${location.state}`);
                });
                resultDiv.appendChild(recommendationsList);
              });
            } else {
              // For other activities
              const recommendationsList = document.createElement('ul');
              data.recommendations.forEach((location) => {
                const listItem = document.createElement('li');
                listItem.textContent = `${location.name} in ${location.city}, ${location.state}`;
                recommendationsList.appendChild(listItem);

                // Add marker to map
                const marker = L.marker([location.geometry.location.lat, location.geometry.location.lng])
                  .addTo(markersLayer)
                  .bindPopup(`${location.name} in ${location.city}, ${location.state}`);
              });
              resultDiv.appendChild(recommendationsList);
            }

            // Adjust map view to fit all markers
            const bounds = markersLayer.getBounds();
            if (bounds.isValid()) {
              map.fitBounds(bounds, { padding: [50, 50] });
            } else {
              map.setView([latitude, longitude], 10);
            }
          }
        }
      } catch (error) {
        console.error('Error:', error);
        resultDiv.innerHTML = '<p>An error occurred while processing your request.</p>';
      } finally {
        // Re-enable the submit button
        submitButton.disabled = false;
      }
    }
  });
});
