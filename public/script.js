// script.js

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('query-form');
  const resultDiv = document.getElementById('result');
  const activitySelect = document.getElementById('activity');
  const distanceInput = document.getElementById('distance');
  const unitsSelect = document.getElementById('units');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    // Clear previous results or errors
    resultDiv.innerHTML = '';

    const query = document.getElementById('query').value;
    const selectedActivity = activitySelect.value;
    const selectedDistance = distanceInput.value;
    const selectedUnits = unitsSelect.value;

    // Disable the submit button to prevent multiple submissions
    const submitButton = document.getElementById('submit-button');
    submitButton.disabled = true;

    // Get user's location (latitude and longitude)
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;

          try {
            const response = await fetch('/api/query', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: query,
                activity: selectedActivity,
                distance: selectedDistance,
                units: selectedUnits,
                latitude: latitude,
                longitude: longitude,
              }),
            });

            if (!response.ok) {
              throw new Error('Network response was not ok');
            }

            const data = await response.json();

            if (data.error) {
              resultDiv.innerHTML = `<p>${data.error}</p>`;
            } else {
              resultDiv.innerHTML = `<p>${data.response}</p>`;
              // Optionally display recommendations
              if (data.recommendations) {
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
        },
        (error) => {
          console.error('Geolocation error:', error);
          resultDiv.innerHTML = '<p>Unable to retrieve your location. Please allow location access or enter your location manually.</p>';
          // Re-enable the submit button
          submitButton.disabled = false;
        }
      );
    } else {
      resultDiv.innerHTML = '<p>Geolocation is not supported by your browser.</p>';
      // Re-enable the submit button
      submitButton.disabled = false;
    }
  });
});
