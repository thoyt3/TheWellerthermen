// server.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// OpenAI API configuration
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY, // Ensure your OpenAI API key is set in .env file
});
const openai = new OpenAIApi(configuration);

// Initialize locationsData
let locationsData = [];

// Initialize SQLite database
const db = new sqlite3.Database('cache.db'); // Use 'cache.db' for persistent storage

// Create tables for caching data
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS weather_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude REAL,
      longitude REAL,
      date TEXT,
      data TEXT,
      timestamp INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wave_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude REAL,
      longitude REAL,
      start INTEGER,
      end INTEGER,
      data TEXT,
      timestamp INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tide_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude REAL,
      longitude REAL,
      date TEXT,
      data TEXT,
      timestamp INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS geocode_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE,
      latitude REAL,
      longitude REAL,
      timestamp INTEGER
    )
  `);
});

// Load locations data from JSON file asynchronously
fs.readFile(
  path.join(__dirname, 'data', 'clean_locations.json'),
  'utf8',
  (err, data) => {
    if (err) {
      console.error('Error reading locations data:', err);
      process.exit(1); // Exit the application if locations data cannot be loaded
    } else {
      try {
        locationsData = JSON.parse(data);

        // Ensure that diveType is set for each location (if exists)
        locationsData = locationsData.map((loc) => {
          if (!loc.diveType) {
            // If diveType is missing, default to 'shore' (or handle as needed)
            loc.diveType = 'shore';
          }
          return loc;
        });

        // Start the server after locations data is loaded
        app.listen(port, () => {
          console.log(`Server is running on http://localhost:${port}`);
        });
      } catch (parseErr) {
        console.error('Error parsing locations data:', parseErr);
        process.exit(1);
      }
    }
  }
);

// Endpoint to handle geocoding requests
app.get('/api/geocode', async (req, res) => {
  const address = req.query.address.trim();

  if (!address) {
    return res.status(400).json({ error: 'Address parameter is required.' });
  }

  // Check cache first
  db.get(
    `SELECT latitude, longitude FROM geocode_cache WHERE address = ?`,
    [address],
    async (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error.' });
      } else if (row) {
        // Cache hit
        const { latitude, longitude } = row;
        res.json({ latitude, longitude });
      } else {
        // Cache miss, fetch from API
        try {
          const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
              q: address,
              format: 'json',
              limit: 1,
            },
            headers: {
              'User-Agent': 'YourAppName/1.0 (your.email@example.com)',
              'Referer': 'YourAppWebsiteURL',
            },
          });

          if (response.data && response.data.length > 0) {
            const location = response.data[0];
            const latitude = parseFloat(location.lat);
            const longitude = parseFloat(location.lon);

            // Store in cache
            db.run(
              `INSERT INTO geocode_cache (address, latitude, longitude, timestamp) VALUES (?, ?, ?, ?)`,
              [address, latitude, longitude, Math.floor(Date.now() / 1000)],
              (err) => {
                if (err) {
                  console.error('Error inserting into geocode_cache:', err);
                }
              }
            );

            res.json({ latitude, longitude });
          } else {
            res.status(404).json({ error: 'Location not found.' });
          }
        } catch (error) {
          console.error('Error during geocoding:', error);
          res.status(500).json({ error: 'Failed to geocode the address.' });
        }
      }
    }
  );
});

