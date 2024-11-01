// public/script.js

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('query-form');
  const resultDiv = document.getElementById('response-container'); // Updated ID
  const queryInput = document.getElementById('user-query'); // Updated ID
  const manualLocationInput = document.getElementById('manual-location'); // Added for manual location
  const activitySelect = document.getElementById('activity-select'); // Updated ID
  const distanceSelect = document.getElementById('distance-select'); // Updated ID
  const unitsSelect = document.getElementById('units-select'); // Updated ID
  const submitButton = form.querySelector('button[type="submit"]'); // Get the submit button from the form

  // Check if elements exist
  if (!form || !resultDiv || !queryInput || !activitySelect || !distanceSelect || !unitsSelect) {
    console.error('One or more form elements not found.');
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    alert('Submit button clicked'); // This will display an alert when the form is submitted
    console.log('Form submitted'); // Debugging

    // Clear previous results or errors
    resultDiv.innerHTML = '';

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
      return; // Wait for geolocation callback
    } else {
      resultDiv.innerHTML = '<p>Geolocation is not supported by your browser. Please enter your location manually.</p>';
      // Re-enable the submit button
      submitButton.disabled = false;
      return;
    }

    // If manual location is used or geolocation is already obtained
    if (latitude && longitude) {
      await sendQuery();
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
          // Optionally display recommendations
          if (data.recommendations && data.recommendations.length > 0) {
            const recommendationsList = document.createElement('ul');
            data.recommendations.forEach((location) => {
              const listItem = document.createElement('li');
              listItem.textContent = `${location.name} in ${location.city}, ${location.state}`;
              recommendationsList.appendChild(listItem);
            });
            resultDiv.appendChild(recommendationsList);
          }
        }
      } catch (error) {
        console.error('Error:', error);
        resultDiv.innerHTML = '<p>An error occurred while processing your request.</p>';
      } finally {
        // Re-enable the submit button
        submitButton.disabled = false;
        // Reset the form if needed
        // form.reset();
      }
    }
  });
});
