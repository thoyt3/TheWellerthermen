// public/script.js
document.getElementById('query-form').addEventListener('submit', async (e) => {
    e.preventDefault();
  
    const queryInput = document.getElementById('user-query');
    const manualLocationInput = document.getElementById('manual-location');
    const userQuery = queryInput.value;
    const manualLocation = manualLocationInput.value;
  
    if (manualLocation) {
      // Geocode the manual location
      const coords = await geocodeLocation(manualLocation);
      if (coords) {
        await sendQuery(userQuery, coords.latitude, coords.longitude);
      } else {
        alert('Could not find the location you entered.');
      }
    } else {
      // Use geolocation
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
  
          await sendQuery(userQuery, latitude, longitude);
        }, (error) => {
          console.error('Error getting location:', error);
          alert('Unable to access your location. Please enter your location manually.');
        });
      } else {
        alert('Geolocation is not supported by your browser.');
      }
    }
  });
  
  async function geocodeLocation(location) {
    try {
      const response = await fetch(`/api/geocode?address=${encodeURIComponent(location)}`);
      const data = await response.json();
      if (data.error) {
        return null;
      } else {
        return { latitude: data.latitude, longitude: data.longitude };
      }
    } catch (error) {
      console.error('Error:', error);
      return null;
    }
  }
  
  async function sendQuery(userQuery, latitude, longitude) {
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: userQuery, latitude, longitude }),
      });
  
      const data = await response.json();
  
      if (data.error) {
        document.getElementById('response-container').innerText = data.error;
      } else {
        document.getElementById('response-container').innerText = data.response;
  
        // Initialize the map
        const map = L.map('map').setView([latitude, longitude], 10);
  
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
  
        // Add a marker for user's location
        L.marker([latitude, longitude]).addTo(map).bindPopup('Your Location').openPopup();
  
        // Add markers for recommendations
        data.recommendations.forEach((location) => {
          const locLat = location.geometry.location.lat;
          const locLng = location.geometry.location.lng;
          L.marker([locLat, locLng])
            .addTo(map)
            .bindPopup(`${location.name}<br>Score: ${location.score}`);
        });
      }
    } catch (error) {
      console.error('Error:', error);
      document.getElementById('response-container').innerText = 'An error occurred while processing your request.';
    }
  }
  