// Endpoint to handle user queries
app.post('/api/query', async (req, res) => {
  const selectedDate = req.body.date; // Get the selected date
  const selectedTime = req.body.time; // Get the selected time (optional)
  const selectedActivity = req.body.activity;
  const distanceRange = req.body.distanceRange;
  const selectedUnits = req.body.units || 'imperial';
  const activity = selectedActivity;

  console.log('Activity:', activity); // Debugging
  console.log('Selected Date:', selectedDate);
  console.log('Selected Time:', selectedTime);
  console.log('Selected Distance Range:', distanceRange);
  console.log('Selected Units:', selectedUnits);

  try {
    const latitude = req.body.latitude;
    const longitude = req.body.longitude;

    if (!latitude || !longitude) {
      return res
        .status(400)
        .json({ error: 'Invalid or missing location data.' });
    }

    // Handle surfing activity
    if (activity === 'surfing') {
      // For now, return a fun message
      let isInNewEngland = false;
      const newEnglandStates = ['ME', 'NH', 'VT', 'MA', 'CT', 'RI'];

      try {
        const response = await axios.get(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
          {
            headers: {
              'User-Agent': 'YourAppName/1.0 (your.email@example.com)',
              'Referer': 'YourAppWebsiteURL',
            },
          }
        );
        if (
          response.data.address &&
          newEnglandStates.includes(response.data.address.state_code)
        ) {
          isInNewEngland = true;
        }
      } catch (error) {
        console.error('Error determining user location:', error);
      }

      let message = 'Surfing is not available in this area.';
      if (isInNewEngland) {
        message = 'Surfing in New England? You might need a thicker wetsuit!';
      } else {
        message = 'Surfing is not available in your selected area.';
      }

      return res.json({ response: message, recommendations: [] });
    }

    // Parse distanceRange into minDistance and maxDistance
    let minDistance = 0;
    let maxDistance = 25; // Default maxDistance

    if (distanceRange) {
      const [minStr, maxStr] = distanceRange.split('-');
      minDistance = parseFloat(minStr);
      maxDistance = parseFloat(maxStr);
    }

    console.log('Parsed Min Distance:', minDistance);
    console.log('Parsed Max Distance:', maxDistance);

    // Convert distances to miles if units are metric
    if (selectedUnits === 'metric') {
      minDistance = minDistance / 1.60934; // Convert km to miles
      maxDistance = maxDistance / 1.60934;
    }

    // Fetch activity locations
    const activityLocations = await getActivityLocations(
      activity,
      latitude,
      longitude,
      minDistance,
      maxDistance,
      10 // Limit to 10 locations
    );

    if (activityLocations.length === 0) {
      return res.json({
        response: `No suitable locations found within your selected distance range.`,
        recommendations: [],
      });
    }

    // Process data and generate recommendations
    const recommendations = await processRecommendations(
      activityLocations,
      activity,
      selectedUnits,
      selectedDate,
      selectedTime,
      latitude,
      longitude
    );

    if (recommendations.length === 0) {
      return res.json({
        response: `No suitable locations found within your selected distance range.`,
        recommendations: [],
      });
    }

    // Use OpenAI API to format the response
    const aiResponse = await getAIResponse(
      selectedDate,
      selectedTime,
      recommendations,
      selectedUnits,
      activity
    );

    res.json({ response: aiResponse, recommendations });
  } catch (error) {
    console.error('Error during /api/query:', error);
    res.status(500).json({
      error:
        'An error occurred while processing your request. Please try again later.',
    });
  }
});

// Helper functions

// Function to fetch activity locations based on distance and limit
async function getActivityLocations(
  activity,
  userLat,
  userLng,
  minDistance,
  maxDistance,
  limit = 10
) {
  // Filter locations based on activity
  const filteredLocations = locationsData.filter((loc) =>
    loc.activities.includes(activity)
  );

  // Calculate distances and filter based on min and max distance
  const locationsWithDistance = filteredLocations
    .map((loc) => {
      const locLat = loc.geometry.location.lat;
      const locLng = loc.geometry.location.lng;
      const distance = calculateDistance(userLat, userLng, locLat, locLng); // In miles

      return { ...loc, distance };
    })
    .filter(
      (loc) => loc.distance >= minDistance && loc.distance <= maxDistance
    );

  // Sort locations by distance
  locationsWithDistance.sort((a, b) => a.distance - b.distance);

  // Return the top locations within the limit
  return locationsWithDistance.slice(0, limit);
}

// Haversine formula to calculate distance between two coordinates in miles
function calculateDistance(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const R = 3958.8; // Radius of the Earth in miles
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in miles
}

