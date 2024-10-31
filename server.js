// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const nlp = require('compromise');
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
const locationsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'locations.json'), 'utf8')
);

// Endpoint to handle user queries
app.post('/api/query', async (req, res) => {
  const userQuery = req.body.query;
  const selectedActivity = req.body.activity;
  const selectedDistance = req.body.distance || 25; // Default to 25 miles
  const selectedUnits = req.body.units || 'imperial';
  const activity = selectedActivity || extractActivity(userQuery);

  console.log('Activity:', activity); // Debugging

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

    // Process data and generate recommendations
    const recommendations = await processRecommendations(
      activityLocations,
      activity,
      selectedUnits
    );

    // Use OpenAI API to format the response
    const aiResponse = await getAIResponse(userQuery, recommendations, selectedUnits, activity);

    res.json({ response: aiResponse, recommendations });
  } catch (error) {
    console.error('Error during /api/query:', error);
    res
      .status(500)
      .json({ error: 'An error occurred while processing your request. Please try again later.' });
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

// Function to extract activity from user query using NLP
function extractActivity(query) {
  const doc = nlp(query.toLowerCase());

  // Look for specific keywords with variants
  if (doc.has('scuba') || doc.has('diving') || doc.has('scuba diving')) {
    return 'scuba_diving';
  } else if (doc.has('golf') || doc.has('golfing')) {
    return 'golf';
  } else if (doc.has('surfing') || doc.has('surf')) {
    return 'surfing';
  } else if (doc.has('hiking') || doc.has('hike')) {
    return 'hiking';
  } else {
    return 'general';
  }
}

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
async function getLocationWeatherData(latitude, longitude) {
  const cacheKey = `weather_${latitude}_${longitude}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      const weatherUrl = 'https://api.openweathermap.org/data/3.0/onecall';
      const response = await axios.get(weatherUrl, {
        params: {
          lat: latitude,
          lon: longitude,
          exclude: 'minutely,hourly',
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
async function getWaveData(latitude, longitude) {
  const cacheKey = `wave_${latitude}_${longitude}`;
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
          end: new Date().toISOString(),
        },
        headers: {
          Authorization: process.env.STORMGLASS_API_KEY,
        },
      });
      data = response.data;
      cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching wave data:', error);
      throw new Error('Failed to fetch wave data.');
    }
  }
}

// Function to fetch tide data with caching
async function getTideData(latitude, longitude) {
  const cacheKey = `tide_${latitude}_${longitude}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      const tideUrl = 'https://www.worldtides.info/api/v3';
      const response = await axios.get(tideUrl, {
        params: {
          lat: latitude,
          lon: longitude,
          days: 1,
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
      // Read from locations.json
      const locations = locationsData.filter((loc) => loc.activities.includes(activity));
      data = locations;

      cache.set(cacheKey, data);
    } catch (error) {
      console.error('Error fetching activity locations:', error);
      throw new Error('Failed to fetch activity locations.');
    }
  }

  // Filter locations based on distance
  const filteredLocations = data.filter((location) => {
    const locLat = location.geometry.location.lat;
    const locLng = location.geometry.location.lng;
    const distance = calculateDistance(latitude, longitude, locLat, locLng);
    return distance <= maxDistance;
  });

  return filteredLocations;
}

// Function to process recommendations
async function processRecommendations(locations, activity, units) {
  // Iterate over locations and score them
  let scoredLocations = [];

  for (const location of locations) {
    let score = 0;

    const locLat = location.geometry.location.lat;
    const locLng = location.geometry.location.lng;

    // Fetch per-location weather data
    const locationWeatherData = await getLocationWeatherData(locLat, locLng);
    const locationDailyWeather = locationWeatherData.daily[0];

    location.weather = {
      temperature: locationDailyWeather.temp.day,
      windSpeed: locationDailyWeather.wind_speed,
      windDeg: locationDailyWeather.wind_deg,
      clouds: locationDailyWeather.clouds,
      pop: locationDailyWeather.pop,
      uvi: locationDailyWeather.uvi,
      description: locationDailyWeather.weather[0].description,
      moonPhase: locationDailyWeather.moon_phase,
      sunrise: locationDailyWeather.sunrise,
      sunset: locationDailyWeather.sunset,
    };

    if (activity === 'scuba_diving') {
      // Fetch wave data
      const waveData = await getWaveData(locLat, locLng);
      const waveInfo = waveData && waveData.hours && waveData.hours[0];

      if (waveInfo) {
        const waveHeight = waveInfo.waveHeight.noaa;
        const wavePeriod = waveInfo.wavePeriod.noaa;
        const waterTemperatureC = waveInfo.waterTemperature.noaa;
        const waterTemperatureF = (waterTemperatureC * 9) / 5 + 32;

        location.waveData = {
          waveHeight:
            units === 'imperial'
              ? (waveHeight * 3.28084).toFixed(2)
              : waveHeight.toFixed(2),
          wavePeriod: wavePeriod.toFixed(2),
        };
        location.waterTemperature =
          units === 'imperial'
            ? waterTemperatureF.toFixed(2)
            : waterTemperatureC.toFixed(2);

        // Determine thermal protection recommendation
        location.thermalProtectionRecommendation = getThermalProtectionRecommendation(
          waterTemperatureF
        );
      }

      // Fetch tide data
      const tideData = await getTideData(locLat, locLng);
      location.tideData = tideData;

      // Include tide data
      if (location.tideData && location.tideData.extremes && location.tideData.extremes.length > 0) {
        const now = Date.now() / 1000;
        const upcomingHighTides = location.tideData.extremes.filter(
          (extreme) => extreme.type === 'High' && extreme.timestamp >= now
        );
        if (upcomingHighTides.length > 0) {
          const nextHighTide = upcomingHighTides[0];
          location.nextHighTide = new Date(nextHighTide.timestamp * 1000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          // Determine if next high tide is during night time (after sunset and before sunrise)
          const sunset = new Date(location.weather.sunset * 1000);
          const sunrise = new Date(location.weather.sunrise * 1000);
          const nextHighTideDate = new Date(nextHighTide.timestamp * 1000);

          if (
            nextHighTideDate >= sunset ||
            nextHighTideDate <= sunrise
          ) {
            location.nextHighTideIsAtNight = true;
          } else {
            location.nextHighTideIsAtNight = false;
          }
        }
      }

      // Determine if it's a full moon
      if (location.weather.moonPhase >= 0.47 && location.weather.moonPhase <= 0.53) {
        location.isFullMoon = true;
      } else {
        location.isFullMoon = false;
      }

      // Determine visibility based on wind direction and beach orientation
      if (location.weather.windDeg !== undefined && location.beachOrientation !== undefined) {
        let angleDifference = Math.abs(location.weather.windDeg - location.beachOrientation);
        if (angleDifference > 180) {
          angleDifference = 360 - angleDifference;
        }
        location.poorVisibility = angleDifference <= 90;
      } else {
        location.poorVisibility = false; // Default if data is missing
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

      if (location.poorVisibility) {
        score -= 5;
      } else {
        score += 5;
      }

    } else {
      // Scoring logic for other activities
      // For brevity, I'm not including detailed scoring logic here
    }

    // Attach score to location
    location.score = score;
    scoredLocations.push(location);
  }

  // Sort locations by score in descending order
  scoredLocations.sort((a, b) => b.score - a.score);

  // Return top recommendations
  return scoredLocations.slice(0, 5);
}

// Function to get AI response from OpenAI API
async function getAIResponse(userQuery, recommendations, units, activity) {
  const activityName = activity.replace('_', ' ');
  const locationInfo = recommendations.map((loc) => {
    const locName = loc.name;
    const city = loc.city || '';
    const state = loc.state || '';
    const weather = loc.weather || {};
    const unitsTemp = units === 'imperial' ? '°F' : '°C';
    const unitsSpeed = units === 'imperial' ? 'mph' : 'm/s';

    let info = `${locName} in ${city}, ${state}\n`;
    info += `Weather: ${weather.description}, Temperature: ${
      units === 'imperial'
        ? ((weather.temperature * 9) / 5 + 32).toFixed(2)
        : weather.temperature.toFixed(2)
    }${unitsTemp}, Wind Speed: ${
      units === 'imperial'
        ? (weather.windSpeed * 2.23694).toFixed(2)
        : weather.windSpeed.toFixed(2)
    } ${unitsSpeed}\n`;

    if (activity === 'scuba_diving') {
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
        info += `Next High Tide Is At Night: ${loc.nextHighTideIsAtNight ? 'Yes' : 'No'}\n`;
      }

      if (loc.isFullMoon) {
        info += `It's a full moon tonight.\n`;
      }
    } else {
      // Add clothing recommendations for other activities
      // ...
    }

    return info;
  }).join('\n');

  let systemPrompt = `You are an expert advisor specializing in ${activityName}. Provide detailed recommendations based on the current conditions at specific locations. Use ${units} units in your responses.

Use the data provided to make specific recommendations. Only recommend a night dive if:
- It's a full moon tonight (as indicated by "It's a full moon tonight." in the data).
- The next high tide is at night (as indicated by "Next High Tide Is At Night: Yes").

Include the actual high tide times in your recommendations. Do not suggest checking for high tide times; provide them directly.

For ${activityName}, consider the following when making recommendations:
- Use the "Appropriate Thermal Protection" provided in the data.
- If "Poor Visibility" is "Yes," advise accordingly.
- Suggest dive/no dive recommendations based on wave conditions.
- If air temperature is below freezing, advise on additional surface protection.
`;

  let userPrompt = `Based on my query "${userQuery}" and the current conditions at the following locations, please provide your recommendations:

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

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
