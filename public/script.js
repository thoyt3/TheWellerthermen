// public/script.js

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('query-form');
  const resultDiv = document.getElementById('response-container');
  const manualLocationInput = document.getElementById('manual-location');
  const dateSelect = document.getElementById('date-select');
  const timeSelect = document.getElementById('time-select');
  const activitySelect = document.getElementById('activity-select');
  const unitsSelect = document.getElementById('units-select');
  const minDistanceInput = document.getElementById('min-distance');
  const maxDistanceInput = document.getElementById('max-distance');
  const submitButton = form.querySelector('button[type="submit"]');
  const activityImage = document.getElementById('activity-image');
  const specificLocationSelect = document.getElementById('specific-location');
  const singleSearchButton = document.getElementById('single-search-button');

  // Get the clear button element
  const clearSpecificLocationButton = document.getElementById('clear-specific-location');

  // Initialize the map
  const map = L.map('map').setView([42.3601, -71.0589], 10); // Default to Boston

  // Add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  // Set the default image on page load
  activityImage.src = 'images/default.jpg';
  activityImage.alt = 'Default Image';

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
  if (
    !form ||
    !resultDiv ||
    !dateSelect ||
    !activitySelect ||
    !unitsSelect ||
    !minDistanceInput ||
    !maxDistanceInput ||
    !specificLocationSelect ||
    !singleSearchButton
  ) {
    console.error('One or more form elements not found.');
    return;
  }

  // Function to validate distance inputs
  function validateDistances() {
    const units = unitsSelect.value;
    const maxLimit = units === 'imperial' ? 100 : 160;
    const minDistance = parseFloat(minDistanceInput.value) || 0;
    const maxDistance = parseFloat(maxDistanceInput.value) || 5;

    if (minDistance < 0) {
      minDistanceInput.value = 0;
    }

    if (maxDistance > maxLimit) {
      maxDistanceInput.value = maxLimit;
    }
  }

  // Add event listeners for units change and distance inputs
  unitsSelect.addEventListener('change', () => {
    validateDistances();
  });

  minDistanceInput.addEventListener('input', () => {
    validateDistances();
  });

  maxDistanceInput.addEventListener('input', () => {
    validateDistances();
  });

  // Update activity image and populate specific location dropdown when activity changes
  activitySelect.addEventListener('change', async () => {
    const activity = activitySelect.value;
    if (activity) {
      const imageUrl = `images/${activity}.jpg`;
      activityImage.src = imageUrl;
      activityImage.alt = activity.replace('_', ' ');

      // Fetch locations for the selected activity
      try {
        const response = await fetch(`/api/locations?activity=${activity}`);
        const locations = await response.json();

        // Clear previous options
        specificLocationSelect.innerHTML = '<option value="">Select a location (optional)</option>';

        // Populate dropdown
        locations.forEach((loc) => {
          const option = document.createElement('option');
          option.value = loc.id; // Ensure this is the correct id (number)
          option.textContent = loc.name;
          specificLocationSelect.appendChild(option);
        });

        // Reset Single Search button and submit button
        singleSearchButton.style.display = 'none';
        submitButton.style.display = 'inline-block'; // Show the submit button
        clearSpecificLocationButton.style.display = 'none'; // Hide the clear button
      } catch (error) {
        console.error('Error fetching locations:', error);
      }
    } else {
      activityImage.src = '';
      activityImage.alt = '';

      // Clear specific location dropdown
      specificLocationSelect.innerHTML = '<option value="">Select a location (optional)</option>';
    }
  });

  // Update the event listener for the specific location dropdown
  specificLocationSelect.addEventListener('change', () => {
    if (specificLocationSelect.value) {
      singleSearchButton.style.display = 'inline-block';
      submitButton.style.display = 'none'; // Hide the submit button
      clearSpecificLocationButton.style.display = 'inline-block'; // Show the clear button
    } else {
      singleSearchButton.style.display = 'none';
      submitButton.style.display = 'inline-block'; // Show the submit button
      clearSpecificLocationButton.style.display = 'none'; // Hide the clear button
    }
  });

  // Add event listener for the clear button
  clearSpecificLocationButton.addEventListener('click', () => {
    specificLocationSelect.value = '';
    specificLocationSelect.dispatchEvent(new Event('change'));
  });

  // Set the initial state of the Single Search button and clear button
  singleSearchButton.style.display = 'none';
  clearSpecificLocationButton.style.display = 'none';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    console.log('Form submitted'); // Debugging

    // Clear previous results or errors
    resultDiv.innerHTML = '';
    markersLayer.clearLayers();

    const selectedDate = dateSelect.value;
    const selectedTime = timeSelect.value; // Optional
    const selectedActivity = activitySelect.value;
    const units = unitsSelect.value;
    const manualLocation = manualLocationInput.value.trim();
    const minDistance = minDistanceInput.value;
    const maxDistance = maxDistanceInput.value;
    const specificLocation = null; // Do not include specificLocation in form submission

    console.log('Selected Date:', selectedDate);
    console.log('Selected Time:', selectedTime || 'Not specified');
    console.log('Selected Activity:', selectedActivity);
    console.log('Min Distance:', minDistance);
    console.log('Max Distance:', maxDistance);
    console.log('Selected Units:', units);
    console.log('Manual Location:', manualLocation || 'Not specified');
    console.log('Specific Location:', specificLocation || 'Not specified');

    // Validate selected date and time
    const selectedDateObj = new Date(selectedDate);
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); // Set to midnight

    const maxDateObj = new Date();
    maxDateObj.setDate(currentDate.getDate() + 7);
    maxDateObj.setHours(0, 0, 0, 0); // Set to midnight

    // Time validation
    let selectedDateTime = null;
    if (selectedTime) {
      const timeParts = selectedTime.split(':');
      if (timeParts.length === 2) {
        selectedDateTime = new Date(selectedDate);
        selectedDateTime.setHours(parseInt(timeParts[0], 10));
        selectedDateTime.setMinutes(parseInt(timeParts[1], 10));
        selectedDateTime.setSeconds(0);
        selectedDateTime.setMilliseconds(0);

        // Removed the validation that restricts selecting a past time for today
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

    let latitude = null;
    let longitude = null;

    // Define the sendQuery function here
    const sendQuery = async () => {
      try {
        const requestData = {
          date: selectedDate,
          time: selectedTime || null, // Optional
          activity: selectedActivity,
          minDistance: minDistance,
          maxDistance: maxDistance,
          units: units,
          latitude: latitude,
          longitude: longitude,
          specificLocation: specificLocation || null,
        };

        console.log('Sending fetch request with data:', requestData); // Debugging

        // Special handling for surfing activity
        if (selectedActivity === 'surfing') {
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Pretend to think

          // Check if user is in New England
          let isInNewEngland = false;
          const newEnglandStates = ['ME', 'NH', 'VT', 'MA', 'CT', 'RI'];

          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`
            );
            const locationData = await response.json();
            if (
              locationData.address &&
              newEnglandStates.includes(locationData.address.state_code)
            ) {
              isInNewEngland = true;
            }
          } catch (error) {
            console.error('Error determining user location:', error);
          }

          let message = 'Surfing is not available in this area.';
          if (isInNewEngland) {
            message =
              'Surfing in New England? You might need a thicker wetsuit!';
          } else {
            message = 'Surfing is not available in your selected area.';
          }

          resultDiv.innerHTML = `<p>${message}</p>`;
        } else {
          const response = await fetch('/api/query', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
          });

          console.log('Fetch response:', response); // Debugging

          if (!response.ok) {
            throw new Error(
              `Network response was not ok. Status: ${response.status}`
            );
          }

          const data = await response.json();

          console.log('Response data:', data); // Debugging

          if (data.error) {
            resultDiv.innerHTML = `<p>${data.error}</p>`;
          } else {
            resultDiv.innerHTML = `<p>${data.response}</p>`;
            displayRecommendations(data, latitude, longitude, selectedActivity);
          }
        }
      } catch (error) {
        console.error('Error:', error);
        resultDiv.innerHTML =
          '<p>An error occurred while processing your request.</p>';
      } finally {
        // Re-enable the submit button
        submitButton.disabled = false;
      }
    };

    // Get user's location (latitude and longitude)
    if (manualLocation) {
      // Geocode manual location
      try {
        const geocodeResponse = await fetch(
          `/api/geocode?address=${encodeURIComponent(manualLocation)}`
        );
        const geocodeData = await geocodeResponse.json();
        if (geocodeData.latitude && geocodeData.longitude) {
          latitude = geocodeData.latitude;
          longitude = geocodeData.longitude;

          console.log('Geocoded location:', latitude, longitude); // Debugging

          await sendQuery();
        } else {
          throw new Error('Location not found.');
        }
      } catch (error) {
        console.error('Error during geocoding:', error);
        resultDiv.innerHTML =
          '<p>Failed to geocode the address. Please check your input.</p>';
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
      resultDiv.innerHTML =
        '<p>Geolocation is not supported by your browser. Please enter your location manually.</p>';
      // Re-enable the submit button
      submitButton.disabled = false;
      return;
    }
  });

  // Single Search button event listener
  singleSearchButton.addEventListener('click', async () => {
    // Clear previous results or errors
    resultDiv.innerHTML = '';
    markersLayer.clearLayers();

    const selectedDate = dateSelect.value;
    const selectedTime = timeSelect.value; // Optional
    const selectedActivity = activitySelect.value;
    const units = unitsSelect.value;
    const manualLocation = manualLocationInput.value.trim();
    const specificLocation = specificLocationSelect.value;

    console.log('Selected Date:', selectedDate);
    console.log('Selected Time:', selectedTime || 'Not specified');
    console.log('Selected Activity:', selectedActivity);
    console.log('Selected Units:', units);
    console.log('Manual Location:', manualLocation || 'Not specified');
    console.log('Specific Location:', specificLocation || 'Not specified');

    // Disable the Single Search button to prevent multiple submissions
    singleSearchButton.disabled = true;

    // Show "Processing..." message
    resultDiv.innerHTML = '<p>Processing your request. Please wait...</p>';

    let latitude = null;
    let longitude = null;

    // Define the sendQuery function here
    const sendQuery = async () => {
      try {
        const requestData = {
          date: selectedDate,
          time: selectedTime || null, // Optional
          activity: selectedActivity,
          units: units,
          latitude: latitude,
          longitude: longitude,
          specificLocation: specificLocation,
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
          throw new Error(
            `Network response was not ok. Status: ${response.status}`
          );
        }

        const data = await response.json();

        console.log('Response data:', data); // Debugging

        if (data.error) {
          resultDiv.innerHTML = `<p>${data.error}</p>`;
        } else {
          resultDiv.innerHTML = `<p>${data.response}</p>`;
          displayRecommendations(data, latitude, longitude, selectedActivity);
        }
      } catch (error) {
        console.error('Error:', error);
        resultDiv.innerHTML =
          '<p>An error occurred while processing your request.</p>';
      } finally {
        // Re-enable the Single Search button
        singleSearchButton.disabled = false;
      }
    };

    // Get user's location (latitude and longitude)
    if (manualLocation) {
      // Geocode manual location
      try {
        const geocodeResponse = await fetch(
          `/api/geocode?address=${encodeURIComponent(manualLocation)}`
        );
        const geocodeData = await geocodeResponse.json();
        if (geocodeData.latitude && geocodeData.longitude) {
          latitude = geocodeData.latitude;
          longitude = geocodeData.longitude;

          console.log('Geocoded location:', latitude, longitude); // Debugging

          await sendQuery();
        } else {
          throw new Error('Location not found.');
        }
      } catch (error) {
        console.error('Error during geocoding:', error);
        resultDiv.innerHTML =
          '<p>Failed to geocode the address. Please check your input.</p>';
        singleSearchButton.disabled = false;
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
          // Re-enable the Single Search button
          singleSearchButton.disabled = false;
        }
      );
    } else {
      resultDiv.innerHTML =
        '<p>Geolocation is not supported by your browser. Please enter your location manually.</p>';
      // Re-enable the Single Search button
      singleSearchButton.disabled = false;
      return;
    }
  });

  // Function to display recommendations and add markers
  function displayRecommendations(data, latitude, longitude, selectedActivity) {
    // Clear previous markers
    markersLayer.clearLayers();

    if (data.recommendations && data.recommendations.length > 0) {
      if (selectedActivity === 'scuba_diving') {
        // ... [Scuba diving code remains the same]
      } else if (selectedActivity === 'pickleball') {
        // For pickleball
        const recommendationsData = data.recommendations;
        const indoorLocations = recommendationsData.indoorLocations || [];

        if (indoorLocations.length > 0) {
          const sectionHeader = document.createElement('h2');
          sectionHeader.textContent = 'Top 3 Nearby Indoor Pickleball Locations';
          resultDiv.appendChild(sectionHeader);

          const recommendationsList = document.createElement('ul');
          indoorLocations.forEach((location) => {
            const listItem = document.createElement('li');

            // Handle missing city and state
            const city = location.city || '';
            const state = location.state || '';
            const address = location.address || '';
            let phone = 'Phone number not available';

            // Extract phone number from description if available
            if (location.description) {
              const phoneMatch = location.description.match(/Phone:\s*(.*)/i);
              if (phoneMatch && phoneMatch[1]) {
                phone = phoneMatch[1];
              }
            }

            let locationText = `${location.name}`;
            if (city || state) {
              locationText += ` in ${city}${
                city && state ? ', ' : ''
              }${state}`;
            }

            if (address) {
              locationText += `, Address: ${address}`;
            }

            locationText += `, Phone: ${phone}`;

            // Create navigation link
            const navigationLink = document.createElement('a');
            navigationLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              `${location.latitude},${location.longitude}`
            )}`;
            navigationLink.target = '_blank';
            navigationLink.textContent = ' Navigate';

            listItem.textContent = locationText;
            listItem.appendChild(navigationLink);
            recommendationsList.appendChild(listItem);

            // Add marker to map with popup containing details
            const marker = L.marker([location.latitude, location.longitude])
              .addTo(markersLayer)
              .bindPopup(`
                <strong>${location.name}</strong><br>
                ${city}, ${state}${address ? ', ' + address : ''}<br>
                Phone: ${phone}<br>
                <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                  `${location.latitude},${location.longitude}`
                )}" target="_blank">Navigate</a>
              `);
          });
          resultDiv.appendChild(recommendationsList);
        } else {
          resultDiv.innerHTML +=
            '<p>No indoor pickleball locations found within your selected distance range.</p>';
        }
      } else {
        // For other activities
        const recommendationsList = document.createElement('ul');
        data.recommendations.recommendations.forEach((location) => {
          const listItem = document.createElement('li');

          // Handle missing city and state
          const city = location.city || '';
          const state = location.state || '';
          const address = location.address || '';
          const phone = location.phone || '';

          let locationText = `${location.name}`;
          if (city || state) {
            locationText += ` in ${city}${
              city && state ? ', ' : ''
            }${state}`;
          }

          if (address) {
            locationText += `, Address: ${address}`;
          }

          if (phone) {
            locationText += `, Phone: ${phone}`;
          }

          // Create navigation link
          const navigationLink = document.createElement('a');
          navigationLink.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            `${location.latitude},${location.longitude}`
          )}`;
          navigationLink.target = '_blank';
          navigationLink.textContent = ' Navigate';

          listItem.textContent = locationText;
          listItem.appendChild(navigationLink);
          recommendationsList.appendChild(listItem);

          // Add marker to map with popup containing details
          const marker = L.marker([location.latitude, location.longitude])
            .addTo(markersLayer)
            .bindPopup(`
              <strong>${location.name}</strong><br>
              ${city}, ${state}${address ? ', ' + address : ''}<br>
              ${phone ? 'Phone: ' + phone + '<br>' : ''}
              <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                `${location.latitude},${location.longitude}`
              )}" target="_blank">Navigate</a>
            `);
        });
        resultDiv.appendChild(recommendationsList);
      }

      // Add user's location marker
      const userMarker = L.marker([latitude, longitude], {
        icon: L.icon({
          iconUrl: 'images/user-marker.png', // Provide an icon image for user's location
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
        }),
      })
        .addTo(markersLayer)
        .bindPopup('Your Location');

      // Adjust map view to fit all markers
      const bounds = markersLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      } else {
        map.setView([latitude, longitude], 10);
      }
    }
  }
});
