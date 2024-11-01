// server.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const NodeCache = require('node-cache');
const { Configuration, OpenAIApi } = require('openai');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Initialize cache with a TTL of 1 hour
const cache = new NodeCache({ stdTTL: 3600 });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// OpenAI API configuration
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Load locations data from JSON file
let locationsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'locations.json'), 'utf8')
);

// Ensure that diveType is set for each location
locationsData = locationsData.map((loc) => {
  if (!loc.diveType) {
    // If diveType is missing, default to 'shore' (or handle as needed)
    loc.diveType = 'shore';
  }
  return loc;
});

// Endpoint to handle user queries
app.post('/api/query', async (req, res) => {
  const selectedDate = req.body.date; // Get the selected date
  const selectedTime = req.body.time; // Get the selected time (optional)
  const selectedActivity = req.body.activity;
  const selectedDistance = req.body.distance || 25; // Default to 25 miles
  const selectedUnits = req.body.units || 'imperial';
  const activity = selectedActivity;

  console.log('Activity:', activity); // Debugging
  console.log('Selected Date:', selectedDate);
  console.log('Selected Time:', selectedTime);

  try {
    const latitude = req.body.latitude;
    const longitude = req.body.longitude;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Invalid or missing location data.' });
    }

    // Fetch activity locations
    const activityLocations = await getActivityLocations(
      activity,
      latitude,
      longitude,
      selectedDistance
    );

    if (activityLocations.length === 0) {
      return res.json({
        response: `No suitable locations found within ${selectedDistance} miles.`,
        recommendations: [],
      });
    }

    // Process data and generate recommendations
    const recommendations = await processRecommendations(
      activityLocations,
      activity,
      selectedUnits,
      selectedDate,
      selectedTime
    );

    if (recommendations.length === 0) {
      return res.json({
        response: `No suitable locations found within ${selectedDistance} miles.`,
        recommendations: [],
      });
    }

    // Use OpenAI API to format the response
    const aiResponse = await getAIResponse(selectedDate, selectedTime, recommendations, selectedUnits, activity);

    res.json({ response: aiResponse, recommendations });
  } catch (error) {
    console.error('Error during /api/query:', error);
    res.status(500).json({
      error: 'An error occurred while processing your request. Please try again later.',
    });
  }
});

// Endpoint to geocode address
app.get('/api/geocode', async (req, res) => {
  const address = req.query.address;
  try {
    const geocodeUrl = 'https://maps.googleapis.com/maps/api/geocode/json';
    const response = await axios.get(geocodeUrl, {
      params: {
        address: address,
        key: process.env.GEOCODING_API_KEY,
      },
    });
    if (response.data.results.length > 0) {
      const location = response.data.results[0].geometry.location;
      res.json({ latitude: location.lat, longitude: location.lng });
    } else {
      res.json({ error: 'Location not found' });
    }
  } catch (error) {
    console.error('Error during /api/geocode:', error);
    res.status(500).json({ error: 'Failed to geocode the address. Please try again later.' });
  }
});

// Function to calculate distance between two coordinates using the Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Function to fetch per-location weather data with caching
async function getLocationWeatherData(latitude, longitude, selectedDate, selectedTime) {
  const cacheKey = `weather_${latitude}_${longitude}_${selectedDate}_${selectedTime}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      // Convert selectedDate and selectedTime to UNIX timestamp
      let timestamp;
      if (selectedTime) {
        const dateTime = new Date(`${selectedDate}T${selectedTime}:00`);
        timestamp = Math.floor(dateTime.getTime() / 1000);
      } else {
        // Default to 12:00 PM if time is not selected
        const dateTime = new Date(`${selectedDate}T12:00:00`);
        timestamp = Math.floor(dateTime.getTime() / 1000);
      }

      const weatherUrl = 'https://api.openweathermap.org/data/3.0/onecall/timemachine';
      const response = await axios.get(weatherUrl, {
        params: {
          lat: latitude,
          lon: longitude,
          dt: timestamp,
          units: 'metric',
          appid: process.env.OPENWEATHERMAP_API_KEY,
        },
      });
      data = response.data;
      cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching location weather data:', error);
      throw new Error('Failed to fetch location weather data.');
    }
  }
}

// Function to fetch wave and water temperature data with caching
async function getWaveData(latitude, longitude, start, end) {
  const cacheKey = `wave_${latitude}_${longitude}_${start}_${end}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      const waveUrl = 'https://api.stormglass.io/v2/weather/point';

      const response = await axios.get(waveUrl, {
        params: {
          lat: latitude,
          lng: longitude,
          params: 'waveHeight,wavePeriod,waterTemperature',
          source: 'noaa',
          start: start,
          end: end,
        },
        headers: {
          Authorization: process.env.STORMGLASS_API_KEY,
        },
      });
      data = response.data;
      cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching wave data:', error.response ? error.response.data : error.message);
      throw new Error('Failed to fetch wave data.');
    }
  }
}

