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

// Initialize cache with a TTL (Time To Live) of 6 hours
const cache = new NodeCache({ stdTTL: 21600 });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// OpenAI API configuration
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Initialize locationsData
let locationsData = [];

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

        // Ensure that diveSiteDescription is set for each location (if exists)
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
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`
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

// Endpoint to geocode address
app.get('/api/geocode', async (req, res) => {
  const address = req.query.address;
  console.log('Geocoding address:', address);
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
    res.status(500).json({
      error: 'Failed to geocode the address. Please try again later.',
    });
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
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Function to fetch per-location weather data with caching
async function getLocationWeatherData(
  latitude,
  longitude,
  selectedDate,
  selectedTime
) {
  const cacheKey = `weather_${latitude}_${longitude}_${selectedDate}_${selectedTime}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      // Convert selectedDate and selectedTime to Date object
      const selectedDateTime = selectedTime
        ? new Date(`${selectedDate}T${selectedTime}:00`)
        : new Date(`${selectedDate}T12:00:00`);

      const currentTime = new Date();
      const isPastDate = selectedDateTime < currentTime;

      if (isPastDate) {
        // Use Timemachine API
        const timestamp = Math.floor(selectedDateTime.getTime() / 1000);

        const weatherUrl =
          'https://api.openweathermap.org/data/3.0/onecall/timemachine';
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
      } else {
        // Use One Call API
        const weatherUrl = 'https://api.openweathermap.org/data/3.0/onecall';
        const response = await axios.get(weatherUrl, {
          params: {
            lat: latitude,
            lon: longitude,
            units: 'metric',
            exclude: 'minutely,alerts',
            appid: process.env.OPENWEATHERMAP_API_KEY,
          },
        });
        data = response.data;
      }

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
      console.error(
        'Error fetching wave data:',
        error.response ? error.response.data : error.message
      );
      throw new Error('Failed to fetch wave data.');
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
async function getActivityLocations(
  activity,
  latitude,
  longitude,
  maxDistance,
  maxLocations = 10
) {
  const cacheKey = `locations_${activity}`;
  let data = cache.get(cacheKey);

  if (data) {
    data = data;
  } else {
    try {
      // Read from locationsData
      const locations = locationsData.filter((loc) =>
        loc.activities.includes(activity)
      );
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
  const filteredLocations = locationsWithDistance.filter(
    (loc) => loc.distance <= maxDistance
  );

  // Sort locations by distance
  filteredLocations.sort((a, b) => a.distance - b.distance);

  // Limit to maxLocations
  return filteredLocations.slice(0, maxLocations);
}

// Function to process recommendations
async function processRecommendations(
  locations,
  activity,
  units,
  selectedDate,
  selectedTime,
  userLatitude,
  userLongitude
) {
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
      locationWeatherData = await getLocationWeatherData(
        locLat,
        locLng,
        selectedDate,
        selectedTime
      );
    } catch (error) {
      console.error(
        `Skipping location ${location.name} due to weather data error.`
      );
      continue;
    }

    // Extract weather information
    let currentWeather;
    let dailyData;
    let hourlyData;

    const selectedDateObj = new Date(selectedDate);
    const selectedDateTime = selectedTime
      ? new Date(`${selectedDate}T${selectedTime}:00`)
      : new Date(`${selectedDate}T12:00:00`);

    if (locationWeatherData.current) {
      // Data from One Call API
      currentWeather = locationWeatherData.current;
      dailyData = locationWeatherData.daily.find((daily) => {
        const date = new Date(daily.dt * 1000);
        return date.getDate() === selectedDateObj.getDate();
      });
      hourlyData = locationWeatherData.hourly;
    } else if (locationWeatherData.data) {
      // Data from Timemachine API
      currentWeather = locationWeatherData.data[0];
      dailyData = null;
      hourlyData = locationWeatherData.data;
    } else {
      console.error('Unexpected weather data format');
      continue;
    }

    location.weather = {
      temperature: currentWeather.temp,
      windSpeed: currentWeather.wind_speed,
      windDeg: currentWeather.wind_deg,
      clouds: currentWeather.clouds,
      pop: currentWeather.pop || 0,
      uvi: currentWeather.uvi,
      description: currentWeather.weather[0].description,
    };

    // Astronomy data
    if (dailyData) {
      location.astronomy = {
        sunrise: new Date(dailyData.sunrise * 1000).toISOString(),
        sunset: new Date(dailyData.sunset * 1000).toISOString(),
        moonrise: new Date(dailyData.moonrise * 1000).toISOString(),
        moonset: new Date(dailyData.moonset * 1000).toISOString(),
        moonPhase: getMoonPhaseDescription(dailyData.moon_phase),
      };
    } else {
      location.astronomy = null;
    }

    // Parse astronomy times
    const sunsetTime = location.astronomy
      ? new Date(location.astronomy.sunset)
      : null;
    const moonriseTime = location.astronomy
      ? new Date(location.astronomy.moonrise)
      : null;
    const moonsetTime = location.astronomy
      ? new Date(location.astronomy.moonset)
      : null;

    if (activity === 'scuba_diving') {
      // Fetch wave data
      const waveStart = selectedTimestamp;
      const waveEnd = waveStart + 6 * 3600; // 6 hours ahead

      let waveData;
      try {
        waveData = await getWaveData(locLat, locLng, waveStart, waveEnd);
      } catch (error) {
        console.error(
          `Skipping location ${location.name} due to wave data error.`
        );
        continue;
      }

      const waveHours = waveData && waveData.hours;

      if (waveHours && waveHours.length > 0) {
        // Find the data point closest to selected date and time
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
        location.thermalProtectionRecommendation =
          getThermalProtectionRecommendation(waterTemperatureF);
      }

      // Fetch tide data
      let tideData;
      try {
        tideData = await getTideData(locLat, locLng, selectedDate, selectedTime);
      } catch (error) {
        console.error(
          `Error fetching tide data for location ${location.name}:`,
          error
        );
        tideData = null;
      }
      location.tideData = tideData;

      // Include tide data
      if (
        location.tideData &&
        location.tideData.extremes &&
        location.tideData.extremes.length > 0
      ) {
        const nowTimestamp = selectedTimestamp;
        const upcomingHighTides = location.tideData.extremes.filter(
          (extreme) => extreme.type === 'High' && extreme.timestamp >= nowTimestamp
        );
        if (upcomingHighTides.length > 0) {
          const nextHighTide = upcomingHighTides[0];
          location.nextHighTide = new Date(
            nextHighTide.timestamp * 1000
          ).toISOString();

          location.nextHighTideIsAtNight =
            sunsetTime && new Date(nextHighTide.timestamp * 1000) >= sunsetTime
              ? true
              : false;
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

      // Incorporate wind speed into scoring
      if (location.weather.windSpeed > 20) {
        score -= 15; // Not a good site for the day
      } else if (location.weather.windSpeed > 15) {
        score -= 10; // Raise concerns over visibility
      }

      // Adjust score based on visibility concerns
      location.poorVisibility = location.weather.windSpeed > 15 ? true : false;

      if (location.poorVisibility) {
        score -= 5;
      } else {
        score += 5;
      }

      // Check for night dive conditions
      if (
        location.astronomy &&
        location.astronomy.moonPhase.toLowerCase() === 'full moon' &&
        moonriseTime <= sunsetTime &&
        moonsetTime >=
          new Date(sunsetTime.getTime() + 3 * 60 * 60 * 1000)
      ) {
        location.isGoodForNightDive = true;
        score += 10; // Boost score for good night dive conditions
      } else {
        location.isGoodForNightDive = false;
      }

      // Attach score to location
      location.score = score;
      scoredLocations.push(location);
    } else if (activity === 'golf' || activity === 'hiking') {
      // Do not recommend starting activity within 3 hours of sunset
      if (sunsetTime) {
        const timeDifference = sunsetTime - selectedDateTime; // in milliseconds
        if (timeDifference <= 3 * 60 * 60 * 1000 && timeDifference >= 0) {
          console.log(
            `Skipping location ${location.name} due to proximity to sunset (${timeDifference} ms).`
          );
          continue;
        }
      }

      // Check if temperature is below freezing
      const temperatureC = location.weather.temperature;
      if (temperatureC < 0) {
        location.frostWarning = true;

        // Find the time when temperature will be above freezing
        let tempAboveFreezingTime = null;

        if (hourlyData) {
          for (const hourData of hourlyData) {
            if (hourData.temp > 0) {
              tempAboveFreezingTime = new Date(
                hourData.dt * 1000
              ).toISOString();
              break;
            }
          }
        }

        location.tempAboveFreezingTime = tempAboveFreezingTime;
      } else {
        location.frostWarning = false;
      }

      // Scoring logic for golfing/hiking (simplified)
      score += temperatureC > 5 ? 10 : 5; // Prefer warmer temperatures
      score += location.weather.windSpeed < 5 ? 5 : 0; // Prefer low wind
      score -= location.weather.pop > 0.5 ? 5 : 0; // Reduce score if high chance of precipitation

      location.score = score;
      scoredLocations.push(location);
    } else {
      // Scoring logic for other activities
      // Implement as needed
      location.score = score;
      scoredLocations.push(location);
    }
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

        const waveData = loc.waveData || {};
        const waterTemp = loc.waterTemperature;

        if (waveData.waveHeight !== undefined) {
          info += `Water Temperature: ${waterTemp} ${unitsTemp}\n`;
          info += `Wind: ${
            units === 'imperial'
              ? (weather.windSpeed * 2.23694).toFixed(2)
              : weather.windSpeed.toFixed(2)
          } ${unitsSpeed} from ${windDirection}\n`;
          info += `Wave Height: ${waveData.waveHeight} ${unitsHeight}, Period: ${waveData.wavePeriod} s\n`;
          info += `Appropriate Thermal Protection: ${loc.thermalProtectionRecommendation}\n`;
        }

        // Visibility
        const visibility = loc.poorVisibility ? 'Possibly Reduced' : 'Likely Good';
        info += `Visibility: ${visibility}\n`;

        if (loc.nextHighTide) {
          info += `Next High Tide: ${formatTime(
            loc.nextHighTide,
            loc.geometry.location
          )}\n`;
        }

        // Astronomy data
        if (loc.astronomy) {
          info += `Sunset: ${formatTime(
            loc.astronomy.sunset,
            loc.geometry.location
          )}\n`;
          info += `Moon Phase: ${loc.astronomy.moonPhase} (Moonrise: ${formatTime(
            loc.astronomy.moonrise,
            loc.geometry.location
          )}, Moonset: ${formatTime(
            loc.astronomy.moonset,
            loc.geometry.location
          )})\n`;
        }

        // Additional details from JSON file (e.g., dive site description)
        if (loc.diveSiteDescription) {
          info += `About the site: ${loc.diveSiteDescription}\n`;
        }

        // Prepare data for recommendations
        loc.formattedInfo = info;
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

        if (loc.astronomy) {
          info += `Sunset: ${formatTime(
            loc.astronomy.sunset,
            loc.geometry.location
          )}\n`;
        }

        if (loc.frostWarning) {
          info += `Frost Warning: Yes\n`;
          if (loc.tempAboveFreezingTime) {
            info += `Temperature will be above freezing at: ${formatTime(
              loc.tempAboveFreezingTime,
              loc.geometry.location
            )}\n`;
          } else {
            info += `Temperature is expected to remain below freezing all day.\n`;
          }
        }

        // Clothing recommendation
        const clothingRecommendation = getClothingRecommendation(
          weather.temperature,
          units
        );
        info += `Clothing Recommendation: ${clothingRecommendation}\n`;

        loc.formattedInfo = info;
        return loc;
      })
      .map((loc) => loc.formattedInfo)
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

        if (loc.astronomy) {
          info += `Sunset: ${formatTime(
            loc.astronomy.sunset,
            loc.geometry.location
          )}\n`;
        }

        loc.formattedInfo = info;
        return loc;
      })
      .map((loc) => loc.formattedInfo)
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

