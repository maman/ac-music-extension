'use strict';

function normalizeCoordinate(value) {
	const parsed = parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function buildOpenMeteoWeatherUrl(latitude, longitude) {
	const params = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		current: 'temperature_2m,weather_code',
		daily: 'sunrise,sunset',
		timezone: 'GMT',
		forecast_days: '1',
		temperature_unit: 'celsius'
	});

	return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function mapOpenMeteoWeatherCode(code) {
	if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snowing';
	if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return 'raining';
	return 'sunny';
}

function describeOpenMeteoWeatherCode(code) {
	const labels = {
		0: 'Clear sky',
		1: 'Mainly clear',
		2: 'Partly cloudy',
		3: 'Overcast',
		45: 'Fog',
		48: 'Depositing rime fog',
		51: 'Light drizzle',
		53: 'Moderate drizzle',
		55: 'Dense drizzle',
		56: 'Light freezing drizzle',
		57: 'Dense freezing drizzle',
		61: 'Slight rain',
		63: 'Moderate rain',
		65: 'Heavy rain',
		66: 'Light freezing rain',
		67: 'Heavy freezing rain',
		71: 'Slight snow fall',
		73: 'Moderate snow fall',
		75: 'Heavy snow fall',
		77: 'Snow grains',
		80: 'Slight rain showers',
		81: 'Moderate rain showers',
		82: 'Violent rain showers',
		85: 'Slight snow showers',
		86: 'Heavy snow showers',
		95: 'Thunderstorm',
		96: 'Thunderstorm with slight hail',
		99: 'Thunderstorm with heavy hail'
	};

	return labels[code] || `Weather code ${code}`;
}
