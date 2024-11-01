// public/script.js

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('query-form');
  const resultDiv = document.getElementById('response-container');
  const manualLocationInput = document.getElementById('manual-location');
  const dateSelect = document.getElementById('date-select');
  const timeSelect = document.getElementById('time-select');
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

  // Enforce date range (today to next 7 days)
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to midnight
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + 7);
  maxDate.setHours(0, 0, 0, 0); // Set to midnight
  const todayStr = today.toISOString().split('T')[0];
  const maxDateStr = maxDate.toISOString().split('T')[0];

  dateSelect.setAttribute('min', todayStr);
  dateSelect.setAttribute('max', maxDateStr);
  dateSelect.value = todayStr; // Default to today

  // Initialize time selector to empty
  timeSelect.value = '';

  // Check if elements exist
  if (!form || !resultDiv || !dateSelect || !activitySelect || !distanceSelect || !unitsSelect) {
    console.error('One or more form elements not found.');
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    console.log('Form submitted'); // Debugging

    // Clear previous results or errors
    resultDiv.innerHTML = '';
    markersLayer.clearLayers();

    const selectedDate = dateSelect.value;
    const selectedTime = timeSelect.value; // Optional
    const selectedActivity = activitySelect.value;
    const selectedDistance = distanceSelect.value;
    const selectedUnits = unitsSelect.value;

    // Validate selected date
    const selectedDateObj = new Date(selectedDate);
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); // Set to midnight 

    const maxDateObj = new Date();
    maxDateObj.setDate(currentDate.getDate() + 7);
    maxDateObj.setHours(0, 0, 0, 0); // Set to midnight

    //if (selectedDateObj < currentDate || selectedDateObj > maxDateObj) { // Check if selected date is within the next 7 days
  //    resultDiv.innerHTML = '<p>Please select a date within the next 7 days.</p>'; // Error message
  //    return; // Exit the function
 //   }

    // Validate selected time (optional)
    let selectedDateTime = null;
    if (selectedTime) {
      const timeParts = selectedTime.split(':');
      if (timeParts.length === 2) {
        selectedDateTime = new Date(selectedDate);
        selectedDateTime.setHours(parseInt(timeParts[0], 10));
        selectedDateTime.setMinutes(parseInt(timeParts[1], 10));
        selectedDateTime.setSeconds(0);
        selectedDateTime.setMilliseconds(0);

        const now = new Date();
        if (selectedDateObj.toDateString() === now.toDateString()) {
          // If selected date is today, ensure time is in the future
          if (selectedDateTime <= now) {
            resultDiv.innerHTML = '<p>Please select a time in the future for today\'s date.</p>';
            return;
          }
        }
      } else {
        resultDiv.innerHTML = '<p>Please select a valid time.</p>';
        return;
      }
    } else {
      // Default to 12:00 PM if time is not selected
      selectedDateTime = new Date(selectedDate);
      selectedDateTime.setHours(12);
      selectedDateTime.setMinutes(0);
      selectedDateTime.setSeconds(0);
      selectedDateTime.setMilliseconds(0);
    }

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
          date: selectedDate,
          time: selectedTime || null, // Optional
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

                  // Handle missing city and state
                  const city = location.city && location.city !== 'Unknown' ? location.city : '';
                  const state = location.state && location.state !== 'Unknown' ? location.state : '';

                  let locationText = `${location.name}`;
                  if (city || state) {
                    locationText += ` in ${city}${city && state ? ', ' : ''}${state}`;
                  }

                  // Add address if available
                  const address = location.address || '';
                  if (address) {
                    locationText += `, ${address}`;
                  }

                  // Add navigation prompt
                  const navigationLink = document.createElement('a');
                  navigationLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || `${latitude},${longitude}`)}`;
                  navigationLink.target = '_blank';
                  navigationLink.textContent = ' Navigate';

                  listItem.textContent = locationText;
                  listItem.appendChild(navigationLink);
                  recommendationsList.appendChild(listItem);

                  // Add marker to map
                  const marker = L.marker([location.geometry.location.lat, location.geometry.location.lng])
                    .addTo(markersLayer)
                    .bindPopup(`${location.name} in ${city}, ${state}${address ? ', ' + address : ''} <br><a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || `${latitude},${longitude}`)}" target="_blank">Navigate</a>`);
                });
                resultDiv.appendChild(recommendationsList);
              });
            } else {
              // For other activities
              const recommendationsList = document.createElement('ul');
              data.recommendations.forEach((location) => {
                const listItem = document.createElement('li');

                // Handle missing city and state
                const city = location.city && location.city !== 'Unknown' ? location.city : '';
                const state = location.state && location.state !== 'Unknown' ? location.state : '';

                let locationText = `${location.name}`;
                if (city || state) {
                  locationText += ` in ${city}${city && state ? ', ' : ''}${state}`;
                }

                // Add address if available
                const address = location.address || '';
                if (address) {
                  locationText += `, ${address}`;
                }

                // Add navigation prompt
                const navigationLink = document.createElement('a');
                navigationLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || `${latitude},${longitude}`)}`;
                navigationLink.target = '_blank';
                navigationLink.textContent = ' Navigate';

                listItem.textContent = locationText;
                listItem.appendChild(navigationLink);
                recommendationsList.appendChild(listItem);

                // Add marker to map
                const marker = L.marker([location.geometry.location.lat, location.geometry.location.lng])
                  .addTo(markersLayer)
                  .bindPopup(`${location.name} in ${city}, ${state}${address ? ', ' + address : ''} <br><a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || `${latitude},${longitude}`)}" target="_blank">Navigate</a>`);
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
