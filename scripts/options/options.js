'use strict';

const onClickElements = [
	'animal-crossing',
	'wild-world',
	'new-leaf',
	'new-horizons',
	'game-random',
	'sunny',
	'snowing',
	'raining',
	'live',
	'weather-random',
	'no-kk',
	'enable-kk',
	'always-kk',
	'enable-town-tune',
	'absolute-town-tune',
	'enable-notifications',
	'enable-badge',
	'kk-version-live',
	'kk-version-aircheck',
	'kk-version-both',
	'tab-audio-nothing',
	'tab-audio-reduce',
	'tab-audio-pause',
	'kk-songs-selection-enable'
];

const exclamationElements = [
	'live-weather-location-link',
	'town-tune-button-link'
]

// Formats an integer to percentage
function formatPercentage(number) {
	number = parseInt(number)
	if (number <= 0) return '0%'
	else if (number >= 100) return '100%'
	else if (number < 10) return `0${number}%`
	else return `${number}%`
}

function containsSpace(string) {
	return (string.indexOf(' ') >= 0);
}


window.onload = function () {
	restoreOptions();
	document.getElementById('version-number').textContent = 'Version ' + chrome.runtime.getManifest().version;
	document.getElementById('volume').onchange = saveOptions;
	document.getElementById('volume').oninput = function() {
		let volumeText = document.getElementById('volumeText');
		volumeText.innerHTML = `${formatPercentage(this.value*100)}`;
	};
	document.getElementById('townTuneVolume').onchange = saveOptions; // Maybe disable as to only save when clicking "save" button
	document.getElementById('townTuneVolume').oninput = function() {
		let ttVolumeText = document.getElementById('townTuneVolumeText');
		ttVolumeText.innerHTML = `${formatPercentage(this.value*100)}`;
	};

	onClickElements.forEach(el => {
		document.getElementById(el).onclick = saveOptions;
	});
	document.getElementById('update-location').onclick = validateWeather;
	document.getElementById('use-browser-location').onclick = useBrowserLocation;
	document.getElementById('tab-audio-reduce-value').onchange = saveOptions;

	exclamationElements.forEach(el => {
		document.getElementById(el).onclick = () => {
			let element = document.getElementById(el.split('-link')[0]);
			element.style.animation = 'scrolled 1s';
			element.onanimationend = () => element.style.animation = null;
		}
	});

	let enableBackgroundEl = document.getElementById('enable-background');
	enableBackgroundEl.onclick = () => {
		chrome.permissions.contains({ permissions: ['background'] }, hasPerms => {
			if (enableBackgroundEl.checked) {
				if (hasPerms) saveOptions();
				else {
					chrome.permissions.request({ permissions: ['background'] }, granted => {
						if (granted) saveOptions();
						else {
							enableBackgroundEl.checked = false;
							saveOptions();
						}
					});
				}
			} else if (hasPerms) {
				chrome.permissions.remove({ permissions: ['background'] }, () => saveOptions());
			} else saveOptions();
		});
	}

	document.getElementById('kk-songs-selection-enable').onchange = saveOptions;
	document.getElementById('kk-songs-selection').onchange = saveOptions;

	const kkSongsSelect = document.getElementById('kk-songs-selection');
	KKSongList.forEach((song) => {
		const songOption = document.createElement('option');
		songOption.text = song;
		songOption.value = song;
		kkSongsSelect.appendChild(songOption);
	});

	updateContributors();
}