// Function to process recommendations and get weather data
async function processRecommendations(
  activityLocations,
  activity,
  units,
  selectedDate,
  selectedTime,
  userLat,
  userLng
) {
  if (activity === 'scuba_diving') {
    // Initialize sections for shore and boat dives
    const shoreDives = [];
    const boatDives = [];

    for (const location of activityLocations) {
      let score = 0;

      const locLat = location.geometry.location.lat;
      const locLng = location.geometry.location.lng;

      // Fetch weather data with caching
      let weatherData;
      try {
        weatherData = await getLocationWeatherData(locLat, locLng, selectedDate);
      } catch (error) {
        console.error(
          `Skipping location ${location.name} due to weather data error.`
        );
        continue;
      }

      if (!weatherData) {
        console.error(
          `Skipping location ${location.name} due to missing weather data.`
        );
        continue;
      }

      // Process weather data and calculate scores
      // Example scoring logic (you can adjust this based on your criteria)
      const currentWeather = weatherData.current;
      const temperature = currentWeather.temp; // In Celsius
      const windSpeed = currentWeather.wind_speed; // In m/s
      const weatherDescription = currentWeather.weather[0].description;

      // Simple scoring based on temperature and wind speed
      if (temperature >= 10 && temperature <= 30) {
        score += 1;
      }
      if (windSpeed <= 5) {
        score += 1;
      }

      // Assign additional properties to location
      location.score = score;
      location.weather = {
        temperature,
        windSpeed,
        windDeg: currentWeather.wind_deg,
        description: weatherDescription,
      };

      // Add location to the appropriate section based on diveType
      if (location.diveType === 'shore') {
        shoreDives.push(location);
      } else if (location.diveType === 'boat') {
        boatDives.push(location);
      }
    }

    // Sort dives within each section by score
    shoreDives.sort((a, b) => b.score - a.score);
    boatDives.sort((a, b) => b.score - a.score);

    // Limit the number of dives in each section
    const maxDivesPerSection = 3;
    const recommendations = [];

    if (shoreDives.length > 0) {
      recommendations.push({
        type: 'shore',
        dives: shoreDives.slice(0, maxDivesPerSection),
      });
    }

    if (boatDives.length > 0) {
      recommendations.push({
        type: 'boat',
        dives: boatDives.slice(0, maxDivesPerSection),
      });
    }

    return recommendations;
  } else {
    // Existing logic for other activities
    const scoredLocations = [];

    for (const location of activityLocations) {
      let score = 0;

      const locLat = location.geometry.location.lat;
      const locLng = location.geometry.location.lng;

      // Fetch weather data with caching
      let weatherData;
      try {
        weatherData = await getLocationWeatherData(locLat, locLng, selectedDate);
      } catch (error) {
        console.error(
          `Skipping location ${location.name} due to weather data error.`
        );
        continue;
      }

      if (!weatherData) {
        console.error(
          `Skipping location ${location.name} due to missing weather data.`
        );
        continue;
      }

      // Process weather data and calculate scores
      // Example scoring logic (you can adjust this based on your criteria)
      const currentWeather = weatherData.current;
      const temperature = currentWeather.temp; // In Celsius
      const windSpeed = currentWeather.wind_speed; // In m/s
      const weatherDescription = currentWeather.weather[0].description;

      // Simple scoring based on temperature and wind speed
      if (temperature >= 10 && temperature <= 30) {
        score += 1;
      }
      if (windSpeed <= 5) {
        score += 1;
      }

      // Assign additional properties to location
      location.score = score;
      location.weather = {
        temperature,
        windSpeed,
        windDeg: currentWeather.wind_deg,
        description: weatherDescription,
      };

      scoredLocations.push(location);
    }

    // Sort locations by score
    scoredLocations.sort((a, b) => b.score - a.score);

    // Return top recommendations
    return scoredLocations.slice(0, 3);
  }
}

// Function to fetch per-location weather data with caching
async function getLocationWeatherData(latitude, longitude, selectedDate) {
  return new Promise((resolve, reject) => {
    const dateTimestamp = new Date(selectedDate).setHours(0, 0, 0, 0);

    // Check cache first
    db.get(
      `SELECT data FROM weather_cache WHERE latitude = ? AND longitude = ? AND date = ?`,
      [latitude, longitude, selectedDate],
      async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          reject(err);
        } else if (row) {
          // Cache hit
          resolve(JSON.parse(row.data));
        } else {
          // Cache miss, fetch from API
          try {
            const weatherUrl = 'https://api.openweathermap.org/data/3.0/onecall';
            const response = await axios.get(weatherUrl, {
              params: {
                lat: latitude,
                lon: longitude,
                units: 'metric',
                exclude: 'minutely,alerts',
                appid: process.env.OPENWEATHERMAP_API_KEY, // Ensure your OpenWeatherMap API key is set in .env file
              },
            });
            const data = response.data;

            // Store in cache
            db.run(
              `INSERT INTO weather_cache (latitude, longitude, date, data, timestamp) VALUES (?, ?, ?, ?, ?)`,
              [
                latitude,
                longitude,
                selectedDate,
                JSON.stringify(data),
                Math.floor(Date.now() / 1000),
              ],
              (err) => {
                if (err) {
                  console.error('Error inserting into weather_cache:', err);
                }
              }
            );

            resolve(data);
          } catch (error) {
            console.error('Error fetching weather data:', error);
            reject(error);
          }
        }
      }
    );
  });
}

