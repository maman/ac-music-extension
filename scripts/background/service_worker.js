'use strict';

importScripts('KKSongs.js');
importScripts('../global/weather_api.js');

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const HOURLY_ALARM = 'hourly-change';
const WEATHER_ALARM = 'weather-refresh';
const DEFAULT_TOWN_TUNE = ['C3', 'E3', 'C3', 'G2', 'F2', 'G2', 'B2', 'D3', 'C3', 'zZz', '?', 'zZz', 'C3', '-', '-', 'zZz'];
const DEFAULT_OPTIONS = {
	volume: 0.5,
	music: 'new-horizons',
	weather: 'sunny',
	enableNotifications: true,
	enableKK: true,
	alwaysKK: false,
	kkVersion: 'live',
	paused: false,
	enableTownTune: true,
	absoluteTownTune: false,
	townTune: DEFAULT_TOWN_TUNE,
	townTuneVolume: 0.75,
	latitude: '',
	longitude: '',
	enableBadgeText: true,
	tabAudio: 'pause',
	enableBackground: false,
	tabAudioReduceValue: 80,
	kkSelectedSongsEnable: false,
	kkSelectedSongs: []
};

const state = {
	options: { ...DEFAULT_OPTIONS },
	currentWeather: null,
	currentMode: 'paused',
	badgeText: '',
	badgeIcon: 'paused',
	isTabAudible: false,
	tabAudioPaused: false,
	autoPausedForClosedWindows: false,
	initialized: false,
	initializing: null,
	offscreenReady: false,
	creatingOffscreen: null
};

chrome.runtime.onInstalled.addListener(() => {
	void initialize({ resumePlayback: true });
});

chrome.runtime.onStartup.addListener(() => {
	void initialize({ resumePlayback: true });
});

chrome.action.onClicked.addListener(() => {
	void toggleMusic();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'sync') return;
	void handleStorageChange(changes);
});

chrome.alarms.onAlarm.addListener((alarm) => {
	void handleAlarm(alarm);
});

chrome.tabs.onCreated.addListener(() => {
	void handleTabOrWindowChange();
});

chrome.tabs.onRemoved.addListener(() => {
	void handleTabOrWindowChange();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
	if (!('audible' in changeInfo) && !('mutedInfo' in changeInfo) && !('status' in changeInfo)) return;
	void handleTabOrWindowChange();
});

chrome.windows.onCreated.addListener(() => {
	void handleTabOrWindowChange();
});

chrome.windows.onRemoved.addListener(() => {
	void handleTabOrWindowChange();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || !message.type) return false;
	if (message.target === 'offscreen') return false;

	void handleRuntimeMessage(message)
		.then((result) => sendResponse(result || { ok: true }))
		.catch((error) => {
			console.error(error);
			sendResponse({ ok: false, error: String(error) });
		});

	return true;
});

void initialize({ resumePlayback: false });

async function initialize({ resumePlayback = false } = {}) {
	if (state.initialized) {
		if (resumePlayback && !state.options.paused && !state.autoPausedForClosedWindows) {
			await activatePlayback({ reason: 'resume' });
		}
		return;
	}

	if (state.initializing) {
		await state.initializing;
		if (resumePlayback && !state.options.paused && !state.autoPausedForClosedWindows) {
			await activatePlayback({ reason: 'resume' });
		}
		return;
	}

	state.initializing = (async () => {
		state.options = await chrome.storage.sync.get(DEFAULT_OPTIONS);
		state.initialized = true;

		await scheduleHourlyAlarm();
		await ensureWeatherAlarm();

		if (state.options.weather === 'live') {
			await refreshWeather({ notifyChange: false });
		}

		await refreshAudibleTabs({ notifyOffscreen: false });
		await reconcileWindowPlayback();
		syncCurrentModeFromClock();
		updateActionUi();
	})().finally(() => {
		state.initializing = null;
	});

	await state.initializing;

	if (resumePlayback && !state.options.paused && !state.autoPausedForClosedWindows) {
		await activatePlayback({ reason: 'startup' });
	}
}

