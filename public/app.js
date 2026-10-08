// public/app.js
// Everything runs in the browser against free, keyless APIs (Open-Meteo and
// OpenStreetMap Nominatim). There is no server and nothing to configure.

(() => {
  'use strict';

  // Each activity's places live in their own script (data/<activity>.js) and are
  // loaded the first time that activity is used. A script tag works from file:// too.
  const placeLoads = new Map();

  function loadPlaces(activity) {
    if (!placeLoads.has(activity)) {
      placeLoads.set(activity, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `data/${activity}.js?v=${window.WM_VERSION || 'dev'}`;
        script.onload = () => resolve(((window.WM_DATA && window.WM_DATA[activity]) || []).map((p) => ({ ...p, activity })));
        script.onerror = () => {
          placeLoads.delete(activity);
          reject(new Error(`Could not load data/${activity}.js. Run "python build_site_data.py" to create it.`));
        };
        document.head.append(script);
      }));
    }
    return placeLoads.get(activity);
  }

  // hours: length of the outing we look for; pool: how many nearby places to score
  const ACTIVITIES = {
    golf: { label: 'Golf', hours: 4, pool: 20 },
    hiking: { label: 'Hiking', hours: 3, pool: 40 },
    scuba_diving: { label: 'Scuba diving', hours: 2, pool: 30, marine: true },
    surfing: { label: 'Surfing', hours: 2, pool: 20, marine: true },
  };

  const FORECAST_DAYS = 15;
  const SHOWN_AT_FIRST = 5;
  const MAX_SUGGESTIONS = 3000;
  const RAIN_SHOWN_FROM = 15; // percent chance below which an hour shows no rain
  const NIGHT_DIVE_RULE = 'Only for divers with Advanced Open Water or a night diving certification.';
  const NIGHT_ACCESS_RULE = 'Many parks, beaches and parking lots close at dusk. Check with the park, town or harbormaster about night access and hours before you go.';
  const MIN_OPEN_GOLF = 3; // golf recommendations always include this many public or municipal courses

  // A course anyone can book. Unlabeled courses may be public too, but we cannot promise it.
  const isOpenCourse = (place) => ['Public', 'Municipal', 'Semi-private', 'Resort', 'Likely municipal', 'Likely public', 'Likely resort'].includes(place.access);
  const DISTANCE_PENALTY = 0.15; // score points per mile, so closer wins ties
  const MAX_MARINE_CELL_MILES = 20; // farther than this and the "sea" cell is not this site

  const WEATHER_CODES = {
    0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'freezing fog',
    51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers',
    95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
  };

  const $ = (id) => document.getElementById(id);
  const form = $('query-form');
  const activitySelect = $('activity-select');
  const placeInput = $('manual-location');
  const locateButton = $('locate-button');
  const dateSelect = $('date-select');
  const timeSelect = $('time-select');
  const distanceInput = $('max-distance');
  const unitsSelect = $('units-select');
  const specificInput = $('specific-location');
  const submitButton = $('submit-button');
  const statusDiv = $('status');
  const resultsDiv = $('results');
  const activityImage = $('activity-image');

  let geoOrigin = null; // set by "Locate me"
  const MY_LOCATION = 'My location';

  // ---------- small helpers ----------

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) {
      if (child) node.append(child);
    }
    return node;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const known = (xs) => xs.filter((x) => x !== null && x !== undefined);

  function setStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.className = isError ? 'error' : '';
  }

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem('wm.prefs')) || {};
    } catch {
      return {};
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem('wm.prefs', JSON.stringify({
        activity: activitySelect.value,
        place: placeInput.value === MY_LOCATION ? '' : placeInput.value,
        units: unitsSelect.value,
        distance: distanceInput.value,
      }));
    } catch {
      // storage is a convenience only
    }
  }

  // Haversine distance in miles
  function milesBetween(lat1, lon1, lat2, lon2) {
    const rad = (deg) => (deg * Math.PI) / 180;
    const a =
      Math.sin(rad(lat2 - lat1) / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---------- unit formatting (everything is scored in °F, mph, ft, miles) ----------

  const imperial = () => unitsSelect.value === 'imperial';
  const fmtTemp = (f) => (imperial() ? `${Math.round(f)}°F` : `${Math.round(((f - 32) * 5) / 9)}°C`);
  const fmtWind = (mph) => (imperial() ? `${Math.round(mph)} mph` : `${Math.round(mph * 1.609)} km/h`);
  const fmtHeight = (ft) => (imperial() ? `${ft.toFixed(1)} ft` : `${(ft * 0.3048).toFixed(1)} m`);
  const fmtDistance = (mi) => (imperial() ? `${mi.toFixed(1)} mi` : `${(mi * 1.609).toFixed(1)} km`);

  function fmtHour(h) {
    const hour = ((h % 24) + 24) % 24;
    return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
  }

  function fmtClock(decimalHours) {
    let h = Math.floor(decimalHours);
    let m = Math.round((decimalHours - h) * 60);
    if (m === 60) { h += 1; m = 0; }
    return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h % 24 < 12 ? 'AM' : 'PM'}`;
  }

  function compass(deg) {
    if (deg === null || deg === undefined) return '';
    const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return names[Math.round(deg / 22.5) % 16];
  }

  function moonPhase(dateStr) {
    const synodic = 29.53058867;
    const newMoon = Date.UTC(2000, 0, 6, 18, 14);
    const days = (new Date(`${dateStr}T12:00:00Z`).getTime() - newMoon) / 86400000;
    const age = ((days % synodic) + synodic) % synodic;
    const names = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
      'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
    return names[Math.round((age / synodic) * 8) % 8];
  }

  function scoreLabel(score) {
    if (score >= 80) return 'Great';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    if (score >= 20) return 'Poor';
    return 'Skip';
  }

  const scoreColor = (score) => `hsl(${Math.round(score * 1.2)}, 70%, 52%)`;
  const UNSCORED_COLOR = '#9a9a9a';

  // ---------- data fetching ----------

  const fetchCache = new Map();

  function getJSON(url) {
    if (!fetchCache.has(url)) {
      const request = fetch(url).then((response) => {
        if (response.status === 429) {
          throw new Error('The free forecast service is rate limiting this connection. Wait a few minutes and try again.');
        }
        if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
        return response.json();
      });
      request.catch(() => fetchCache.delete(url));
      fetchCache.set(url, request);
    }
    return fetchCache.get(url);
  }

  function batchUrl(base, places, date, extra) {
    const params = new URLSearchParams({
      latitude: places.map((p) => p.lat.toFixed(4)).join(','),
      longitude: places.map((p) => p.lng.toFixed(4)).join(','),
      start_date: date,
      end_date: date,
      timezone: 'auto',
      ...extra,
    });
    return `${base}?${params}`;
  }

  async function fetchWeather(places, date) {
    const data = await getJSON(batchUrl('https://api.open-meteo.com/v1/forecast', places, date, {
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
    }));
    return Array.isArray(data) ? data : [data];
  }

  // Waves, water temperature and sea level (tide) from the Open-Meteo marine model.
  // Returns null when there is no marine forecast, so callers degrade gracefully.
  async function fetchMarine(places, date) {
    try {
      const data = await getJSON(batchUrl('https://marine-api.open-meteo.com/v1/marine', places, date, {
        hourly: 'wave_height,wave_period,swell_wave_height,swell_wave_period,sea_surface_temperature,sea_level_height_msl',
        cell_selection: 'sea',
      }));
      return Array.isArray(data) ? data : [data];
    } catch (error) {
      console.warn('No marine forecast:', error);
      return null;
    }
  }

  async function geocode(query) {
    const key = `wm.geo2.${query.toLowerCase()}`;
    try {
      const hit = JSON.parse(localStorage.getItem(key));
      if (hit) return hit;
    } catch {
      // fall through to the network
    }

    let result = null;
    try {
      const found = await getJSON(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`
      );
      // "Monterey, CA" can match the county first, whose center is miles from town
      const towns = ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'borough'];
      const hit = found.find((f) => towns.includes(f.addresstype) || towns.includes(f.type)) || found[0];
      if (hit) {
        result = {
          lat: parseFloat(hit.lat),
          lng: parseFloat(hit.lon),
          label: hit.display_name.split(',').slice(0, 2).join(','),
        };
      }
    } catch (error) {
      console.warn('Nominatim failed, trying Open-Meteo geocoding:', error);
    }

    if (!result) {
      const town = query.split(',')[0].trim();
      const found = await getJSON(
        `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(town)}`
      );
      if (found.results && found.results.length) {
        const hit = found.results[0];
        result = { lat: hit.latitude, lng: hit.longitude, label: [hit.name, hit.admin1].filter(Boolean).join(', ') };
      }
    }

    if (result) {
      try {
        localStorage.setItem(key, JSON.stringify(result));
      } catch {
        // ignore
      }
    }
    return result;
  }

  function browserPosition() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation is not supported by this browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'your location' }),
        () => reject(new Error('Could not get your location.')),
        { timeout: 10000 }
      );
    });
  }

  // ---------- turning a forecast into hourly scores ----------

  const clockToHours = (iso) => parseInt(iso.slice(11, 13), 10) + parseInt(iso.slice(14, 16), 10) / 60;

  function buildHours(weather, marine) {
    const w = weather.hourly;
    const m = marine ? marine.hourly : null;
    const at = (series, i) => (series && series[i] !== undefined ? series[i] : null);
    const feet = (meters) => (meters === null ? null : meters * 3.28084);
    return w.time.map((_, i) => ({
      temp: w.temperature_2m[i],
      feels: w.apparent_temperature[i],
      rainChance: w.precipitation_probability[i] ?? 0,
      rain: w.precipitation[i] ?? 0, // mm
      code: w.weather_code[i],
      wind: w.wind_speed_10m[i],
      gust: w.wind_gusts_10m[i],
      windDir: w.wind_direction_10m[i],
      wave: m ? feet(at(m.wave_height, i)) : null,
      wavePeriod: m ? at(m.wave_period, i) : null,
      swell: m ? feet(at(m.swell_wave_height, i)) : null,
      swellPeriod: m ? at(m.swell_wave_period, i) : null,
      waterTemp: m && at(m.sea_surface_temperature, i) !== null ? (at(m.sea_surface_temperature, i) * 9) / 5 + 32 : null,
      seaLevel: m ? feet(at(m.sea_level_height_msl, i)) : null,
    }));
  }

  // Wind speed (mph) blowing straight onto the shore, averaged over the last few
  // hours because stirred-up silt takes a while to settle. Null when we do not
  // know which way the site faces (offshore, inland or enclosed water).
  function onshoreWind(place, hours, i, lookback = 6) {
    if (place.seaBearing === undefined) return null;
    const parts = [];
    for (let j = Math.max(0, i - lookback); j <= i; j++) {
      const h = hours[j];
      if (h.wind === null || h.windDir === null) continue;
      // windDir is where the wind comes from, so it is onshore when that matches the seaward bearing
      parts.push(h.wind * Math.max(0, Math.cos(((h.windDir - place.seaBearing) * Math.PI) / 180)));
    }
    return parts.length ? mean(parts) : null;
  }

  function hourScore(activity, place, hours, i) {
    const h = hours[i];
    if (h.temp === null || h.temp === undefined) return null;
    if (h.code >= 95) return 0; // thunderstorms: nobody should be out
    let score = 100;

    if (activity === 'scuba_diving') {
      const boat = place.diveType === 'boat';
      if (h.wave !== null) {
        if (h.wave > 5) return 0;
        score -= Math.max(0, h.wave - 1) * 18 * (boat ? 1.25 : 1);
      }
      score -= Math.max(0, h.wind - 10) * 2 * (boat ? 1.5 : 1);
      score -= h.rainChance * 0.15;
      // Onshore wind silts up shallow sites. This is the main visibility killer for shore dives.
      const onshore = onshoreWind(place, hours, i);
      if (onshore !== null) score -= Math.max(0, onshore - 3) * (boat ? 3 : 6);
    } else if (activity === 'surfing') {
      const height = h.swell ?? h.wave;
      const period = h.swellPeriod ?? h.wavePeriod;
      if (height === null) return null;
      if (height < 1) score -= 85;
      else if (height < 2) score -= 35;
      else if (height > 8) score -= 45;
      else if (height > 6) score -= 15;
      if (period !== null) {
        if (period < 6) score -= 30;
        else if (period < 8) score -= 15;
      }
      score -= Math.max(0, h.wind - 12) * 2.5;
    } else {
      score -= h.rainChance * 0.5;
      if (h.rain > 0.2) score -= 25;
      if (activity === 'hiking') {
        score -= Math.max(0, 40 - h.feels) * 1.5 + Math.max(0, h.feels - 78) * 2;
        score -= Math.max(0, h.wind - 20) * 2;
      } else {
        score -= Math.max(0, 50 - h.feels) * 1.5 + Math.max(0, h.feels - 85) * 2.5;
        if (activity === 'golf') {
          score -= Math.max(0, h.wind - 10) * 2.5;
          if (h.gust > 25) score -= 10;
        } else {
          // pickleball: the ball is light and a wet court is a slip hazard
          score -= Math.max(0, h.wind - 8) * 4;
          const recentRain = (hours[i - 1]?.rain ?? 0) + (hours[i - 2]?.rain ?? 0);
          if (recentRain > 0.2) score -= 30;
        }
      }
    }
    return clamp(Math.round(score), 0, 100);
  }

  // One poor hour should hurt more than the average suggests.
  function windowScore(scores, start, length) {
    const slice = scores.slice(start, start + length);
    return Math.round(mean(slice) * 0.7 + Math.min(...slice) * 0.3);
  }

  function outingHours(activity, place) {
    if (activity === 'hiking' && place.miles) return clamp(Math.round(place.miles / 2) + 1, 2, 8);
    return ACTIVITIES[activity].hours;
  }

  function tideExtremes(hours) {
    const levels = hours.map((h) => h.seaLevel);
    const tides = [];
    for (let i = 1; i < levels.length - 1; i++) {
      const [a, b, c] = [levels[i - 1], levels[i], levels[i + 1]];
      if (a === null || b === null || c === null) continue;
      const high = b > a && b >= c;
      const low = b < a && b <= c;
      if (!high && !low) continue;
      // fit a parabola through the three points to place the turn between hours
      const curve = a - 2 * b + c;
      const offset = curve === 0 ? 0 : clamp((0.5 * (a - c)) / curve, -0.5, 0.5);
      tides.push({ type: high ? 'High' : 'Low', time: i + offset });
    }
    return tides;
  }

  function evaluate(place, weather, marine, query) {
    const activity = query.activity;
    const usableMarine =
      marine && milesBetween(place.lat, place.lng, marine.latitude, marine.longitude) <= MAX_MARINE_CELL_MILES
        && marine.hourly.wave_height.some((v) => v !== null)
        ? marine
        : null;
    const hours = buildHours(weather, usableMarine);
    const scores = hours.map((_, i) => hourScore(activity, place, hours, i));

    const sunrise = clockToHours(weather.daily.sunrise[0]);
    const sunset = clockToHours(weather.daily.sunset[0]);

    // Hours already gone today, in the place's own time zone
    const placeNow = new Date(Date.now() + weather.utc_offset_seconds * 1000);
    const firstHour = placeNow.toISOString().slice(0, 10) === query.date ? placeNow.getUTCHours() : 0;

    const daylight = hours.map((_, i) => i >= Math.ceil(sunrise) && i + 1 <= Math.floor(sunset));
    // query.night opens up the hours after dark, for a night dive
    const usable = hours.map((_, i) => scores[i] !== null && i >= firstHour && (query.night || daylight[i]));

    const wanted = outingHours(activity, place);
    let best = null;
    for (let length = wanted; length >= 1 && !best; length--) {
      for (let start = 0; start + length <= 24; start++) {
        if (!usable.slice(start, start + length).every(Boolean)) continue;
        const score = windowScore(scores, start, length);
        if (!best || score > best.score) best = { start, length, score };
      }
    }

    // A start time the user asked for. Diving can happen after dark; the rest cannot.
    let requested = null;
    let requestNote = '';
    if (query.hour !== null) {
      const allowed = (i) => (activity === 'scuba_diving' ? scores[i] !== null : usable[i]);
      // shorten the outing if only part of it fits before dark
      let length = 0;
      while (length < wanted && query.hour + length < 24 && allowed(query.hour + length)) length++;
      if (query.hour < firstHour) requestNote = `${fmtHour(query.hour)} has already passed there.`;
      else if (length) requested = { start: query.hour, length, score: windowScore(scores, query.hour, length) };
      else requestNote = `${fmtHour(query.hour)} is outside daylight there.`;
    }

    const chosen = requested || best;
    return {
      place,
      hours,
      scores,
      usable,
      daily: weather.daily,
      sunrise,
      sunset,
      hasMarine: Boolean(usableMarine),
      night: Boolean(query.night),
      tides: usableMarine ? tideExtremes(hours) : [],
      best,
      requested,
      requestNote,
      chosen,
      rank: chosen ? chosen.score - DISTANCE_PENALTY * (place.distance || 0) : -Infinity,
    };
  }

  // ---------- plain-language write-up (this replaces the old LLM call) ----------

  function windowStats(result) {
    const { start, length } = result.chosen;
    const slice = result.hours.slice(start, start + length);
    const mid = slice[Math.floor(length / 2)];
    const pick = (key) => known(slice.map((h) => h[key]));
    return {
      slice,
      temp: mean(pick('temp')),
      feels: mean(pick('feels')),
      wind: Math.max(...pick('wind')),
      gust: Math.max(...pick('gust')),
      windDir: compass(mid.windDir),
      rainChance: Math.max(...pick('rainChance')),
      code: Math.max(...pick('code')),
      sky: WEATHER_CODES[mid.code] || 'mixed skies',
      wave: pick('wave').length ? Math.max(...pick('wave')) : null,
      swell: pick('swell').length ? mean(pick('swell')) : null,
      swellPeriod: pick('swellPeriod').length ? mean(pick('swellPeriod')) : null,
      waterTemp: pick('waterTemp').length ? mean(pick('waterTemp')) : null,
    };
  }

  function conditionsLine(stats) {
    const parts = [
      `${stats.sky[0].toUpperCase()}${stats.sky.slice(1)}`,
      `${fmtTemp(stats.temp)}${Math.abs(stats.feels - stats.temp) >= 4 ? ` (feels ${fmtTemp(stats.feels)})` : ''}`,
      `wind ${stats.windDir} ${fmtWind(stats.wind)}${stats.gust - stats.wind >= 8 ? `, gusts ${fmtWind(stats.gust)}` : ''}`,
      `${Math.round(stats.rainChance)}% chance of rain`,
    ];
    return `${parts.join(', ')}.`;
  }

  function clothingTip(stats) {
    if (stats.feels < 40) return 'Cold. Wear a hat, gloves and real insulating layers.';
    if (stats.feels < 55) return 'Cool. Start in layers you can peel off.';
    if (stats.feels > 85) return 'Hot. Bring more water than you think you need.';
    return '';
  }

  function thermalProtection(waterTemp) {
    if (waterTemp >= 77) return 'a shorty';
    if (waterTemp > 70) return 'a 3mm wetsuit';
    if (waterTemp > 60) return 'a 5mm wetsuit';
    if (waterTemp > 50) return 'a 7mm wetsuit';
    return 'a drysuit';
  }

  function advice(result, query) {
    const { place, chosen } = result;
    const stats = windowStats(result);
    const tips = [];
    const end = chosen.start + chosen.length;

    if (stats.code >= 95) tips.push('Thunderstorms are in the forecast for this window. Pick another time.');

    if (query.activity === 'golf') {
      if (stats.wind >= 20) tips.push('Strong wind. Expect a club or two of difference and keep the ball low.');
      else if (stats.wind >= 12) tips.push('Enough breeze to move the ball, so club up into it.');
      if (stats.rainChance >= 40) tips.push('Pack rain gear and an extra glove.');
      if (end > result.sunset - 0.5) tips.push('That finishes close to sunset, so a full 18 may be tight.');
    } else if (query.activity === 'hiking') {
      const duration = outingHours('hiking', place);
      const latest = result.sunset - 1 - duration;
      tips.push(`Allow about ${duration} hours. Start by ${fmtClock(Math.max(latest, result.sunrise))} to finish an hour before sunset.`);
      if (stats.rainChance >= 40) tips.push('Bring a shell. Wet rock and roots will slow you down.');
      if (/summit|alpine|4000/i.test(place.features || '') && stats.wind >= 15) {
        tips.push('This is a valley forecast. Expect it noticeably colder and windier up high.');
      }
      if ((result.daily.uv_index_max[0] ?? 0) >= 6) tips.push('UV is high, so wear sunscreen.');
    } else if (query.activity === 'pickleball') {
      const before = result.hours.slice(Math.max(0, chosen.start - 2), chosen.start);
      if (before.some((h) => h.rain > 0.2)) tips.push('Rain just before this window. Outdoor courts may still be wet.');
      if (stats.wind >= 12) tips.push('Windy for an outdoor game. Lobs and dinks will drift.');
      if (stats.rainChance >= 50) tips.push('Rain is likely. Call ahead about indoor courts.');
    } else if (query.activity === 'scuba_diving') {
      if (!result.hasMarine) {
        tips.push('No marine forecast here (freshwater or a sheltered site), so the score uses wind and weather only.');
      } else {
        if (stats.wave !== null) tips.push(`Waves up to ${fmtHeight(stats.wave)}${stats.wave > 3 ? ', which means surge and a rough entry' : ''}.`);
        if (stats.waterTemp !== null) {
          tips.push(`Surface water about ${fmtTemp(stats.waterTemp)}. Wear at least ${thermalProtection(stats.waterTemp)}.`);
        }
        if (result.tides.length) {
          tips.push(`Tides (approximate): ${result.tides.map((t) => `${t.type.toLowerCase()} ${fmtClock(t.time)}`).join(', ')}. Visibility is usually best around high slack.`);
        }
      }
      const onshore = onshoreWind(place, result.hours, chosen.start + chosen.length - 1, chosen.length + 5);
      if (onshore === null) {
        tips.push(stats.wind > 12 ? 'Wind chop may cut visibility.' : 'Light wind, so visibility should hold up.');
      } else if (onshore >= 8) {
        tips.push(`Wind is blowing onto this shore (it faces ${compass(place.seaBearing)}). Shallow sites silt up, so expect poor visibility.`);
      } else if (onshore >= 4) {
        tips.push(`Some wind onto this shore (it faces ${compass(place.seaBearing)}), which can stir up silt in the shallows.`);
      } else {
        tips.push(`Wind is off the land or along this shore (it faces ${compass(place.seaBearing)}), which is good for visibility.`);
      }
      if (chosen.start < result.sunrise || end > result.sunset) {
        tips.push(`This is a night dive (${moonPhase(query.date)}). ${NIGHT_DIVE_RULE} Carry at least two lights.`);
        tips.push(NIGHT_ACCESS_RULE);
      }
    } else if (query.activity === 'surfing') {
      if (stats.swell !== null) {
        tips.push(`Swell about ${fmtHeight(stats.swell)}${stats.swellPeriod ? ` at ${Math.round(stats.swellPeriod)} s` : ''}.`);
        if (stats.swell < 1) tips.push('Basically flat.');
        else if (stats.swellPeriod && stats.swellPeriod < 6) tips.push('Short-period wind slop rather than clean lines.');
      }
      if (stats.waterTemp !== null) {
        tips.push(`Water about ${fmtTemp(stats.waterTemp)}${stats.waterTemp < 55 ? '. Hood, gloves and boots' : stats.waterTemp < 65 ? '. Full suit' : ''}.`);
      }
      if (result.tides.length) {
        tips.push(`Tides (approximate): ${result.tides.map((t) => `${t.type.toLowerCase()} ${fmtClock(t.time)}`).join(', ')}.`);
      }
      const onshore = onshoreWind(place, result.hours, chosen.start + chosen.length - 1, chosen.length);
      if (onshore !== null && stats.wind >= 6) {
        tips.push(onshore >= 5 ? 'Onshore wind, so expect bumpy, crumbly faces.' : 'Wind is offshore or cross-shore, so faces should be cleaner.');
      }
    }

    if (query.activity !== 'scuba_diving' && query.activity !== 'surfing') {
      const tip = clothingTip(stats);
      if (tip) tips.push(tip);
    }
    return { stats, tips };
  }

  // ---------- map ----------

  const map = L.map('map').setView([42.3601, -71.0589], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);
  const markersLayer = L.featureGroup().addTo(map);

  const directionsUrl = (place) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place.lat},${place.lng}`)}`;

  function addMarker(result, number, card) {
    const score = result.chosen ? result.chosen.score : null;
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin" style="background:${score === null ? UNSCORED_COLOR : scoreColor(score)}">${number}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    const popup = el('div', {},
      el('strong', { text: result.place.name }),
      el('br'),
      document.createTextNode(score === null ? 'Not scored*' : `${scoreLabel(score)} (${score})`),
      el('br'),
      el('a', { href: directionsUrl(result.place), target: '_blank', rel: 'noopener', text: 'Directions' })
    );
    const marker = L.marker([result.place.lat, result.place.lng], { icon }).bindPopup(popup).addTo(markersLayer);
    marker.on('click', () => {
      document.querySelectorAll('.card.active').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    card.addEventListener('mouseenter', () => marker.openPopup());
  }

  // ---------- rendering ----------

  // Rain over each hour of the strip: the blue column rises with the chance of
  // rain, and one to three drops show how hard it is expected to come down.
  function rainRow(result, first, last) {
    const shown = result.hours.slice(first, last + 1);
    if (!shown.some((h) => h.rainChance >= RAIN_SHOWN_FROM)) return null;
    const row = el('div', { class: 'rain' });
    shown.forEach((h, k) => {
      const column = el('div', { class: 'rain-col' });
      if (h.rainChance >= RAIN_SHOWN_FROM) {
        const amount = imperial() ? `${(h.rain / 25.4).toFixed(2)} in` : `${h.rain.toFixed(1)} mm`;
        column.title = `${fmtHour(first + k)}: ${Math.round(h.rainChance)}% chance of rain, ${amount}`;
        const fill = el('div', { class: 'rain-fill', style: `height:${Math.round(h.rainChance)}%;opacity:${(0.35 + h.rainChance / 155).toFixed(2)}` });
        const drops = h.rain >= 2.5 ? 3 : h.rain >= 0.5 ? 2 : h.rain > 0 || h.rainChance >= 50 ? 1 : 0;
        for (let d = 0; d < drops; d++) fill.append(el('i', { class: 'drop' }));
        column.append(fill);
      }
      row.append(column);
    });
    return row;
  }

  function hourStrip(result) {
    const first = 5;
    const last = result.night ? 23 : 21;
    const strip = el('div', { class: 'strip' });
    for (let i = first; i <= last; i++) {
      const score = result.scores[i];
      const inBest = result.chosen && i >= result.chosen.start && i < result.chosen.start + result.chosen.length;
      const cell = el('div', {
        class: `cell${inBest ? ' best' : ''}`,
        title: `${fmtHour(i)}: ${score === null ? 'no data' : result.usable[i] ? `${scoreLabel(score)} (${score})` : `${score}, dark or already past`}`,
      });
      if (score !== null && result.usable[i]) cell.style.background = scoreColor(score);
      strip.append(cell);
    }
    const labels = el('div', { class: 'strip-labels' },
      el('span', { text: fmtHour(first) }),
      el('span', { text: fmtHour((first + last) / 2) }),
      el('span', { text: fmtHour(last) })
    );
    const rain = rainRow(result, first, last);
    return rain ? [rain, strip, labels] : [strip, labels];
  }

  // Reasons a score is less complete than usual. Any of these puts an asterisk on it.
  function caveats(result, query) {
    const notes = [];
    if (query.marineFailed) {
      notes.push('The wave and tide lookup failed, so this score uses wind and weather only.');
    }
    const { place } = result;
    if (query.activity === 'scuba_diving' && place.diveType === 'shore' && place.seaBearing === undefined && result.hasMarine) {
      notes.push('Which way this shore faces is not known yet, so the onshore wind rule was not applied.');
    }
    return notes;
  }

  function placeFacts(place) {
    const facts = [];
    if (place.distance !== undefined) facts.push(`${fmtDistance(place.distance)} away${place.beyond ? ' (past your limit)' : ''}`);
    if (place.access) facts.push(place.access);
    if (place.diveType) facts.push(`${place.diveType} dive`);
    if (place.approx) facts.push('location approximate');
    if (place.maxDepth) facts.push(`max depth ${place.maxDepth}`);
    if (place.difficulty) facts.push(place.difficulty);
    if (place.miles) facts.push(`${fmtDistance(place.miles)} hike`);
    return [[place.city, place.state].filter(Boolean).join(', '), ...facts].filter(Boolean).join(' · ');
  }

  function placeFooter(place) {
    const nodes = [];
    if (place.features) nodes.push(el('p', { class: 'meta', text: `Features: ${place.features}` }));
    if (place.desc) {
      const desc = el('p', { class: 'desc clamped', text: place.desc, title: 'Click to expand' });
      desc.addEventListener('click', () => desc.classList.toggle('clamped'));
      nodes.push(desc);
    }
    const contact = el('p', { class: 'meta' });
    if (place.address) contact.append(`${place.address} · `);
    if (place.phone) contact.append(`${place.phone} · `);
    if (place.url) contact.append(el('a', { href: place.url, target: '_blank', rel: 'noopener', text: 'Site details' }), ' · ');
    if (place.website) {
      contact.append(el('a', { href: place.website, target: '_blank', rel: 'noopener', text: 'Course website and tee times' }), ' · ');
    } else if (place.activity === 'golf') {
      // no website on file for this course, so hand off to a search
      const search = `https://www.google.com/search?q=${encodeURIComponent(`${place.name} ${place.city || ''} ${place.state || ''} tee times`)}`;
      contact.append(el('a', { href: search, target: '_blank', rel: 'noopener', text: 'Search for tee times' }), ' · ');
    }
    contact.append(el('a', { href: directionsUrl(place), target: '_blank', rel: 'noopener', text: 'Directions' }));
    nodes.push(contact);
    return nodes;
  }

  // A place we could not get a forecast for: still listed, marked with an asterisk.
  function renderUnscoredCard(result, number) {
    const { place } = result;
    const card = el('article', { class: 'card' },
      el('div', { class: 'card-head' },
        el('div', { class: 'rank', text: String(number) }),
        el('div', { class: 'title' },
          el('h3', { text: place.name }),
          el('div', { class: 'where', text: placeFacts(place) })
        ),
        el('div', { class: 'badge', style: `background:${UNSCORED_COLOR}` },
          document.createTextNode('*'),
          el('small', { text: 'No score' })
        )
      ),
      ...placeFooter(place)
    );
    addMarker(result, number, card);
    return card;
  }

  function renderCard(result, number, query) {
    if (!result.chosen) return renderUnscoredCard(result, number);
    const { place, chosen } = result;
    const { stats, tips } = advice(result, query);
    const notes = caveats(result, query);

    const windowLabel = result.requested ? 'Your time' : result.night ? 'Best night window' : 'Best window';
    const card = el('article', { class: 'card' },
      el('div', { class: 'card-head' },
        el('div', { class: 'rank', text: String(number) }),
        el('div', { class: 'title' },
          el('h3', { text: place.name }),
          el('div', { class: 'where', text: placeFacts(place) })
        ),
        el('div', { class: 'badge', style: `background:${scoreColor(chosen.score)}` },
          document.createTextNode(`${chosen.score}${notes.length ? '*' : ''}`),
          el('small', { text: scoreLabel(chosen.score) })
        )
      ),
      el('p', { class: 'window', text: `${windowLabel}: ${fmtHour(chosen.start)} to ${fmtHour(chosen.start + chosen.length)}` }),
      el('p', { class: 'conditions', text: conditionsLine(stats) })
    );

    if (result.requestNote) card.append(el('p', { class: 'meta', text: `${result.requestNote} Showing the best window instead.` }));
    if (result.requested && result.best && result.best.score - result.requested.score >= 10) {
      card.append(el('p', { class: 'meta',
        text: `Better at ${fmtHour(result.best.start)} to ${fmtHour(result.best.start + result.best.length)} (${result.best.score}).` }));
    }

    card.append(...hourStrip(result));
    if (tips.length) card.append(el('ul', {}, ...tips.map((tip) => el('li', { text: tip }))));

    notes.forEach((note) => card.append(el('p', { class: 'meta', text: `* ${note}` })));
    card.append(...placeFooter(place));

    addMarker(result, number, card);
    return card;
  }

  // A button that reruns the search for the day after the one selected.
  function tomorrowButton(text) {
    return el('button', {
      type: 'button', class: 'primary', text,
      onclick: () => {
        const next = new Date(`${dateSelect.value}T12:00`);
        next.setDate(next.getDate() + 1);
        dateSelect.value = localDateStr(next);
        timeSelect.value = '';
        form.requestSubmit();
      },
    });
  }

  // What the hourly bar and the rain above it mean. Shown once, under the results.
  function renderLegend() {
    const rainSample = (drops) => {
      const fill = el('span', { class: 'rain-fill sample' });
      for (let d = 0; d < drops; d++) fill.append(el('i', { class: 'drop' }));
      return fill;
    };
    const swatch = (style) => el('span', { class: 'swatch', style });
    const scores = el('span', { class: 'legend-item' }, 'Skip ');
    [10, 30, 50, 70, 90].forEach((score) => scores.append(swatch(`background:${scoreColor(score)}`)));
    scores.append(' Great');
    return el('div', { class: 'legend' },
      el('div', {}, el('strong', { text: 'Hourly score ' }), scores,
        el('span', { class: 'legend-item' }, swatch('background:#2a2a2a;outline:2px solid #fff;outline-offset:-1px'), ' best window'),
        el('span', { class: 'legend-item' }, swatch('background:#2a2a2a'), ' dark or already past')),
      el('div', {}, el('strong', { text: 'Rain ' }),
        el('span', { class: 'legend-item', text: 'taller, brighter blue is a higher chance' }),
        el('span', { class: 'legend-item' }, rainSample(1), ' light'),
        el('span', { class: 'legend-item' }, rainSample(2), ' moderate'),
        el('span', { class: 'legend-item' }, rainSample(3), ' heavy'))
    );
  }

  function renderSummary(top, query, origin) {
    if (!top.chosen) {
      return el('div', { class: 'summary' },
        el('h2', { text: `${ACTIVITIES[query.activity].label} near ${origin.label}` }),
        el('p', { text: `* ${query.failure} These are the nearest places, listed by distance and not scored. Search again in a few minutes for scores.` })
      );
    }
    const daily = top.daily;
    const dateText = new Date(`${query.date}T12:00`).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const verdicts = {
      Great: 'A great day for it.',
      Good: 'A good day for it.',
      Fair: 'Doable, with compromises.',
      Poor: 'Not a great day for it.',
      Skip: 'Probably one to skip.',
    };
    const details = [
      WEATHER_CODES[daily.weather_code[0]] || 'mixed skies',
      `${fmtTemp(daily.temperature_2m_min[0])} to ${fmtTemp(daily.temperature_2m_max[0])}`,
      `sunrise ${fmtClock(top.sunrise)}`,
      `sunset ${fmtClock(top.sunset)}`,
    ];
    if (query.activity === 'scuba_diving') details.push(moonPhase(query.date));
    const summary = el('div', { class: 'summary' },
      el('h2', { text: `${ACTIVITIES[query.activity].label} near ${origin.label}, ${dateText}` }),
      el('p', { text: `${verdicts[scoreLabel(top.chosen.score)]} At ${top.place.name}: ${details.join(', ')}.` })
    );
    if (query.night) {
      summary.append(
        el('p', { class: 'warning', text: `No daylight is left today, so these are night dives. ${NIGHT_DIVE_RULE} ${NIGHT_ACCESS_RULE}` }),
        tomorrowButton('See tomorrow in daylight')
      );
    }
    return summary;
  }

  function renderResults(results, query, origin) {
    resultsDiv.replaceChildren();
    markersLayer.clearLayers();

    L.circleMarker([origin.lat, origin.lng], { radius: 7, color: '#fff', fillColor: '#4da3ff', fillOpacity: 1, weight: 2 })
      .bindPopup(origin.label)
      .addTo(markersLayer);

    // Diving is shore-first: 3 to 5 shore dives, then 1 or 2 boat dives.
    // Slots beyond the minimum are only filled by sites worth the trip.
    const take = (list, min, max) => list.slice(0, max).filter((r, i) => i < min || !r.chosen || r.chosen.score >= 40);
    let groups;
    if (query.activity === 'scuba_diving') {
      const shore = results.filter((r) => r.place.diveType !== 'boat');
      const boat = results.filter((r) => r.place.diveType === 'boat');
      groups = [
        { title: 'Shore dives', items: take(shore, 3, 5) },
        { title: 'Boat dives', items: take(boat, 1, 2) },
      ].filter((group) => group.items.length);
    } else {
      const top = results.slice(0, SHOWN_AT_FIRST);
      let note = '';
      if (query.activity === 'golf' && results.length > 1) {
        // top up with the best public or municipal courses that missed the cut
        const extra = results.slice(SHOWN_AT_FIRST).filter((r) => isOpenCourse(r.place));
        while (top.filter((r) => isOpenCourse(r.place)).length < MIN_OPEN_GOLF && extra.length) top.push(extra.shift());
        top.sort((a, b) => b.rank - a.rank);
        const open = top.filter((r) => isOpenCourse(r.place)).length;
        const beyond = top.filter((r) => r.place.beyond).length;
        if (beyond) {
          note = `${beyond} of these ${beyond === 1 ? 'is' : 'are'} past your distance limit, included so you have ${MIN_OPEN_GOLF} public or municipal options.`;
        } else if (open < MIN_OPEN_GOLF) {
          note = `Only ${open} of the courses we know about ${open === 1 ? 'is' : 'are'} listed as public or municipal. The unlabeled ones may be public too.`;
        }
      }
      groups = [{ title: '', items: top, note }];
    }
    const featured = new Set(groups.flatMap((group) => group.items));
    const rest = results.filter((r) => !featured.has(r));

    resultsDiv.append(renderSummary(groups[0].items[0], query, origin));

    // cards go in their own container so "show more" adds above the legend
    const list = el('div');
    resultsDiv.append(list);
    let number = 0;
    const addGroup = (group) => {
      if (group.title) list.append(el('h2', { class: 'section', text: group.title }));
      if (group.note) list.append(el('p', { class: 'meta', text: group.note }));
      group.items.forEach((result) => list.append(renderCard(result, ++number, query)));
    };
    groups.forEach(addGroup);

    if (rest.length) {
      const more = el('button', { type: 'button', class: 'linklike', text: `Show ${rest.length} more` });
      more.addEventListener('click', () => {
        more.remove();
        addGroup({ title: groups[0].title ? 'Everything else nearby' : '', items: rest });
        map.fitBounds(markersLayer.getBounds(), { padding: [40, 40], maxZoom: 13 });
      });
      resultsDiv.append(more);
    }
    if (groups[0].items[0].chosen) resultsDiv.append(renderLegend());
    map.fitBounds(markersLayer.getBounds(), { padding: [40, 40], maxZoom: 13 });
  }

  // ---------- the query itself ----------

  async function resolveOrigin() {
    const typed = placeInput.value.trim();
    if (typed && typed !== MY_LOCATION) {
      const found = await geocode(typed);
      if (!found) throw new Error(`Could not find "${typed}". Try a town and state.`);
      return found;
    }
    if (geoOrigin) return geoOrigin;
    try {
      geoOrigin = await browserPosition();
      placeInput.value = MY_LOCATION;
      return geoOrigin;
    } catch {
      throw new Error('Enter a town or address, or allow location access.');
    }
  }

  // Names repeat across the country, so the nearest match wins.
  function findSpecific(sortedPlaces, text) {
    const wanted = text.toLowerCase();
    return (
      sortedPlaces.find((p) => p.name.toLowerCase() === wanted) ||
      sortedPlaces.find((p) => p.name.toLowerCase().includes(wanted))
    );
  }

  async function runQuery() {
    const activity = activitySelect.value;
    const query = {
      activity,
      date: dateSelect.value,
      hour: timeSelect.value ? parseInt(timeSelect.value.slice(0, 2), 10) : null,
    };
    const maxMiles = (parseFloat(distanceInput.value) || 30) / (imperial() ? 1 : 1.609);

    setStatus('Finding your starting point...');
    const origin = await resolveOrigin();

    const all = (await loadPlaces(activity))
      .map((p) => ({ ...p, distance: milesBetween(origin.lat, origin.lng, p.lat, p.lng) }))
      .sort((a, b) => a.distance - b.distance);
    let places;
    const specific = specificInput.value.trim();
    if (specific) {
      const match = findSpecific(all, specific);
      if (!match) throw new Error(`No ${ACTIVITIES[activity].label.toLowerCase()} place matches "${specific}".`);
      places = [match];
    } else {
      const inRange = all.filter((p) => p.distance <= maxMiles);
      if (activity === 'scuba_diving') {
        // keep boat dives from crowding the shore dives out of the forecast request
        places = [
          ...inRange.filter((p) => p.diveType !== 'boat').slice(0, 20),
          ...inRange.filter((p) => p.diveType === 'boat').slice(0, 10),
        ];
      } else {
        places = inRange.slice(0, ACTIVITIES[activity].pool);
        if (activity === 'golf') {
          // make sure the forecast request covers enough public and municipal courses
          const missing = MIN_OPEN_GOLF + 2 - places.filter(isOpenCourse).length;
          if (missing > 0) {
            places.push(...inRange.slice(ACTIVITIES[activity].pool).filter(isOpenCourse).slice(0, missing));
          }
          // still short: reach past the distance limit for the nearest ones
          const short = MIN_OPEN_GOLF - places.filter(isOpenCourse).length;
          if (short > 0 && places.length) {
            const farther = all.filter((p) => p.distance > maxMiles && isOpenCourse(p)).slice(0, short);
            places.push(...farther.map((p) => ({ ...p, beyond: true })));
          }
        }
      }
      if (!places.length) {
        resultsDiv.replaceChildren();
        markersLayer.clearLayers();
        if (!all.length) throw new Error('No locations are loaded for that activity.');
        const reach = Math.ceil((all[0].distance * (imperial() ? 1 : 1.609)) / 5) * 5 + 5;
        setStatus('');
        statusDiv.append(
          `Nothing within ${distanceInput.value} ${imperial() ? 'mi' : 'km'}. The nearest is ${all[0].name}, ${fmtDistance(all[0].distance)} away. `,
          el('button', {
            type: 'button', class: 'linklike', text: `Search out to ${reach}`,
            onclick: () => { distanceInput.value = reach; form.requestSubmit(); },
          })
        );
        return;
      }
    }

    setStatus(`Checking the forecast at ${places.length} ${places.length === 1 ? 'place' : 'places'}...`);
    const needsMarine = Boolean(ACTIVITIES[activity].marine);
    const [weather, marine] = await Promise.all([
      fetchWeather(places, query.date).catch((error) => {
        console.warn('No weather forecast:', error);
        return { failure: `The forecast lookup failed (${error.message.replace(/\.$/, '')}).` };
      }),
      needsMarine ? fetchMarine(places, query.date) : null,
    ]);
    query.marineFailed = needsMarine && !marine;
    if (weather.failure) query.failure = weather.failure;
    // surf scores are nothing without waves
    else if (query.marineFailed && activity === 'surfing') query.failure = 'The wave forecast lookup failed.';

    // A failed lookup still gets a list: nearest places, unscored, with an asterisk.
    if (query.failure) {
      renderResults(places.map((place) => ({ place, chosen: null })), query, origin);
      setStatus(`* ${query.failure} Showing the nearest places without scores.`, true);
      return;
    }

    const score = () => places
      .map((place, i) => evaluate(place, weather[i], marine ? marine[i] : null, query))
      .filter((result) => result.chosen)
      .sort((a, b) => b.rank - a.rank);

    let results = score();
    const isToday = query.date === localDateStr(new Date());
    if (!results.length && isToday && activity === 'scuba_diving') {
      // the sun is down, but diving does not stop: score the night instead
      query.night = true;
      results = score();
    }

    if (!results.length) {
      resultsDiv.replaceChildren();
      markersLayer.clearLayers();
      if (isToday && dateSelect.value < dateSelect.max) {
        setStatus('');
        resultsDiv.append(el('div', { class: 'summary notice' },
          el('h2', { text: 'No daylight left today' }),
          el('p', { text: `It is too late for ${ACTIVITIES[activity].label.toLowerCase()} today. Tomorrow's forecast is ready.` }),
          tomorrowButton('Search tomorrow')
        ));
        return;
      }
      const why = activity === 'surfing' ? 'There is no wave forecast for that date yet.' : 'There is no daylight left on that date.';
      throw new Error(`${why} Try another day.`);
    }

    renderResults(results, query, origin);
    const starred = results.some((result) => caveats(result, query).length);
    setStatus(`Scored ${results.length} ${results.length === 1 ? 'place' : 'places'}, best first. Hover the colored bar for each hour.${starred ? ' * marks a score with a piece missing.' : ''}`);
  }

  // ---------- wiring ----------

  function syncActivity() {
    const activity = activitySelect.value;
    activityImage.src = `images/${activity}.jpg`;
    $('banner').style.setProperty('--hero', `url(images/${activity}.jpg)`);
    specificInput.value = '';
    $('location-names').replaceChildren();
    loadPlaces(activity).then((places) => {
      if (activitySelect.value !== activity) return;
      // a suggestion list of every golf course in the country would be unusable
      const names = [...new Set(places.map((p) => p.name))].sort();
      if (names.length <= MAX_SUGGESTIONS) {
        $('location-names').replaceChildren(...names.map((name) => el('option', { value: name })));
      }
    }).catch((error) => setStatus(error.message, true));
  }

  // Suggestions go to a pre-filled GitHub issue. A workflow in the repository then
  // files each one into recommendations.md for review.
  const SUGGEST_URL = 'https://github.com/thoyt3/TheWellerthermen/issues/new';

  function initSuggestions() {
    const activityNames = { golf: 'Golf', hiking: 'Hiking', scuba_diving: 'Scuba diving', surfing: 'Surfing' };
    $('suggest').addEventListener('toggle', () => {
      $('suggest-activity').value = activityNames[activitySelect.value] || 'General';
    });
    $('suggest-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const place = $('suggest-place').value.trim();
      const kind = $('suggest-kind').value;
      const params = new URLSearchParams({
        template: 'suggestion.yml',
        title: `[Suggestion] ${kind}${place ? `: ${place}` : ''}`,
        kind,
        activity: $('suggest-activity').value,
        place,
        details: $('suggest-details').value.trim(),
      });
      window.open(`${SUGGEST_URL}?${params}`, '_blank', 'noopener');
    });
  }

  function init() {
    initSuggestions();
    const today = new Date();
    const last = new Date();
    last.setDate(today.getDate() + FORECAST_DAYS);
    dateSelect.min = localDateStr(today);
    dateSelect.max = localDateStr(last);
    dateSelect.value = localDateStr(today);

    const prefs = loadPrefs();
    if (prefs.activity && ACTIVITIES[prefs.activity]) activitySelect.value = prefs.activity;
    if (prefs.place) placeInput.value = prefs.place;
    if (prefs.units) unitsSelect.value = prefs.units;
    if (prefs.distance) distanceInput.value = prefs.distance;
    $('distance-unit').textContent = imperial() ? 'mi' : 'km';
    syncActivity();

    activitySelect.addEventListener('change', syncActivity);

    unitsSelect.addEventListener('change', () => {
      $('distance-unit').textContent = imperial() ? 'mi' : 'km';
      if (resultsDiv.childElementCount) form.requestSubmit();
    });

    locateButton.addEventListener('click', async () => {
      setStatus('Getting your location...');
      try {
        geoOrigin = await browserPosition();
        placeInput.value = MY_LOCATION;
        setStatus('Got it.');
      } catch (error) {
        setStatus(`${error.message} Type a town instead.`, true);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      savePrefs();
      try {
        await runQuery();
      } catch (error) {
        console.error(error);
        setStatus(error.message || 'Something went wrong. Please try again.', true);
      } finally {
        submitButton.disabled = false;
      }
    });

  }

  init();
})();