function saveOptions() {
	let volume = document.getElementById('volume').value;
	let enableNotifications = document.getElementById('enable-notifications').checked;
	// 2 separate KK variables to preserve compatibility with old versions
	let alwaysKK = document.getElementById('always-kk').checked;
	let enableKK = alwaysKK || document.getElementById('enable-kk').checked;
	let enableTownTune = document.getElementById('enable-town-tune').checked;
	let absoluteTownTune = document.getElementById('absolute-town-tune').checked;
	let townTuneVolume   = document.getElementById('townTuneVolume').value;
	let latitude = document.getElementById('latitude').value.trim();
	let longitude = document.getElementById('longitude').value.trim();
	let enableBadgeText = document.getElementById('enable-badge').checked;
	let enableBackground = document.getElementById('enable-background').checked;
	let tabAudioReduceValue = document.getElementById('tab-audio-reduce-value').value;
	let kkSelectedSongsEnable = document.getElementById('kk-songs-selection-enable').checked;
	let kkSelectedSongs = Array.from(document.getElementById('kk-songs-selection').selectedOptions).map(option => option.value);

	if (tabAudioReduceValue > 100) {
		document.getElementById('tab-audio-reduce-value').value = 100;
		tabAudioReduceValue = 100;
	}
	if (tabAudioReduceValue < 0) {
		document.getElementById('tab-audio-reduce-value').value = 0;
		tabAudioReduceValue = 0;
	}

	let music;
	let weather;
	if (document.getElementById('animal-crossing').checked) music = 'animal-crossing';
	else if (document.getElementById('wild-world').checked) music = 'wild-world';
	else if (document.getElementById('new-leaf').checked) music = 'new-leaf';
	else if (document.getElementById('new-horizons').checked) music = 'new-horizons';
	else if (document.getElementById('game-random').checked) music = 'game-random';

	if (document.getElementById('sunny').checked) weather = 'sunny';
	else if (document.getElementById('snowing').checked) weather = 'snowing';
	else if (document.getElementById('raining').checked) weather = 'raining';
	else if (document.getElementById('live').checked) weather = 'live';
	else if (document.getElementById('weather-random').checked) weather = 'weather-random';

	let kkVersion;
	if (document.getElementById('kk-version-live').checked) kkVersion = 'live';
	else if (document.getElementById('kk-version-aircheck').checked) kkVersion = 'aircheck';
	else if (document.getElementById('kk-version-both').checked) kkVersion = 'both';

	let tabAudio;
	if (document.getElementById('tab-audio-reduce').checked) tabAudio = 'reduce';
	else if (document.getElementById('tab-audio-pause').checked) tabAudio = 'pause';
	else if (document.getElementById('tab-audio-nothing').checked) tabAudio = 'nothing';

	document.getElementById('raining').disabled = music == 'animal-crossing';
	document.getElementById('absolute-town-tune').disabled = !enableTownTune;

	let enabledKKVersion = !(document.getElementById('always-kk').checked || document.getElementById('enable-kk').checked);

	document.getElementById('music-selection').querySelectorAll('input').forEach(updateChildrenState.bind(null, alwaysKK));

	document.getElementById('weather-selection').querySelectorAll('input').forEach(updateChildrenState.bind(null, alwaysKK))

	document.getElementById('kk-version-selection').querySelectorAll('input').forEach(updateChildrenState.bind(null, enabledKKVersion));

	document.getElementById('kk-songs-selection').disabled = !kkSelectedSongsEnable;

	chrome.storage.sync.set({
		volume,
		music,
		weather,
		enableNotifications,
		enableKK,
		alwaysKK,
		kkVersion,
		enableTownTune,
		absoluteTownTune,
		townTuneVolume,
		latitude,
		longitude,
		enableBadgeText,
		enableBackground,
		tabAudio,
		tabAudioReduceValue,
		kkSelectedSongsEnable,
		kkSelectedSongs
	});
}

function restoreOptions() {
	chrome.storage.sync.get({
		volume: 0.5,
		music: 'new-horizons',
		weather: 'sunny',
		enableNotifications: true,
		enableKK: true,
		alwaysKK: false,
		kkVersion: 'live',
		enableTownTune: true,
		absoluteTownTune: false,
		townTuneVolume: 0.75,
		latitude: '',
		longitude: '',
		enableBadgeText: true,
		tabAudio: 'pause',
		enableBackground: false,
		tabAudioReduceValue: 80,
		kkSelectedSongsEnable: false,
		kkSelectedSongs: []
	}, items => {
		document.getElementById('volume').value = items.volume;
		document.getElementById('volumeText').innerHTML = `${formatPercentage(items.volume*100)}`;
		document.getElementById(items.music).checked = true;
		document.getElementById(items.weather).checked = true;
		document.getElementById('enable-notifications').checked = items.enableNotifications;
		document.getElementById('no-kk').checked = true;
		document.getElementById('enable-kk').checked = items.enableKK;
		document.getElementById('always-kk').checked = items.alwaysKK;
		document.getElementById('kk-version-' + items.kkVersion).checked = true;
		document.getElementById('enable-town-tune').checked = items.enableTownTune;
		document.getElementById('absolute-town-tune').checked = items.absoluteTownTune;
		document.getElementById('townTuneVolume').value = items.townTuneVolume;
		document.getElementById('townTuneVolumeText').innerHTML = `${formatPercentage(items.townTuneVolume*100)}`;
		document.getElementById('latitude').value = items.latitude;
		document.getElementById('longitude').value = items.longitude;
		document.getElementById('enable-badge').checked = items.enableBadgeText;
		document.getElementById('tab-audio-' + items.tabAudio).checked = true;
		document.getElementById('tab-audio-reduce-value').value = items.tabAudioReduceValue;
		document.getElementById('kk-songs-selection-enable').checked = items.kkSelectedSongsEnable;

		// Disable raining if the game is animal crossing, since there is no raining music for animal crossing.
		document.getElementById('raining').disabled = items.music == 'animal-crossing';
		document.getElementById('absolute-town-tune').disabled = !items.enableTownTune;

		let enabledKKVersion = !(items.alwaysKK || items.enableKK);

		document.getElementById('music-selection').querySelectorAll('input').forEach(updateChildrenState.bind(null, items.alwaysKK));
		document.getElementById('weather-selection').querySelectorAll('input').forEach(updateChildrenState.bind(null, items.alwaysKK));
		document.getElementById('kk-version-selection').querySelectorAll('input').forEach(updateChildrenState.bind(null, enabledKKVersion));

		const kkSongsSelect = document.getElementById('kk-songs-selection');
		kkSongsSelect.disabled = !items.kkSelectedSongsEnable;

		items.kkSelectedSongs.forEach((song) => {
			const songIndex = Array.from(kkSongsSelect.options).findIndex((option, idx) => {
				return option.value === song ? String(idx) : false; // Why String()?: if idx is 0, the function returns -1
			});
			kkSongsSelect.options[songIndex].selected = 'selected';
		});

		chrome.permissions.contains({ permissions: ['background'] }, hasPerms => {
			const enableBackground = items.enableBackground && hasPerms;
			document.getElementById('enable-background').checked = enableBackground;

			if (items.enableBackground && !hasPerms) {
				chrome.storage.sync.set({ enableBackground: false });
			}
		});
	});

}