async function ensureInitialized() {
	await initialize({ resumePlayback: false });
}

async function handleStorageChange(changes) {
	await ensureInitialized();

	const previousOptions = state.options;
	state.options = await chrome.storage.sync.get(DEFAULT_OPTIONS);

	if (
		'latitude' in changes ||
		'longitude' in changes ||
		'weather' in changes
	) {
		if (state.options.weather === 'live') {
			await refreshWeather({ notifyChange: false });
		} else {
			state.currentWeather = null;
		}
	}

	if ('enableBackground' in changes) {
		await reconcileWindowPlayback();
	}

	if ('paused' in changes) {
		state.tabAudioPaused = false;

		if (state.options.paused) {
			state.currentMode = 'paused';
			await pausePlayback();
			updateActionUi();
			return;
		}

		if (!state.autoPausedForClosedWindows) {
			await activatePlayback({ reason: 'manual-unpause' });
		}
		return;
	}

	if (
		'volume' in changes ||
		'tabAudio' in changes ||
		'tabAudioReduceValue' in changes ||
		'enableTownTune' in changes ||
		'absoluteTownTune' in changes ||
		'townTune' in changes ||
		'townTuneVolume' in changes ||
		'kkSelectedSongsEnable' in changes ||
		'kkSelectedSongs' in changes ||
		'kkVersion' in changes
	) {
		await updateOffscreenOptions();
	}

	const kkChanged =
		'alwaysKK' in changes ||
		'enableKK' in changes ||
		'kkVersion' in changes ||
		'kkSelectedSongsEnable' in changes ||
		'kkSelectedSongs' in changes;
	const hourlyChanged = 'music' in changes || 'weather' in changes;
	const weatherSettingsChanged =
		'latitude' in changes ||
		'longitude' in changes ||
		'weather' in changes;
	const shouldReactivate = !state.options.paused && !state.autoPausedForClosedWindows && (kkChanged || hourlyChanged);

	if (shouldReactivate) {
		await activatePlayback({ reason: 'options-change' });
	} else if ('enableBadgeText' in changes) {
		updateActionUi();
	}

	if (weatherSettingsChanged && !shouldReactivate) {
		if (!state.options.paused && !isKKTime(new Date())) {
			await activatePlayback({ reason: 'weather-settings-change' });
		}
	}

	if (
		previousOptions.enableBackground &&
		!state.options.enableBackground &&
		state.autoPausedForClosedWindows
	) {
		updateActionUi();
	}
}

async function handleAlarm(alarm) {
	await ensureInitialized();

	if (alarm.name === HOURLY_ALARM) {
		await scheduleHourlyAlarm();

		if (state.options.weather === 'live') {
			await refreshWeather({ notifyChange: false });
		}

		if (state.options.paused || state.autoPausedForClosedWindows) {
			if (!isKKTime(new Date()) && state.options.absoluteTownTune && state.options.enableTownTune) {
				await ensureOffscreenDocument();
				await sendToOffscreen({
					type: 'play-town-tune',
					playback: getPlaybackState()
				});
			}
			return;
		}

		await activatePlayback({ reason: 'hour-change', isHourChange: true });

		if (!isKKTime(new Date())) {
			const data = getMusicAndWeather(new Date());
			if (data.weather) {
				notifyHourChange(new Date().getHours(), data.weather);
			}
		}
		return;
	}

	if (alarm.name === WEATHER_ALARM && state.options.weather === 'live') {
		await refreshWeather({ notifyChange: true });
	}
}

async function handleTabOrWindowChange() {
	await ensureInitialized();
	await refreshAudibleTabs({ notifyOffscreen: true });
	await reconcileWindowPlayback();
}

