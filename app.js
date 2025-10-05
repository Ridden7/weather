const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const cors = require("cors");

const app = express();
app.use(cors());

// --- Fonction probabilité météo ---
function calculateWeatherProbability(temperature, humidity, precipitation, latitude, month) {
  let wetProbability = 0;
  let hotProbability = 0;
  let coldProbability = 0;
  let uncomfortableProbability = 0;

  if (temperature >= 35) hotProbability = 90;
  else if (temperature >= 32) hotProbability = 70;
  else if (temperature >= 30) hotProbability = 50;

  if (temperature <= -5) coldProbability = 90;
  else if (temperature <= 0) coldProbability = 70;
  else if (temperature <= 5) coldProbability = 50;

  if (temperature >= 32 && humidity >= 60) uncomfortableProbability = 90;
  else if (temperature >= 28 && humidity >= 70) uncomfortableProbability = 75;
  else if (temperature >= 25 && humidity >= 60) uncomfortableProbability = 50;

  if (precipitation >= 15) wetProbability += 85;
  else if (precipitation >= 5) wetProbability += 50;
  else if (precipitation >= 1) wetProbability += 20;

  if (month >= 10 || month <= 3) {
    if (latitude > 0) wetProbability += 15;
  } else {
    if (latitude <= 0) wetProbability += 15;
  }

  return {
    hotProbability: Math.min(hotProbability, 95),
    coldProbability: Math.min(coldProbability, 95),
    wetProbability: Math.min(wetProbability, 95),
    uncomfortableProbability: Math.min(uncomfortableProbability, 95),
  };
}

// --- Endpoint principal ---
app.get("/weather", async (req, res) => {
  const { lat, lon, date } = req.query;

  if (!date || !lat || !lon) {
    return res.status(400).json({ error: "Date, latitude, and longitude are required" });
  }

  try {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    const targetDate = new Date(date);
    const month = targetDate.getMonth() + 1;

    let locationName;
    try {
      const geoResponse = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
        { headers: { "User-Agent": "NASA-Weather-App/1.0" } }
      );
      const geoData = await geoResponse.json();
      locationName = geoData.display_name || `Location (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`;
    } catch {
      locationName = `Location (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`;
    }

    // --- Fenêtre de 15 jours autour de la même date l'année précédente ---
    const targetDatePreviousYear = new Date(targetDate);
    targetDatePreviousYear.setFullYear(targetDate.getFullYear() - 1);

    const startDate = new Date(targetDatePreviousYear);
    startDate.setDate(startDate.getDate() - 7);
    const endDate = new Date(targetDatePreviousYear);
    endDate.setDate(endDate.getDate() + 7);

    const formatDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);

    const nasaUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M,RH2M&community=AG&longitude=${longitude}&latitude=${latitude}&start=${formattedStartDate}&end=${formattedEndDate}&format=JSON`;

    const nasaResponse = await fetch(nasaUrl);
    if (!nasaResponse.ok) throw new Error(`NASA API error: ${nasaResponse.status}`);
    const nasaData = await nasaResponse.json();

    if (!nasaData.properties || !nasaData.properties.parameter) {
      return res.status(404).json({ error: "No weather data available for this location" });
    }

    const params = nasaData.properties.parameter;
    const dates = Object.keys(params.PRECTOTCORR || {}).sort();

    let totalRain = 0, totalTemp = 0, totalHumidity = 0, validDayCount = 0;
    const dailyData = [];

    dates.forEach(d => {
      const temp = params.T2M[d];
      const rh = params.RH2M[d];
      const rain = params.PRECTOTCORR[d];

      if (temp !== -999 && rh !== -999 && rain !== -999) {
        totalTemp += temp;
        totalHumidity += rh;
        totalRain += rain;
        validDayCount++;

        const dayProb = calculateWeatherProbability(temp, rh, rain, latitude, month);
        dailyData.push({
          date: d,
          temperature: temp,
          humidity: rh,
          rain,
          veryHotProbability: Math.round(dayProb.hotProbability),
          veryColdProbability: Math.round(dayProb.coldProbability),
          veryWetProbability: Math.round(dayProb.wetProbability),
          veryUncomfortableProbability: Math.round(dayProb.uncomfortableProbability),
        });
      }
    });

    if (validDayCount === 0) {
      return res.status(404).json({ error: "No valid weather data found for the selected period" });
    }

    const meanRain = totalRain / validDayCount;
    const meanTemperature = totalTemp / validDayCount;
    const meanHumidity = totalHumidity / validDayCount;

    const probabilityResults = calculateWeatherProbability(meanTemperature, meanHumidity, meanRain, latitude, month);
    const referencePeriod = `${formattedStartDate} to ${formattedEndDate}`;

    res.json({
      location: locationName,
      latitude,
      longitude,
      reference_period: referencePeriod,
      reference_days_used: validDayCount,
      mean_rain_mm: parseFloat(meanRain.toFixed(2)),
      mean_temperature_C: parseFloat(meanTemperature.toFixed(1)),
      mean_humidity_percent: parseFloat(meanHumidity.toFixed(1)),
      veryHotProbability: Math.round(probabilityResults.hotProbability),
      veryColdProbability: Math.round(probabilityResults.coldProbability),
      veryWetProbability: Math.round(probabilityResults.wetProbability),
      veryUncomfortableProbability: Math.round(probabilityResults.uncomfortableProbability),
      daily: dailyData, // ✅ ajout du détail jour par jour
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Error fetching weather data", details: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