// Helper function to format times to local time zone
function formatTime(timeString, location) {
  const date = new Date(timeString);
  const options = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: getTimeZone(location.lat, location.lng),
  };
  return date.toLocaleTimeString([], options);
}

// Placeholder function to get time zone from latitude and longitude
function getTimeZone(lat, lng) {
  // For simplicity, return 'America/New_York' for this example
  // In production, use a proper geocoding API or library to get the time zone
  return 'America/New_York';
}

// Helper function to get clothing recommendation
function getClothingRecommendation(temperatureC, units) {
  let tempF = (temperatureC * 9) / 5 + 32;
  let temp = units === 'imperial' ? tempF : temperatureC;
  if (temp <= 0) {
    return 'Heavy jacket, gloves, and warm layers';
  } else if (temp > 0 && temp <= 10) {
    return 'Medium jacket and warm clothing';
  } else if (temp > 10 && temp <= 20) {
    return 'Light jacket or sweater';
  } else if (temp > 20 && temp <= 30) {
    return 'Long-sleeved shirt and pants';
  } else {
    return 'Shorts and a t-shirt';
  }
}

// Helper function to get moon phase description
function getMoonPhaseDescription(moonPhase) {
  if (moonPhase === 0 || moonPhase === 1) {
    return 'New Moon';
  } else if (moonPhase > 0 && moonPhase < 0.25) {
    return 'Waxing Crescent';
  } else if (moonPhase === 0.25) {
    return 'First Quarter';
  } else if (moonPhase > 0.25 && moonPhase < 0.5) {
    return 'Waxing Gibbous';
  } else if (moonPhase === 0.5) {
    return 'Full Moon';
  } else if (moonPhase > 0.5 && moonPhase < 0.75) {
    return 'Waning Gibbous';
  } else if (moonPhase === 0.75) {
    return 'Last Quarter';
  } else if (moonPhase > 0.75 && moonPhase < 1) {
    return 'Waning Crescent';
  } else {
    return 'Unknown';
  }
}