async function handleRuntimeMessage(message) {
	await ensureInitialized();

	switch (message.type) {
		case 'offscreen-ready':
			state.offscreenReady = true;
			await sendToOffscreen({
				type: 'update-options',
				playback: getPlaybackState()
			});
			return { ok: true };

		case 'kk-music':
			notifyKkTrack(message.title);
			return { ok: true };

		case 'music-failed':
			setBadgeText('x', [230, 0, 0, 255]);
			return { ok: true };

		case 'pause':
			if (message.tabPaused) {
				state.tabAudioPaused = true;
				updateActionUi();
			} else if (!state.options.paused && !state.autoPausedForClosedWindows) {
				state.currentMode = 'paused';
				state.tabAudioPaused = false;
				updateActionUi();
				await chrome.storage.sync.set({ paused: true });
			}
			return { ok: true };

		case 'unpause':
			state.tabAudioPaused = false;
			updateActionUi();
			return { ok: true };

		case 'toggle-playback':
			await toggleMusic();
			return { ok: true };

		case 'town-tune-complete':
			if (state.options.paused || state.autoPausedForClosedWindows) {
				await shutdownOffscreenDocument();
			}
			return { ok: true };

		default:
			return { ok: false, error: `Unhandled message: ${message.type}` };
	}
}

async function toggleMusic() {
	await ensureInitialized();
	state.autoPausedForClosedWindows = false;
	await chrome.storage.sync.set({ paused: !state.options.paused });
}

async function activatePlayback({ reason, isHourChange = false } = {}) {
	await ensureInitialized();

	if (state.options.paused) {
		state.currentMode = 'paused';
		updateActionUi();
		return;
	}

	if (await shouldPauseForClosedWindows()) {
		state.autoPausedForClosedWindows = true;
		await pausePlayback();
		updateActionUi();
		return;
	}

	state.autoPausedForClosedWindows = false;

	if (isKKTime(new Date())) {
		state.currentMode = 'kk';
		state.badgeText = 'KK';
		state.badgeIcon = 'kk';
		updateActionUi();
		await ensureOffscreenDocument();
		await sendToOffscreen({
			type: 'play-kk',
			playback: getPlaybackState()
		});
		return;
	}

	const data = getMusicAndWeather(new Date());
	if (!data.weather) return;

	state.currentMode = 'hourly';
	state.badgeText = formatHour(data.hour);
	state.badgeIcon = data.weather;
	updateActionUi();
	await ensureOffscreenDocument();
	await sendToOffscreen({
		type: 'play-hourly',
		reason,
		isHourChange,
		hour: data.hour,
		weather: data.weather,
		game: data.music,
		playback: getPlaybackState()
	});
}

async function pausePlayback() {
	await sendToOffscreen({
		type: 'pause',
		playback: getPlaybackState()
	});
	await shutdownOffscreenDocument();
}

async function updateOffscreenOptions() {
	if (!(await hasOffscreenDocument())) return;

	await sendToOffscreen({
		type: 'update-options',
		playback: getPlaybackState()
	});

	await sendToOffscreen({
		type: 'set-tab-audio-state',
		playback: getPlaybackState()
	});
}

async function refreshAudibleTabs({ notifyOffscreen } = { notifyOffscreen: true }) {
	const tabs = await chrome.tabs.query({ audible: true });
	state.isTabAudible = tabs.some((tab) => !(tab.mutedInfo && tab.mutedInfo.muted));

	if (notifyOffscreen && (await hasOffscreenDocument())) {
		await sendToOffscreen({
			type: 'set-tab-audio-state',
			playback: getPlaybackState()
		});
	}
}

async function reconcileWindowPlayback() {
	const shouldPause = await shouldPauseForClosedWindows();

	if (shouldPause) {
		if (!state.autoPausedForClosedWindows && !state.options.paused) {
			state.autoPausedForClosedWindows = true;
			await pausePlayback();
		}
		updateActionUi();
		return;
	}

	if (state.autoPausedForClosedWindows) {
		state.autoPausedForClosedWindows = false;
		if (!state.options.paused) {
			await activatePlayback({ reason: 'windows-restored' });
		}
	}
}

