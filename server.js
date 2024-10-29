// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const nlp = require('compromise');
const NodeCache = require('node-cache');
const { Configuration, OpenAIApi } = require('openai');

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

// Endpoint to handle user queries
app.post('/api/query', async (req, res) => {
  const userQuery = req.body.query;
  const activity = extractActivity(userQuery);

  try {
    const latitude = req.body.latitude;
    const longitude = req.body.longitude;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Invalid or missing location data.' });
    }

    // Fetch weather data
    const weatherData = await getWeatherData(latitude, longitude);

    // Fetch activity locations
    const activityLocations = await getActivityLocations(activity, latitude, longitude);

    // Process data and generate recommendations
    const recommendations = processRecommendations(activityLocations, weatherData, activity);

    // Use OpenAI API to format the response
    const aiResponse = await getAIResponse(userQuery, recommendations);

    res.json({ response: aiResponse, recommendations });
  } catch (error) {
    console.error('Error during /api/query:', error);
    res.status(500).json({ error: 'An error occurred while processing your request. Please try again later.' });
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

  // Look for specific keywords
  if (doc.has('scuba [diving]')) {
    return 'scuba_diving';
  } else if (doc.has('golf')) {
    return 'golf';
  } else if (doc.has('surfing')) {
    return 'surfing';
  } else if (doc.has('hiking')) {
    return 'hiking';
  } else {
    return 'general';
  }
}

// Function to fetch weather data with caching
async function getWeatherData(latitude, longitude) {
  const cacheKey = `weather_${latitude}_${longitude}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      const weatherUrl = 'https://api.openweathermap.org/data/2.5/onecall';
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
      console.error('Error fetching weather data:', error);
      throw new Error('Failed to fetch weather data.');
    }
  }
}

// Function to fetch activity locations with caching
async function getActivityLocations(activity, latitude, longitude) {
  const cacheKey = `locations_${activity}_${latitude}_${longitude}`;
  let data = cache.get(cacheKey);

  if (data) {
    return data;
  } else {
    try {
      const placesUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
      let type;
      if (activity === 'scuba_diving') {
        type = 'scuba_diving';
      } else if (activity === 'golf') {
        type = 'golf_course';
      } else if (activity === 'surfing') {
        type = 'natural_feature';
      } else if (activity === 'hiking') {
        type = 'park';
      } else {
        type = 'tourist_attraction';
      }

      const response = await axios.get(placesUrl, {
        params: {
          location: `${latitude},${longitude}`,
          radius: 50000, // 50 km
          type: type,
          key: process.env.GOOGLE_PLACES_API_KEY,
        },
      });
      data = response.data.results;
      cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching activity locations:', error);
      throw new Error('Failed to fetch activity locations.');
    }
  }
}

// Function to process recommendations
function processRecommendations(locations, weatherData, activity) {
  const dailyWeather = weatherData.daily[0]; // Using today's weather

  // Iterate over locations and score them
  const scoredLocations = locations.map((location) => {
    let score = 0;

    if (activity === 'scuba_diving') {
      // Wind speed (less wind is better)
      if (dailyWeather.wind_speed < 5) score += 10;
      else if (dailyWeather.wind_speed < 10) score += 5;

      // Cloudiness (less clouds is better)
      if (dailyWeather.clouds < 25) score += 5;

      // UV index (moderate UV index is preferable)
      if (dailyWeather.uvi >= 3 && dailyWeather.uvi <= 7) score += 5;
    } else if (activity === 'golf') {
      // No rain
      if (dailyWeather.pop === 0) score += 10;

      // Comfortable temperatures
      if (dailyWeather.temp.day >= 15 && dailyWeather.temp.day <= 25) score += 10;

      // Low wind
      if (dailyWeather.wind_speed < 5) score += 5;
    } else {
      // General activity preferences
      if (dailyWeather.pop < 0.2) score += 5;
      if (dailyWeather.temp.day >= 10 && dailyWeather.temp.day <= 30) score += 5;
    }

    // Attach score to location
    return { ...location, score };
  });

  // Sort locations by score in descending order
  scoredLocations.sort((a, b) => b.score - a.score);

  // Return top 5 recommendations
  return scoredLocations.slice(0, 5);
}

// Function to get AI response from OpenAI API
async function getAIResponse(userQuery, recommendations) {
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant providing activity recommendations based on weather and location.',
    },
    {
      role: 'user',
      content: `Based on my query "${userQuery}", please provide recommendations for the following locations:

${recommendations.map((loc) => loc.name).join('\n')}
`,
    },
  ];

  try {
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 150,
      temperature: 0.7,
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error from OpenAI API:', error);
    throw new Error('Failed to get response from AI assistant.');
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
