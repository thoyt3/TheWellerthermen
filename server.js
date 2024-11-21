// server.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const tzLookup = require('tz-lookup'); // Time zone lookup based on lat/lon
const { DateTime } = require('luxon'); // Date and time handling with time zones

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
      date TEXT,
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

// Endpoint to get locations for a specific activity
app.get('/api/locations', async (req, res) => {
  const activity = req.query.activity;

  if (!activity) {
    return res.status(400).json({ error: 'Activity parameter is required.' });
  }

  // Filter locations based on activity
  const activityLocations = locationsData.filter((loc) =>
    loc.activities.includes(activity)
  );

  res.json(activityLocations);
});

// Endpoint to handle user queries
app.post('/api/query', async (req, res) => {
  const selectedDate = req.body.date; // Get the selected date
  const selectedTime = req.body.time; // Get the selected time (optional)
  const selectedActivity = req.body.activity;
  const minDistanceInput = req.body.minDistance;
  const maxDistanceInput = req.body.maxDistance;
  const selectedUnits = req.body.units || 'imperial';
  const activity = selectedActivity;
  const specificLocation = req.body.specificLocation; // For single search

  console.log('Activity:', activity); // Debugging
  console.log('Selected Date:', selectedDate);
  console.log('Selected Time:', selectedTime);
  console.log('Min Distance:', minDistanceInput);
  console.log('Max Distance:', maxDistanceInput);
  console.log('Selected Units:', selectedUnits);
  console.log('Specific Location:', specificLocation);

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

      let message = 'This app does not currently support surfing.';
      if (isInNewEngland) {
        message = 'Surfing in New England? You might need a thicker wetsuit!';
      } else {
        message = 'Why would you think there is surfing here?';
      }

      return res.json({ response: message, recommendations: [] });
    }

    // Parse min and max distances
    let minDistance = parseFloat(minDistanceInput) || 0;
    let maxDistance = parseFloat(maxDistanceInput) || 5;

    // Validate distances
    if (minDistance < 0) minDistance = 0;
    if (selectedUnits === 'imperial' && maxDistance > 100) maxDistance = 100;
    if (selectedUnits === 'metric' && maxDistance > 160) maxDistance = 160;

    console.log('Validated Min Distance:', minDistance);
    console.log('Validated Max Distance:', maxDistance);

    // Convert distances to miles if units are metric
    if (selectedUnits === 'metric') {
      minDistance = minDistance / 1.60934; // Convert km to miles
      maxDistance = maxDistance / 1.60934;
    }

    // Fetch activity locations
    let activityLocations;
    if (specificLocation) {
      // Single search mode
      const specificLocationId = parseInt(specificLocation, 10);

      if (isNaN(specificLocationId)) {
        return res.json({
          response: `Invalid location selected.`,
          recommendations: [],
        });
      }

      activityLocations = locationsData.filter(
        (loc) => loc.id === specificLocationId
      );

      if (activityLocations.length === 0) {
        return res.json({
          response: `The selected location was not found.`,
          recommendations: [],
        });
      }
    } else {
      activityLocations = await getActivityLocations(
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

    // Check if recommendations are empty due to weather conditions
    if (
      (Array.isArray(recommendations) && recommendations.length === 0) ||
      recommendations.noSuitableLocations
    ) {
      const message =
        recommendations.noSuitableLocations
          ? 'No suitable locations found based on the current conditions.'
          : 'Based on the weather, there are no recommended locations in this area.';
      return res.json({
        response: message,
        recommendations: [],
      });
    }

    // Use OpenAI API to format the response
    const aiResponse = await getAIResponse(
      selectedDate,
      selectedTime,
      recommendations,
      selectedUnits,
      activity,
      latitude,
      longitude
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
  // Convert the activity to lowercase for case-insensitive comparison
  const activityLower = activity.toLowerCase();

  // Filter locations based on activity (case-insensitive)
  const filteredLocations = locationsData.filter((loc) =>
    loc.activities.some((act) => act.toLowerCase() === activityLower)
  );

  // Calculate distances and filter based on min and max distance
  const locationsWithDistance = filteredLocations
    .map((loc) => {
      const locLat = loc.latitude || loc.geometry.location.lat;
      const locLng = loc.longitude || loc.geometry.location.lng;
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
  if (activity === 'pickleball') {
    // For pickleball, return the top 3 indoor locations and outdoor conditions
    const indoorLocations = activityLocations.filter(
      (loc) => loc.indoor === true
    );

    // If specific location is selected, use that
    if (activityLocations.length === 1) {
      indoorLocations.length = 0;
      if (activityLocations[0].indoor === true) {
        indoorLocations.push(activityLocations[0]);
      }
    }

    indoorLocations.sort((a, b) => a.distance - b.distance);
    const topIndoorLocations = indoorLocations.slice(0, 3);

    // Fetch outdoor weather data
    let weatherData;
    try {
      weatherData = await getLocationWeatherData(userLat, userLng, selectedDate);
    } catch (error) {
      console.error('Error fetching weather data for pickleball:', error);
    }

    // Check for rain
    let isRaining = false;
    if (weatherData) {
      const selectedDateObj = DateTime.fromISO(selectedDate, { zone: 'utc' });
      const selectedDateTimestamp = selectedDateObj.toSeconds();

      const dailyData = weatherData.daily.find((day) => {
        const dayDateObj = DateTime.fromSeconds(day.dt, { zone: 'utc' }).startOf('day');
        const dayDateTimestamp = dayDateObj.toSeconds();
        return dayDateTimestamp === selectedDateTimestamp;
      });

      if (dailyData) {
        const weatherId = dailyData.weather[0].id;
        if (weatherId >= 200 && weatherId < 600) {
          isRaining = true;
        }
      }
    }

    let noIndoorLocations = false;
    if (topIndoorLocations.length === 0) {
      noIndoorLocations = true;
    }

    return {
      indoorLocations: topIndoorLocations,
      weatherData,
      isRaining,
      noIndoorLocations,
      noSuitableLocations: false,
    };
  } else if (activity === 'scuba_diving') {
    const shoreDives = [];
    const boatDives = [];
    let noSuitableLocations = true;

    for (const location of activityLocations) {
      let score = 0;

      const locLat = location.latitude || location.geometry.location.lat;
      const locLng = location.longitude || location.geometry.location.lng;

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

      // Extract daily data for selected date
      const selectedDateObj = DateTime.fromISO(selectedDate, { zone: 'utc' });
      const selectedDateTimestamp = selectedDateObj.startOf('day').toSeconds();

      const dailyData = weatherData.daily.find((day) => {
        const dayDateObj = DateTime.fromSeconds(day.dt, { zone: 'utc' }).startOf('day');
        const dayDateTimestamp = dayDateObj.toSeconds();
        return dayDateTimestamp === selectedDateTimestamp;
      });

      if (!dailyData) {
        console.error(
          `No daily data for selected date at location ${location.name}`
        );
        continue;
      }

      // Process weather data and calculate scores
      const temperature = dailyData.temp.day; // In Celsius
      const windSpeedMs = dailyData.wind_speed; // In m/s
      const windSpeedMph = windSpeedMs * 2.23694; // Convert to mph
      const weatherDescription = dailyData.weather[0].description;
      const windDeg = dailyData.wind_deg;
      const sunrise = dailyData.sunrise; // Unix time
      const sunset = dailyData.sunset; // Unix time
      const moonrise = dailyData.moonrise; // Unix time
      const moonset = dailyData.moonset; // Unix time
      const moonPhase = dailyData.moon_phase; // 0 to 1

      // Skip locations with wind speed above 25 mph
      if (windSpeedMph > 25) {
        continue;
      }

      // Fetch wave data with caching
      let waveData = null;
      try {
        waveData = await getWaveData(locLat, locLng, selectedDate);
      } catch (error) {
        console.error(
          `Skipping location ${location.name} due to wave data error.`
        );
        continue;
      }

      // Process wave data
      let averageWaveHeight = null;
      let averageWaterTemperature = null;
      if (waveData && waveData.hours) {
        const hours = waveData.hours;
        let totalWaveHeight = 0;
        let totalWaterTemp = 0;
        let count = 0;

        for (const hourData of hours) {
          const waveHeight = hourData.waveHeight && hourData.waveHeight.noaa;
          const waterTemp =
            hourData.waterTemperature && hourData.waterTemperature.noaa;

          if (waveHeight !== undefined && waterTemp !== undefined) {
            totalWaveHeight += waveHeight;
            totalWaterTemp += waterTemp;
            count++;
          }
        }

        if (count > 0) {
          averageWaveHeight = totalWaveHeight / count;
          averageWaterTemperature = totalWaterTemp / count;
        }
      }

      // Skip locations with wave height over 5 feet
      const waveHeightFt = averageWaveHeight * 3.28084; // Convert meters to feet
      if (waveHeightFt > 5) {
        continue;
      }

      // Fetch tide data with caching
      let tideData = null;
      try {
        tideData = await getTideData(locLat, locLng, selectedDate);
      } catch (error) {
        console.error(
          `Skipping location ${location.name} due to tide data error.`
        );
        // Proceed without tide data
      }

      // If we reach here, we have at least one suitable location
      noSuitableLocations = false;

      // Scoring based on wave height (lower is better)
      if (waveHeightFt <= 2) {
        score += 3;
      } else if (waveHeightFt <= 3) {
        score += 2;
      } else if (waveHeightFt <= 4) {
        score += 1;
      }

      // Scoring based on wind speed (lower is better)
      if (windSpeedMph <= 10) {
        score += 3;
      } else if (windSpeedMph <= 15) {
        score += 2;
      } else if (windSpeedMph <= 25) {
        score += 1;
      }

      // Determine the time zone of the location
      let timeZone = 'UTC';
      try {
        timeZone = tzLookup(locLat, locLng);
      } catch (error) {
        console.error(
          `Error determining time zone for location ${location.name}:`,
          error
        );
      }

      // Assign additional properties to location
      location.score = score;
      location.weather = {
        temperature,
        windSpeed: windSpeedMs,
        windDeg,
        description: weatherDescription,
        sunrise,
        sunset,
        moonrise,
        moonset,
        moonPhase,
        timeZone,
      };
      location.averageWaveHeight = averageWaveHeight;
      location.averageWaterTemperature = averageWaterTemperature;
      location.tideData = tideData; // Include tide data

      // Add location to the appropriate section based on diveType
      if (location.diveType === 'shore') {
        shoreDives.push(location);
      } else if (location.diveType === 'boat') {
        boatDives.push(location);
      }
    }

    let noShoreDives = shoreDives.length === 0;
    let noBoatDives = boatDives.length === 0;

    if (noShoreDives && noBoatDives) {
      return { recommendations: [], noSuitableLocations: true };
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

    return {
      recommendations,
      noShoreDives,
      noBoatDives,
      noSuitableLocations: false,
    };
  } else {
    // Existing logic for other activities
    const scoredLocations = [];
    let noSuitableLocations = true;

    for (const location of activityLocations) {
      let score = 0;

      const locLat = location.latitude || location.geometry.location.lat;
      const locLng = location.longitude || location.geometry.location.lng;

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

      // Extract daily data for selected date
      const selectedDateObj = DateTime.fromISO(selectedDate, { zone: 'utc' });
      const selectedDateTimestamp = selectedDateObj.startOf('day').toSeconds();

      const dailyData = weatherData.daily.find((day) => {
        const dayDateObj = DateTime.fromSeconds(day.dt, { zone: 'utc' }).startOf('day');
        const dayDateTimestamp = dayDateObj.toSeconds();
        return dayDateTimestamp === selectedDateTimestamp;
      });

      if (!dailyData) {
        console.error(
          `No daily data for selected date at location ${location.name}`
        );
        continue;
      }

      // Process weather data and calculate scores
      const temperature = dailyData.temp.day; // In Celsius
      const windSpeedMs = dailyData.wind_speed; // In m/s
      const windSpeedMph = windSpeedMs * 2.23694; // Convert to mph
      const weatherDescription = dailyData.weather[0].description;
      const windDeg = dailyData.wind_deg;
      const sunrise = dailyData.sunrise; // Unix time
      const sunset = dailyData.sunset; // Unix time
      const moonrise = dailyData.moonrise; // Unix time
      const moonset = dailyData.moonset; // Unix time
      const moonPhase = dailyData.moon_phase; // 0 to 1

      // Skip locations with wind speed above 25 mph
      if (windSpeedMph > 25) {
        continue;
      }

      // If we reach here, we have at least one suitable location
      noSuitableLocations = false;

      // Scoring based on wind speed (lower is better)
      if (windSpeedMph <= 10) {
        score += 3;
      } else if (windSpeedMph <= 15) {
        score += 2;
      } else if (windSpeedMph <= 25) {
        score += 1;
      }

      // Determine the time zone of the location
      let timeZone = 'UTC';
      try {
        timeZone = tzLookup(locLat, locLng);
      } catch (error) {
        console.error(
          `Error determining time zone for location ${location.name}:`,
          error
        );
      }

      // Assign additional properties to location
      location.score = score;
      location.weather = {
        temperature,
        windSpeed: windSpeedMs,
        windDeg,
        description: weatherDescription,
        sunrise,
        sunset,
        moonrise,
        moonset,
        moonPhase,
        timeZone,
      };
      location.latitude = locLat;
      location.longitude = locLng;

      scoredLocations.push(location);
    }

    if (noSuitableLocations) {
      return { recommendations: [], noSuitableLocations: true };
    }

    // Sort locations by score
    scoredLocations.sort((a, b) => b.score - a.score);

    // If specific location is selected, return it even if it's the only one
    if (activityLocations.length === 1) {
      return { recommendations: scoredLocations, noSuitableLocations: false };
    }

    // Return top recommendations
    return { recommendations: scoredLocations.slice(0, 3), noSuitableLocations: false };
  }
}

// Function to fetch per-location weather data with caching
async function getLocationWeatherData(latitude, longitude, selectedDate) {
  return new Promise((resolve, reject) => {
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

// Function to fetch wave data with caching
async function getWaveData(latitude, longitude, date) {
  return new Promise((resolve, reject) => {
    const dateObj = new Date(date);
    const start = dateObj.toISOString();
    dateObj.setDate(dateObj.getDate() + 1);
    const end = dateObj.toISOString();

    // Check cache first
    db.get(
      `SELECT data FROM wave_cache WHERE latitude = ? AND longitude = ? AND date = ?`,
      [latitude, longitude, date],
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
            const response = await axios.get(
              'https://api.stormglass.io/v2/weather/point',
              {
                params: {
                  lat: latitude,
                  lng: longitude,
                  params: 'waveHeight,waterTemperature',
                  start: start,
                  end: end,
                },
                headers: {
                  Authorization: process.env.STORMGLASS_API_KEY,
                },
              }
            );

            const data = response.data;

            // Store in cache
            db.run(
              `INSERT INTO wave_cache (latitude, longitude, date, data, timestamp) VALUES (?, ?, ?, ?, ?)`,
              [
                latitude,
                longitude,
                date,
                JSON.stringify(data),
                Math.floor(Date.now() / 1000),
              ],
              (err) => {
                if (err) {
                  console.error('Error inserting into wave_cache:', err);
                }
              }
            );

            resolve(data);
          } catch (error) {
            console.error('Error fetching wave data:', error);
            reject(error);
          }
        }
      }
    );
  });
}

// Function to fetch tide data with caching
async function getTideData(latitude, longitude, date) {
  return new Promise((resolve, reject) => {
    const dateObj = new Date(date);
    const start = dateObj.toISOString();
    dateObj.setDate(dateObj.getDate() + 1);
    const end = dateObj.toISOString();

    // Check cache first
    db.get(
      `SELECT data FROM tide_cache WHERE latitude = ? AND longitude = ? AND date = ?`,
      [latitude, longitude, date],
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
            const response = await axios.get(
              'https://api.stormglass.io/v2/tide/extremes/point',
              {
                params: {
                  lat: latitude,
                  lng: longitude,
                  start: start,
                  end: end,
                },
                headers: {
                  Authorization: process.env.STORMGLASS_API_KEY,
                },
              }
            );

            const data = response.data;

            // Store in cache
            db.run(
              `INSERT INTO tide_cache (latitude, longitude, date, data, timestamp) VALUES (?, ?, ?, ?, ?)`,
              [
                latitude,
                longitude,
                date,
                JSON.stringify(data),
                Math.floor(Date.now() / 1000),
              ],
              (err) => {
                if (err) {
                  console.error('Error inserting into tide_cache:', err);
                }
              }
            );

            resolve(data);
          } catch (error) {
            console.error('Error fetching tide data:', error);
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
  activity,
  latitude,
  longitude
) {
  const activityName = activity.replace('_', ' ');
  let locationInfo = '';

  const unitsTemp = units === 'imperial' ? '°F' : '°C';
  const unitsSpeed = units === 'imperial' ? 'mph' : 'm/s';
  const unitsHeight = units === 'imperial' ? 'ft' : 'm';

  let boilerplate = 'This recommendation is for entertainment purposes only. Please verify details before planning your activities.';

  if (activity === 'scuba_diving') {
    boilerplate += ' Always dive with a buddy and within the limits of your training.';
  }

  if (activity === 'pickleball') {
    // Fetch outdoor weather data for user's location
    const weatherData = recommendations.weatherData;
    const isRaining = recommendations.isRaining;

    if (weatherData) {
      // Extract daily data for selected date
      const selectedDateObj = DateTime.fromISO(selectedDate, { zone: 'utc' });
      const selectedDateTimestamp = selectedDateObj.toSeconds();

      const dailyData = weatherData.daily.find((day) => {
        const dayDateObj = DateTime.fromSeconds(day.dt, { zone: 'utc' }).startOf('day');
        const dayDateTimestamp = dayDateObj.toSeconds();
        return dayDateTimestamp === selectedDateTimestamp;
      });

      if (dailyData) {
        const temperature = dailyData.temp.day; // In Celsius
        const weatherDescription = dailyData.weather[0].description;
        const windSpeed = dailyData.wind_speed; // In m/s
        const windDeg = dailyData.wind_deg;
        const windDirection = getWindDirection(windDeg);

        // Determine the time zone of the user's location
        let timeZone = 'UTC';
        try {
          timeZone = tzLookup(latitude, longitude);
        } catch (error) {
          console.error(
            `Error determining time zone for user's location:`,
            error
          );
        }

        // Sunrise and Sunset
        const sunriseTime = DateTime.fromSeconds(dailyData.sunrise, { zone: timeZone })
          .toFormat('hh:mm a');
        const sunsetTime = DateTime.fromSeconds(dailyData.sunset, { zone: timeZone })
          .toFormat('hh:mm a');

        // Prepare outdoor conditions
        locationInfo += `Outdoor Conditions at your location:\n`;
        locationInfo += `Weather: ${weatherDescription}\n`;
        locationInfo += `Temperature: ${
          units === 'imperial'
            ? ((temperature * 9) / 5 + 32).toFixed(2)
            : temperature.toFixed(2)
        }${unitsTemp}\n`;
        locationInfo += `Wind Speed: ${
          units === 'imperial'
            ? (windSpeed * 2.23694).toFixed(2)
            : windSpeed.toFixed(2)
        } ${unitsSpeed} from ${windDirection}\n`;
        locationInfo += `Sunrise: ${sunriseTime}, Sunset: ${sunsetTime}\n\n`;
      }
    }

    if (isRaining) {
      locationInfo += `It is expected to rain. Outdoor pickleball is not recommended.\n\n`;
    }

    // List top 3 nearby indoor pickleball locations
    const indoorLocations = recommendations.indoorLocations || [];
    if (indoorLocations.length > 0) {
      locationInfo += `Top 3 Nearby Indoor Pickleball Locations:\n`;
      indoorLocations.forEach((loc, index) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const address = loc.address || '';
        const phone = loc.phone || 'Phone number not available';
        locationInfo += `${index + 1}. ${locName} in ${city}, ${state}, Address: ${address}, Phone: ${phone}\n`;
      });
      locationInfo += `\nPlease consider calling ahead to check hours of operation.\n`;
    } else {
      locationInfo += `No indoor pickleball locations found within your selected distance range.\n`;
    }
  } else if (activity === 'scuba_diving') {
    // Display messages if only shore dives or only boat dives are available
    if (recommendations.noShoreDives && !recommendations.noBoatDives) {
      locationInfo += 'Note: No suitable shore dives were found due to weather conditions.\n\n';
    } else if (!recommendations.noShoreDives && recommendations.noBoatDives) {
      locationInfo += 'Note: No suitable boat dives were found due to weather conditions.\n\n';
    }

    recommendations.recommendations.forEach((section) => {
      const sectionTitle = section.type === 'shore' ? 'Shore Dives' : 'Boat Dives';
      locationInfo += `${sectionTitle}:\n`;
      section.dives.forEach((loc) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const weather = loc.weather || {};
        const windDirection = getWindDirection(weather.windDeg);

        // Convert Unix timestamps to local time using luxon
        const timeZone = weather.timeZone || 'UTC';
        const sunriseTime = DateTime.fromSeconds(weather.sunrise, { zone: timeZone })
          .toFormat('hh:mm a');
        const sunsetTime = DateTime.fromSeconds(weather.sunset, { zone: timeZone })
          .toFormat('hh:mm a');

        let info = `${locName} in ${city}, ${state}\n`;
        info += `Weather: ${weather.description}, Air Temperature: ${
          units === 'imperial'
            ? ((weather.temperature * 9) / 5 + 32).toFixed(2)
            : weather.temperature.toFixed(2)
        }${unitsTemp}\n`;

        // Wave data
        if (loc.averageWaveHeight !== null) {
          info += `Average Wave Height: ${
            units === 'imperial'
              ? (loc.averageWaveHeight * 3.28084).toFixed(2)
              : loc.averageWaveHeight.toFixed(2)
          } ${unitsHeight}\n`;
        }

        // Water temperature
        if (loc.averageWaterTemperature !== null) {
          info += `Water Temperature: ${
            units === 'imperial'
              ? ((loc.averageWaterTemperature * 9) / 5 + 32).toFixed(2)
              : loc.averageWaterTemperature.toFixed(2)
          }${unitsTemp}\n`;
        }

        // Wind speed and direction
        info += `Wind Speed: ${
          units === 'imperial'
            ? (weather.windSpeed * 2.23694).toFixed(2)
            : weather.windSpeed.toFixed(2)
        } ${unitsSpeed} from ${windDirection}\n`;

        // Moon phase
        const moonPhase = getMoonPhaseDescription(weather.moonPhase);
        info += `Moon Phase: ${moonPhase}\n`;

        // Sunrise and Sunset
        info += `Sunrise: ${sunriseTime}, Sunset: ${sunsetTime}\n`;

        // Tide data
        if (loc.tideData && loc.tideData.data && loc.tideData.data.length > 0) {
          const tides = loc.tideData.data;
          const tideInfo = tides
            .map((tide) => {
              const tideDateTime = DateTime.fromISO(tide.time, { zone: timeZone });
              const tideTime = tideDateTime.toFormat('MMM dd, hh:mm a');
              const tideType = tide.type === 'high' ? 'High Tide' : 'Low Tide';
              return `${tideType} on ${tideTime}`;
            })
            .join(', ');
          info += `Tides: ${tideInfo}\n`;
        }

        // Visibility
        const visibility =
          weather.windSpeed > 5 ? 'Possibly Reduced' : 'Likely Good';
        info += `Visibility: ${visibility}\n`;

        // Additional details from JSON file (e.g., dive site description)
        if (loc.diveSiteDescription) {
          info += `About the site: ${loc.diveSiteDescription}\n`;
        }

        // Prepare data for recommendations
        locationInfo += info + '\n';
      });
    });
  } else {
    // For other activities
    locationInfo = recommendations.recommendations
      .map((loc) => {
        const locName = loc.name;
        const city = loc.city || '';
        const state = loc.state || '';
        const address = loc.address || '';
        const phone = loc.phone || '';
        const weather = loc.weather || {};
        const windDirection = getWindDirection(weather.windDeg);

        // Convert Unix timestamps to local time using luxon
        const timeZone = weather.timeZone || 'UTC';
        const sunriseTime = DateTime.fromSeconds(weather.sunrise, { zone: timeZone })
          .toFormat('hh:mm a');
        const sunsetTime = DateTime.fromSeconds(weather.sunset, { zone: timeZone })
          .toFormat('hh:mm a');

        let info = `${locName} in ${city}, ${state}\n`;
        if (address) {
          info += `Address: ${address}\n`;
        }
        if (phone) {
          info += `Phone: ${phone}\n`;
        }
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

        // Sunrise and Sunset
        info += `Sunrise: ${sunriseTime}, Sunset: ${sunsetTime}\n`;

        // Additional details can be added here

        // Prepare data for recommendations
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
- Separate shore and boat dives for scuba diving with a section title for each.
- Make the recommendations section feel conversational and organic.
- Incorporate additional details about the location if provided.
- Avoid mentioning coding logic or internal thresholds.
- For hiking, list the distance, difficulty, elevation gain, and estimated time for each trail.
- For golfing and hiking, add a clothing recommendation based on the weather, and include likelihood of rain and appropriate considerations for that.
- For golfing, if it is after sunset, advise that the course will likely be closed and to check with the course for night play availability.
- For scuba diving, if the time is before sunrise or after sunset, mention the moon phase, and recommend bringing at least two dive lights.
- Only mention ${activityName} in your response and no other activities.
- For pickleball, first discuss the outdoor conditions for playing pickleball at the user's location. Then list the top 3 nearby indoor pickleball locations. Include the address and phone number for each. Remind the individual to potentially call ahead to check hours.
- For all activities, include the following boilerplate: "${boilerplate}"

Scuba Diving Thermal Protection Recommendations
When advising on thermal protection for scuba diving, use the following guidelines based on water temperature. Ensure that the recommended protection is at least the specified level for each temperature range:
	1.	Water Temperature ≥ 26°C (≥ 77°F):
	•	Minimum Protection: Shorty
	2.	Water Temperature > 21°C and < 26°C (70°F - 77°F):
	•	Minimum Protection: 3mm Wetsuit
	3.	Water Temperature > 16°C and ≤ 21°C (60°F - 70°F):
	•	Minimum Protection: 5mm Wetsuit
	4.	Water Temperature > 10°C and ≤ 16°C (50°F - 60°F):
	•	Minimum Protection: 7mm Wetsuit
	5.	Water Temperature ≤ 10°C (≤ 50°F):
	•	Minimum Protection: Drysuit

Important Instructions:
	•	Do not recommend a lower level of thermal protection than the minimum specified for the given temperature range.
	•	If additional protection is necessary based on other factors (e.g., dive duration, individual cold tolerance), you may recommend higher levels of thermal protection, but never lower.
	•	Ensure consistency in recommendations to maintain diver safety.

For ${activityName}, consider the following when making recommendations:

- Provide wave heights, wind speeds, and water temperatures for scuba diving.
- Include moon phase, sunrise, and sunset times where relevant.
- Include high and low tide times (with dates) for scuba diving locations.
- Suggest optimal play times for golfing.
- Recommend starting times for hiking based on daylight hours.
- Suggest optimal times for scuba diving based on tides.
- Advise on visibility based on wind speed and other factors for scuba diving.
- Advise how wind speed might impact the golf ball for golfing.
- For scuba diving, do not recommend locations where waves are over 5 feet or wind speed is over 25 mph.
- For golf and pickleball, prioritize locations with wind speeds under 25 mph.

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

// Helper function to get moon phase description
function getMoonPhaseDescription(phase) {
  if (phase === undefined || phase === null) return 'Unknown';
  if (phase === 0 || phase === 1) return 'New Moon';
  if (phase > 0 && phase < 0.25) return 'Waxing Crescent';
  if (phase === 0.25) return 'First Quarter';
  if (phase > 0.25 && phase < 0.5) return 'Waxing Gibbous';
  if (phase === 0.5) return 'Full Moon';
  if (phase > 0.5 && phase < 0.75) return 'Waning Gibbous';
  if (phase === 0.75) return 'Last Quarter';
  if (phase > 0.75 && phase < 1) return 'Waning Crescent';
  return 'Unknown';
}

// Remember to close the database when the server shuts down
process.on('SIGINT', () => {
  db.close();
  process.exit();
});