async function refreshWeather({ notifyChange } = { notifyChange: false }) {
	const previousWeather = state.currentWeather;
	const nextWeather = await fetchWeather();

	if (nextWeather == null) return;

	state.currentWeather = nextWeather;

	if (
		notifyChange &&
		previousWeather != null &&
		previousWeather !== nextWeather &&
		state.options.weather === 'live' &&
		!state.options.paused &&
		!state.autoPausedForClosedWindows &&
		!isKKTime(new Date())
	) {
		await activatePlayback({ reason: 'weather-change' });
		notifyWeatherChange(nextWeather);
	}
}

async function fetchWeather() {
	const latitude = normalizeCoordinate(state.options.latitude);
	const longitude = normalizeCoordinate(state.options.longitude);

	if (latitude == null || longitude == null) {
		console.warn('Weather fetch skipped because latitude/longitude is missing or invalid');
		return state.currentWeather != null ? state.currentWeather : 0;
	}

	const url = buildOpenMeteoWeatherUrl(latitude, longitude);

	try {
		const response = await fetch(url, { cache: 'no-store' });
		if (!response.ok) throw new Error(`Weather request failed with ${response.status}`);

		const payload = await response.json();
		const weatherCode = payload.current && payload.current.weather_code;
		if (typeof weatherCode !== 'number') throw new Error('Weather response missing current.weather_code');
		return weatherCode;
	} catch (error) {
		console.warn('Weather fetch failed', error);
		return state.currentWeather != null ? state.currentWeather : 0;
	}
}

async function scheduleHourlyAlarm() {
	const nextHour = new Date();
	nextHour.setMinutes(0, 0, 0);
	nextHour.setHours(nextHour.getHours() + 1);

	await chrome.alarms.create(HOURLY_ALARM, { when: nextHour.getTime() });
}

async function ensureWeatherAlarm() {
	if (state.options.weather !== 'live') {
		await chrome.alarms.clear(WEATHER_ALARM);
		return;
	}

	await chrome.alarms.create(WEATHER_ALARM, { periodInMinutes: 10 });
}

async function shouldPauseForClosedWindows() {
	if (await canPlayWithoutWindows()) return false;

	const windows = await chrome.windows.getAll();
	return windows.length === 0;
}

async function canPlayWithoutWindows() {
	if (!state.options.enableBackground) return false;
	return chrome.permissions.contains({ permissions: ['background'] });
}

function getMusicAndWeather(now) {
	let music = state.options.music;
	if (music === 'game-random') {
		const games = ['animal-crossing', 'wild-world', 'new-leaf', 'new-horizons'];
		music = games[Math.floor(Math.random() * games.length)];
	}

	let weather = state.options.weather;
	if (weather === 'live') {
		if (state.currentWeather == null) return { hour: now.getHours(), music, weather: null };
		weather = mapOpenMeteoWeatherCode(state.currentWeather);
	} else if (weather === 'weather-random') {
		const weatherOptions = ['sunny', 'raining', 'snowing'];
		weather = weatherOptions[Math.floor(Math.random() * weatherOptions.length)];
	}

	if (weather === 'raining' && music === 'animal-crossing') {
		weather = 'snowing';
	}

	return {
		hour: now.getHours(),
		music,
		weather
	};
}

function isKKTime(now) {
	return state.options.alwaysKK || (state.options.enableKK && now.getDay() === 6 && now.getHours() >= 20);
}

function getPlaybackState() {
	return {
		...state.options,
		isTabAudible: state.isTabAudible,
		tabAudioPaused: state.tabAudioPaused
	};
}

function syncCurrentModeFromClock() {
	if (state.options.paused || state.autoPausedForClosedWindows) {
		state.currentMode = 'paused';
		return;
	}

	if (isKKTime(new Date())) {
		state.currentMode = 'kk';
		state.badgeText = 'KK';
		state.badgeIcon = 'kk';
		return;
	}

	const data = getMusicAndWeather(new Date());
	if (!data.weather) {
		state.currentMode = 'paused';
		return;
	}

	state.currentMode = 'hourly';
	state.badgeText = formatHour(data.hour);
	state.badgeIcon = data.weather;
}