// Function to fetch tide data with caching
async function getTideData(latitude, longitude, date, selectedTime) {
  const cacheKey = `tide_${latitude}_${longitude}_${date}_${selectedTime}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      const tideUrl = 'https://www.worldtides.info/api/v3';
      // Combine date and time to get accurate tide data
      let datetime = date;
      if (selectedTime) {
        datetime += ` ${selectedTime}`;
      }
      const response = await axios.get(tideUrl, {
        params: {
          lat: latitude,
          lon: longitude,
          date: datetime,
          key: process.env.WORLDTIDES_API_KEY,
          extremes: '', // Include the 'extremes' parameter
        },
      });
      data = response.data;
      cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching tide data:', error);
      // Handle tide data failure gracefully
      return null;
    }
  }
}

// Function to determine thermal protection recommendation
function getThermalProtectionRecommendation(waterTempF) {
  if (waterTempF > 82.4) {
    return 'Swim suit, rashguard, or UV protective dive skin';
  } else if (waterTempF >= 77 && waterTempF <= 80.6) {
    return '2 mm shorty wetsuit or 1 mm full suit';
  } else if (waterTempF >= 71.6 && waterTempF <= 75.2) {
    return '3 mm full suit';
  } else if (waterTempF >= 62.6 && waterTempF <= 69.8) {
    return '5 mm full suit';
  } else if (waterTempF >= 55 && waterTempF <= 62.5) {
    return '7 mm full suit';
  } else {
    return 'Dry suit';
  }
}

// Function to fetch activity locations with caching and distance filtering
async function getActivityLocations(activity, latitude, longitude, maxDistance) {
  const cacheKey = `locations_${activity}`;
  let data = cache.get(cacheKey);

  if (data) {
    data = data;
  } else {
    try {
      // Read from locations.json (already loaded as locationsData)
      const locations = locationsData.filter((loc) => loc.activities.includes(activity));
      data = locations;

      cache.set(cacheKey, data);
    } catch (error) {
      console.error('Error fetching activity locations:', error);
      throw new Error('Failed to fetch activity locations.');
    }
  }

  // Calculate distances and filter locations based on distance
  const locationsWithDistance = data.map((location) => {
    const locLat = location.geometry.location.lat;
    const locLng = location.geometry.location.lng;
    const distance = calculateDistance(latitude, longitude, locLat, locLng);
    return { ...location, distance };
  });

  // Filter locations within maxDistance
  const filteredLocations = locationsWithDistance.filter((loc) => loc.distance <= maxDistance);

  // Sort locations by distance
  filteredLocations.sort((a, b) => a.distance - b.distance);

  return filteredLocations;
}

// Function to process recommendations
async function processRecommendations(locations, activity, units, selectedDate, selectedTime) {
  // Iterate over locations and score them
  let scoredLocations = [];

  // Convert selectedDate and selectedTime to UNIX timestamp
  let selectedTimestamp;
  if (selectedTime) {
    const dateTime = new Date(`${selectedDate}T${selectedTime}:00`);
    selectedTimestamp = Math.floor(dateTime.getTime() / 1000);
  } else {
    // Default to 12:00 PM if time is not selected
    const dateTime = new Date(`${selectedDate}T12:00:00`);
    selectedTimestamp = Math.floor(dateTime.getTime() / 1000);
  }

  for (const location of locations) {
    let score = 0;

    const locLat = location.geometry.location.lat;
    const locLng = location.geometry.location.lng;

    // Fetch per-location weather data
    let locationWeatherData;
    try {
      locationWeatherData = await getLocationWeatherData(locLat, locLng, selectedDate, selectedTime);
    } catch (error) {
      console.error(`Skipping location ${location.name} due to weather data error.`);
      continue;
    }

    // Extract weather information
    const locationCurrentWeather = locationWeatherData.data[0];

    location.weather = {
      temperature: locationCurrentWeather.temp,
      windSpeed: locationCurrentWeather.wind_speed,
      windDeg: locationCurrentWeather.wind_deg, // Wind direction in degrees
      clouds: locationCurrentWeather.clouds,
      pop: locationCurrentWeather.pop,
      uvi: locationCurrentWeather.uvi,
      description: locationCurrentWeather.weather[0].description,
      // OpenWeatherMap Timemachine API doesn't provide moon phase, sunrise, or sunset
    };

    if (activity === 'scuba_diving') {
      // Fetch wave data
      const waveStart = selectedTimestamp;
      const waveEnd = waveStart + 6 * 3600; // 6 hours ahead

      let waveData;
      try {
        waveData = await getWaveData(locLat, locLng, waveStart, waveEnd);
      } catch (error) {
        console.error(`Skipping location ${location.name} due to wave data error.`);
        continue;
      }

      const waveHours = waveData && waveData.hours;

      if (waveHours && waveHours.length > 0) {
        // Find the data point closest to selected date and time
        const selectedDateTime = new Date(selectedTimestamp * 1000);
        let closestHour = waveHours.reduce((prev, curr) => {
          const prevDiff = Math.abs(new Date(prev.time) - selectedDateTime);
          const currDiff = Math.abs(new Date(curr.time) - selectedDateTime);
          return currDiff < prevDiff ? curr : prev;
        });

        const waveHeight = closestHour.waveHeight.noaa;
        const wavePeriod = closestHour.wavePeriod.noaa;
        const waterTemperatureC = closestHour.waterTemperature.noaa;
        const waterTemperatureF = (waterTemperatureC * 9) / 5 + 32;

        location.waveData = {
          waveHeight:
            units === 'imperial'
              ? (waveHeight * 3.28084).toFixed(2) // meters to feet
              : waveHeight.toFixed(2), // meters
          wavePeriod: wavePeriod.toFixed(2), // seconds
        };
        location.waterTemperature =
          units === 'imperial'
            ? waterTemperatureF.toFixed(2) // Celsius to Fahrenheit
            : waterTemperatureC.toFixed(2); // Celsius

        // Determine thermal protection recommendation
        location.thermalProtectionRecommendation = getThermalProtectionRecommendation(
          waterTemperatureF
        );
      }

      // Fetch tide data
      let tideData;
      try {
        tideData = await getTideData(locLat, locLng, selectedDate, selectedTime);
      } catch (error) {
        console.error(`Error fetching tide data for location ${location.name}:`, error);
        tideData = null;
      }
      location.tideData = tideData;

      // Include tide data
      if (location.tideData && location.tideData.extremes && location.tideData.extremes.length > 0) {
        const nowTimestamp = selectedTimestamp;
        const upcomingHighTides = location.tideData.extremes.filter(
          (extreme) => extreme.type === 'High' && extreme.timestamp >= nowTimestamp
        );
        if (upcomingHighTides.length > 0) {
          const nextHighTide = upcomingHighTides[0];
          location.nextHighTide = new Date(nextHighTide.timestamp * 1000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          // Without sunrise and sunset data, we cannot determine if it's night
          location.nextHighTideIsAtNight = null;
        }
      }

      // Scoring logic for scuba diving
      // Example: Lower wave height and favorable visibility increase score
      if (location.waveData && location.waveData.waveHeight) {
        const waveHeight = parseFloat(location.waveData.waveHeight);
        if (waveHeight <= 3) {
          score += 10;
        } else if (waveHeight <= 5) {
          score += 5;
        } else {
          score -= 5;
        }
      }

      // Incorporate wind direction into scoring (e.g., favorable wind direction)
      if (location.weather.windDeg !== undefined) {
        // Example: Favor wind directions between 90 and 270 degrees (from east to west)
        if (location.weather.windDeg >= 90 && location.weather.windDeg <= 270) {
          score += 5;
        } else {
          score -= 5;
        }
      }

      // For now, set poorVisibility to false as we lack necessary data
      location.poorVisibility = false;
      score += 5;
    } else {
      // Scoring logic for other activities
      // For brevity, I'm not including detailed scoring logic here
    }

    // Attach score to location
    location.score = score;
    scoredLocations.push(location);
  }

  if (activity === 'scuba_diving') {
    // Segregate shore and boat dives
    const shoreDives = scoredLocations.filter((loc) => loc.diveType === 'shore');
    const boatDives = scoredLocations.filter((loc) => loc.diveType === 'boat');

    // Sort each list by score
    shoreDives.sort((a, b) => b.score - a.score);
    boatDives.sort((a, b) => b.score - a.score);

    // Select top 3 shore dives and top 1 boat dive
    const topShoreDives = shoreDives.slice(0, 3);
    const topBoatDives = boatDives.slice(0, 1);

    // Combine the recommendations with section labels
    const recommendations = [
      { type: 'shore', dives: topShoreDives },
      { type: 'boat', dives: topBoatDives },
    ];

    return recommendations;
  } else {
    // Sort locations by score in descending order
    scoredLocations.sort((a, b) => b.score - a.score);

    // Return top 3 recommendations
    return scoredLocations.slice(0, 3);
  }
}

// Function to get AI response from OpenAI API
async function getAIResponse(selectedDate, selectedTime, recommendations, units, activity) {
  const activityName = activity.replace('_', ' ');
  let locationInfo = '';

  if (activity === 'scuba_diving') {
    recommendations.forEach((section) => {
      const sectionTitle = section.type === 'shore' ? 'Shore Dives' : 'Boat Dives';
      locationInfo += `---\n${sectionTitle}:\n---\n`;
      section.dives.forEach((loc) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const weather = loc.weather || {};
        const unitsTemp = units === 'imperial' ? '°F' : '°C';
        const unitsSpeed = units === 'imperial' ? 'mph' : 'm/s';
        const windDirection = getWindDirection(weather.windDeg);

        let info = `${locName} in ${city}, ${state}\n`;
        info += `Weather: ${weather.description}, Temperature: ${
          units === 'imperial'
            ? ((weather.temperature * 9) / 5 + 32).toFixed(2)
            : weather.temperature.toFixed(2)
        }${unitsTemp}, Wind Speed: ${
          units === 'imperial'
            ? (weather.windSpeed * 2.23694).toFixed(2)
            : weather.windSpeed.toFixed(2)
        } ${unitsSpeed}, Wind Direction: ${windDirection}\n`;

        const waveData = loc.waveData || {};
        const waterTemp = loc.waterTemperature;
        const unitsHeight = units === 'imperial' ? 'ft' : 'm';

        if (waveData.waveHeight !== undefined) {
          info += `Wave Height: ${waveData.waveHeight} ${unitsHeight}, Wave Period: ${waveData.wavePeriod} s\n`;
          info += `Water Temperature: ${waterTemp} ${unitsTemp}\n`;
          info += `Appropriate Thermal Protection: ${loc.thermalProtectionRecommendation}\n`;
        }

        if (loc.poorVisibility !== undefined) {
          info += `Poor Visibility: ${loc.poorVisibility ? 'Yes' : 'No'}\n`;
        }

        if (loc.nextHighTide) {
          info += `Next High Tide: ${loc.nextHighTide}\n`;
          if (loc.nextHighTideIsAtNight !== null) {
            info += `Next High Tide Is At Night: ${loc.nextHighTideIsAtNight ? 'Yes' : 'No'}\n`;
          }
        }

        locationInfo += info + '\n';
      });
    });
  } else {
    // For other activities
    locationInfo = recommendations
      .map((loc) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const weather = loc.weather || {};
        const unitsTemp = units === 'imperial' ? '°F' : '°C';
        const unitsSpeed = units === 'imperial' ? 'mph' : 'm/s';
        const windDirection = getWindDirection(weather.windDeg);

        let info = `${locName} in ${city}, ${state}\n`;
        info += `Weather: ${weather.description}, Temperature: ${
          units === 'imperial'
            ? ((weather.temperature * 9) / 5 + 32).toFixed(2)
            : weather.temperature.toFixed(2)
        }${unitsTemp}, Wind Speed: ${
          units === 'imperial'
            ? (weather.windSpeed * 2.23694).toFixed(2)
            : weather.windSpeed.toFixed(2)
        } ${unitsSpeed}, Wind Direction: ${windDirection}\n`;

        // Add other activity-specific info here

        return info;
      })
      .join('\n');
  }

  let systemPrompt = `You are an expert advisor specializing in ${activityName}. Provide detailed recommendations based on the current conditions at specific locations for the date ${selectedDate} and time ${selectedTime || 'any time'}. Use ${units} units in your responses.

Use the data provided to make specific recommendations.

For ${activityName}, consider the following when making recommendations:
- Use the "Appropriate Thermal Protection" provided in the data.
- If "Poor Visibility" is "Yes," advise accordingly.
- Suggest dive/no dive recommendations based on wave conditions.
- If air temperature is below freezing, advise on additional surface protection.
- Segregate shore dives and boat dives in your recommendations.
`;

  let userPrompt = `Based on the selected date "${selectedDate}" and time "${selectedTime || 'any time'}", and the current conditions at the following locations, please provide your recommendations:

${locationInfo}`;

  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ];

  try {
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error from OpenAI API:', error.response ? error.response.data : error.message);
    throw new Error('Failed to get response from AI assistant.');
  }
}

// Helper function to convert wind degrees to compass direction
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return 'Unknown';
  const directions = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N',
  ];
  const index = Math.round(degrees / 22.5);
  return directions[index];
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