async function validateWeather() {
	let updateLocationEl = document.getElementById('update-location');
	updateLocationEl.textContent = "Validating...";
	updateLocationEl.disabled = true;

	let latitude = normalizeCoordinate(document.getElementById('latitude').value.trim());
	let longitude = normalizeCoordinate(document.getElementById('longitude').value.trim());
	if (latitude == null) {
		responseMessage('You must specify a valid latitude.');
		return;
	}
	if (longitude == null) {
		responseMessage('You must specify a valid longitude.');
		return;
	}

	try {
		let response = await fetch(buildOpenMeteoWeatherUrl(latitude, longitude), {
			cache: 'no-store'
		});
		if (!response.ok) {
			throw new Error(`Weather request failed with ${response.status}`);
		}

		let payload = await response.json();
		let weatherCode = payload.current && payload.current.weather_code;
		if (typeof weatherCode !== 'number') {
			throw new Error('Weather response missing current.weather_code');
		}

		document.getElementById('latitude').value = latitude;
		document.getElementById('longitude').value = longitude;
		responseMessage(`Success! Current weather is "${describeOpenMeteoWeatherCode(weatherCode)}"`, true);
	} catch (error) {
		responseMessage(error.message);
	}

	function responseMessage(message = 'An unknown error occurred', success = false) {
		let weatherResponseEl = document.getElementById('weather-response');
		if (success == true) {
			weatherResponseEl.style.color = "#39d462";
			saveOptions();
		} else weatherResponseEl.style.color = "#d43939";
		weatherResponseEl.textContent = message;

		updateLocationEl.textContent = "Update Location";
		updateLocationEl.disabled = false;
	}
}

function useBrowserLocation() {
	let browserLocationEl = document.getElementById('use-browser-location');
	let weatherResponseEl = document.getElementById('weather-response');

	if (!navigator.geolocation) {
		weatherResponseEl.style.color = "#d43939";
		weatherResponseEl.textContent = 'Browser geolocation is not available.';
		return;
	}

	browserLocationEl.textContent = 'Getting Location...';
	browserLocationEl.disabled = true;

	navigator.geolocation.getCurrentPosition((position) => {
		document.getElementById('latitude').value = position.coords.latitude.toFixed(6);
		document.getElementById('longitude').value = position.coords.longitude.toFixed(6);
		weatherResponseEl.textContent = '';
		browserLocationEl.textContent = 'Use Browser Location';
		browserLocationEl.disabled = false;
		void validateWeather();
	}, () => {
		weatherResponseEl.style.color = "#d43939";
		weatherResponseEl.textContent = 'Could not get your browser location.';
		browserLocationEl.textContent = 'Use Browser Location';
		browserLocationEl.disabled = false;
	}, {
		enableHighAccuracy: true,
		timeout: 10000
	});
}

function updateChildrenState(disabled, childElement){
	childElement.disabled = disabled
}