async function ensureOffscreenDocument() {
	if (await hasOffscreenDocument()) return;

	if (state.creatingOffscreen) {
		await state.creatingOffscreen;
		return;
	}

	state.creatingOffscreen = chrome.offscreen.createDocument({
		url: OFFSCREEN_DOCUMENT_PATH,
		reasons: ['AUDIO_PLAYBACK'],
		justification: 'Play hourly music and town tunes for the extension.'
	}).finally(() => {
		state.creatingOffscreen = null;
	});

	await state.creatingOffscreen;
	state.offscreenReady = false;
}

async function shutdownOffscreenDocument() {
	if (!(await hasOffscreenDocument())) return;

	try {
		await sendToOffscreen({ type: 'shutdown' });
	} catch (error) {
		console.warn('Failed to notify offscreen document before shutdown', error);
	}

	await chrome.offscreen.closeDocument();
	state.offscreenReady = false;
}

async function hasOffscreenDocument() {
	const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

	if (chrome.runtime.getContexts) {
		const contexts = await chrome.runtime.getContexts({
			contextTypes: ['OFFSCREEN_DOCUMENT'],
			documentUrls: [offscreenUrl]
		});

		return contexts.length > 0;
	}

	const matchedClients = await clients.matchAll({
		includeUncontrolled: true,
		type: 'window'
	});

	return matchedClients.some((client) => client.url === offscreenUrl);
}

async function sendToOffscreen(message) {
	if (!(await hasOffscreenDocument())) return;

	try {
		await chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
	} catch (error) {
		console.warn('Failed to send message to offscreen document', error);
	}
}

function updateActionUi() {
	if (state.currentMode === 'paused') {
		chrome.action.setIcon({ path: iconPaths('paused') });
		setBadgeText(state.tabAudioPaused ? 'll' : '');
		return;
	}

	if (state.tabAudioPaused) {
		chrome.action.setIcon({ path: iconPaths('paused') });
		setBadgeText('ll');
		return;
	}

	chrome.action.setIcon({ path: iconPaths(state.badgeIcon) });
	setBadgeText(state.options.enableBadgeText ? state.badgeText : '');
}

function setBadgeText(text, color = [57, 230, 0, 255]) {
	chrome.action.setBadgeText({ text });
	chrome.action.setBadgeBackgroundColor({ color });
}

function iconPaths(icon) {
	if (icon === 'kk') {
		return {
			128: chrome.runtime.getURL('img/icons/kk/128.png'),
			64: chrome.runtime.getURL('img/icons/kk/64.png'),
			32: chrome.runtime.getURL('img/icons/kk/32.png')
		};
	}

	return {
		128: chrome.runtime.getURL(`img/icons/status/${icon}/128.png`),
		64: chrome.runtime.getURL(`img/icons/status/${icon}/64.png`),
		32: chrome.runtime.getURL(`img/icons/status/${icon}/32.png`)
	};
}

function notifyHourChange(hour, weather) {
	if (!state.options.enableNotifications) return;

	createNotification(`It is now ${formatHour(hour)} and ${weather}`);
}

function notifyWeatherChange(weather) {
	if (!state.options.enableNotifications) return;

	createNotification(`It is now ${describeOpenMeteoWeatherCode(weather).toLowerCase()}`);
}

function notifyKkTrack(title) {
	if (!state.options.enableNotifications) return;

	createNotification(`K.K. Slider is now playing ${title}`, 'kk');
}

function createNotification(message, icon = 'clock') {
	chrome.notifications.create('animal-crossing-music', {
		type: 'basic',
		title: 'Animal Crossing Music',
		iconUrl: chrome.runtime.getURL(`img/${icon}.png`),
		silent: true,
		message
	});
}

function formatHour(time) {
	if (time === 0) return '12am';
	if (time === 12) return '12pm';
	if (time < 12) return `${time}am`;
	return `${time - 12}pm`;
}