// Function to get AI response from OpenAI API
async function getAIResponse(
  selectedDate,
  selectedTime,
  recommendations,
  units,
  activity
) {
  const activityName = activity.replace('_', ' ');
  let locationInfo = '';

  const unitsTemp = units === 'imperial' ? '°F' : '°C';
  const unitsSpeed = units === 'imperial' ? 'mph' : 'm/s';
  const unitsHeight = units === 'imperial' ? 'ft' : 'm';

  if (activity === 'scuba_diving') {
    recommendations.forEach((section) => {
      const sectionTitle = section.type === 'shore' ? 'Shore Dives' : 'Boat Dives';
      locationInfo += `${sectionTitle}:\n`;
      section.dives.forEach((loc) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const weather = loc.weather || {};
        const windDirection = getWindDirection(weather.windDeg);

        let info = `${locName} in ${city}, ${state}\n`;
        info += `Weather: ${weather.description}, Air Temperature: ${
          units === 'imperial'
            ? ((weather.temperature * 9) / 5 + 32).toFixed(2)
            : weather.temperature.toFixed(2)
        }${unitsTemp}\n`;

        // Wave data and other details can be added here if available

        // Visibility
        const visibility = loc.poorVisibility ? 'Possibly Reduced' : 'Likely Good';
        info += `Visibility: ${visibility}\n`;

        // Additional details from JSON file (e.g., dive site description)
        if (loc.diveSiteDescription) {
          info += `About the site: ${loc.diveSiteDescription}\n`;
        }

        // Prepare data for recommendations
        locationInfo += info + '\n';
      });
    });
  } else if (activity === 'golf' || activity === 'hiking') {
    // For golfing and hiking
    locationInfo = recommendations
      .map((loc) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const weather = loc.weather || {};
        const windDirection = getWindDirection(weather.windDeg);

        let info = `${locName} in ${city}, ${state}\n`;
        info += `Weather conditions: ${weather.description}\n`;
        info += `Temperature: ${
          units === 'imperial'
            ? ((weather.temperature * 9) / 5 + 32).toFixed(2)
            : weather.temperature.toFixed(2)
        }${unitsTemp}\n`;
        info += `Wind Speed: ${
          units === 'imperial'
            ? (weather.windSpeed * 2.23694).toFixed(2)
            : weather.windSpeed.toFixed(2)
        } ${unitsSpeed} from ${windDirection}\n`;

        // Additional details can be added here

        return info;
      })
      .join('\n');
  } else {
    // For other activities
    locationInfo = recommendations
      .map((loc) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const weather = loc.weather || {};
        const windDirection = getWindDirection(weather.windDeg);

        let info = `${locName} in ${city}, ${state}\n`;
        info += `Weather: ${weather.description}, Temperature: ${
          units === 'imperial'
            ? ((weather.temperature * 9) / 5 + 32).toFixed(2)
            : weather.temperature.toFixed(2)
        }${unitsTemp}\n`;
        info += `Wind Speed: ${
          units === 'imperial'
            ? (weather.windSpeed * 2.23694).toFixed(2)
            : weather.windSpeed.toFixed(2)
        } ${unitsSpeed} from ${windDirection}\n`;

        // Additional details can be added here

        return info;
      })
      .join('\n');
  }

  let systemPrompt = `You are an expert advisor specializing in ${activityName}. Provide detailed recommendations based on the current conditions at specific locations for the date ${selectedDate} and time ${
    selectedTime || 'any time'
  }. Use ${units} units in your responses.

Use the data provided to make specific recommendations.

Please follow these guidelines:

- Do not use asterisks, hashtags, or markdown formatting. Present the information in plain text.
- When discussing visibility, use phrases like "Visibility is likely good" or "Visibility may be reduced."
- Make the recommendations section feel conversational and organic.
- Incorporate additional details about the location if provided.
- Avoid mentioning coding logic or internal thresholds.
- For time-related advice, suggest specific times without mentioning coding logic (e.g., "be on the links by 5 PM to avoid playing in the dark").
- For golfing and hiking, add a clothing recommendation based on the weather.

For ${activityName}, consider the following when making recommendations:

- Use the "Appropriate Thermal Protection" provided in the data.
- Suggest dive/no dive recommendations based on wave conditions.
- Advise on visibility based on wind speed.
- Consider wind speed and direction when making recommendations.
- Use local times for sunrise, sunset, moonrise, and moonset.
- For scuba diving, recommend night dives when conditions are favorable.
- For golfing and hiking, suggest appropriate clothing based on temperature and conditions.
`;

  let userPrompt = `Based on the selected date "${selectedDate}" and time "${
    selectedTime || 'any time'
  }", and the current conditions at the following locations, please provide your recommendations:

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
    console.error(
      'Error from OpenAI API:',
      error.response ? error.response.data : error.message
    );
    throw new Error('Failed to get response from AI assistant.');
  }
}

// Helper function to convert wind degrees to compass direction
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return 'Unknown';
  const directions = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
    'N',
  ];
  const index = Math.round(degrees / 22.5);
  return directions[index];
}

// Remember to close the database when the server shuts down
process.on('SIGINT', () => {
  db.close();
  process.exit();
});
