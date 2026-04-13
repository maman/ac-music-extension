'use strict';

const DEFAULT_TOWN_TUNE = ['C3', 'E3', 'C3', 'G2', 'F2', 'G2', 'B2', 'D3', 'C3', 'zZz', '?', 'zZz', 'C3', '-', '-', 'zZz'];
const DEFAULT_PLAYBACK = {
	volume: 0.5,
	enableTownTune: true,
	absoluteTownTune: false,
	townTune: DEFAULT_TOWN_TUNE,
	townTuneVolume: 0.75,
	tabAudio: 'pause',
	tabAudioReduceValue: 80,
	kkVersion: 'live',
	kkSelectedSongsEnable: false,
	kkSelectedSongs: [],
	isTabAudible: false
};

const playback = { ...DEFAULT_PLAYBACK };
const audio = document.createElement('audio');
const audioContext = new AudioContext();
const sampler = createSampler(audioContext);
const tunePlayer = createTunePlayer(audioContext);
const gameNames = {
	'animal-crossing': 'Animal Crossing',
	'wild-world': 'Animal Crossing: Wild World',
	'new-leaf': 'Animal Crossing: New Leaf',
	'new-horizons': 'Animal Crossing: New Horizons'
};

let currentMode = 'paused';
let currentHourTrack = null;
let currentLoopTime = null;
let currentObjectUrl = null;
let ignoreNextPauseEvent = false;
let loopTimeoutId = null;
let fadeIntervalId = null;
let townTunePlaying = false;
let tabAudioPaused = false;
let pausedDuringTownTune = false;
let currentKkVersion = 'live';
let mediaArtworkUrls = [];

audio.onpause = handlePauseEvent;
audio.onerror = () => {
	void sendToWorker({ type: 'music-failed' });
};
audio.onplay = () => {
	if (currentLoopTime) {
		scheduleLoop(currentLoopTime);
	}
};

setMediaSessionHandlers();
void sendToWorker({ type: 'offscreen-ready' });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (!message || !message.type) return false;
	if (message.target === 'worker') return false;

	void handleMessage(message)
		.then(() => sendResponse({ ok: true }))
		.catch((error) => {
			console.error(error);
			sendResponse({ ok: false, error: String(error) });
		});

	return true;
});

async function handleMessage(message) {
	switch (message.type) {
		case 'update-options':
			applyPlaybackState(message.playback);
			await applyTabAudioState();
			return;

		case 'set-tab-audio-state':
			applyPlaybackState(message.playback);
			await applyTabAudioState();
			return;

		case 'play-hourly':
			applyPlaybackState(message.playback);
			await playHourlyMusic(message);
			return;

		case 'play-kk':
			applyPlaybackState(message.playback);
			await playKkMusic();
			return;

		case 'play-town-tune':
			applyPlaybackState(message.playback);
			await playTownTuneOnly();
			return;

		case 'pause':
			applyPlaybackState(message.playback);
			await pauseAudio();
			currentMode = 'paused';
			return;

		case 'shutdown':
			await stopPlayback();
			return;

		default:
			return;
	}
}

function applyPlaybackState(nextPlayback = {}) {
	Object.assign(playback, nextPlayback);
}

async function playHourlyMusic({ hour, weather, game, isHourChange }) {
	currentMode = 'hourly';
	currentHourTrack = { hour, weather, game };
	clearLoop();
	await applyTabAudioState();

	const fadeLength = isHourChange ? 3000 : 500;
	await fadeOutAudio(fadeLength);

	if (isHourChange && playback.enableTownTune && !tabAudioPaused) {
		townTunePlaying = true;
		await playTownTune(playback.townTune, false);
		townTunePlaying = false;

		if (pausedDuringTownTune) {
			pausedDuringTownTune = false;
			return;
		}
	}

	await playHourSong(game, weather, hour, false);
}

async function playHourSong(game, weather, hour, skipIntro) {
	currentMode = 'hourly';
	try {
		const songName = formatHour(hour);
		const remoteUrl = `https://acmusicext.com/static/${game}/${weather}/${songName}.ogg`;
		currentLoopTime = normalizeLoopTime((((loopTimes[game] || {})[weather] || {})[hour]));

		audio.loop = true;
		audio.removeEventListener('ended', playKkSong);
		audio.onpause = handlePauseEvent;

		await loadAudioSource(remoteUrl);

		if (currentLoopTime && skipIntro) {
			audio.currentTime = currentLoopTime.start;
		}

		setVolume();
		await applyTabAudioState();

		if (!tabAudioPaused) {
			await playAudio();
		} else {
			void sendToWorker({ type: 'pause', tabPaused: true });
		}

		updateHourlyMediaMetadata(game, hour, weather);
	} catch (_error) {
		void sendToWorker({ type: 'music-failed' });
	}
}

async function playKkMusic() {
	currentMode = 'kk';
	currentKkVersion = playback.kkVersion;
	clearLoop();
	await applyTabAudioState();
	audio.loop = false;
	audio.onpause = handlePauseEvent;
	audio.removeEventListener('ended', playKkSong);
	audio.addEventListener('ended', playKkSong);
	await fadeOutAudio(500);
	await playKkSong();
}

async function playKkSong() {
	audio.loop = false;
	try {
		const version = currentKkVersion === 'both'
			? (Math.floor(Math.random() * 2) === 0 ? 'live' : 'aircheck')
			: currentKkVersion;
		const selectedSongs = playback.kkSelectedSongsEnable && playback.kkSelectedSongs.length > 0
			? playback.kkSelectedSongs
			: KKSongList;
		const song = selectedSongs[Math.floor(Math.random() * selectedSongs.length)];
		const remoteUrl = `https://acmusicext.com/static/kk/${version}/${encodeURIComponent(song)}.ogg`;

		await loadAudioSource(remoteUrl);
		setVolume();
		await applyTabAudioState();

		if (!tabAudioPaused) {
			await playAudio();
		}

		const formattedTitle = `${song.split(' - ')[1]} (${capitalize(version)} Version)`;
		void sendToWorker({ type: 'kk-music', title: formattedTitle });
		updateKkMediaMetadata(formattedTitle, song);
	} catch (_error) {
		void sendToWorker({ type: 'music-failed' });
	}
}

async function playTownTuneOnly() {
	currentMode = 'paused';
	await playTownTune(playback.townTune, true);
}

async function playTownTune(tune, notifyDone) {
	await audioContext.resume();

	return new Promise((resolve) => {
		let volume = playback.townTuneVolume;
		if (playback.tabAudio === 'reduce' && playback.isTabAudible) {
			volume = volume * (1 - playback.tabAudioReduceValue / 100);
		}

		if (volume < 0) volume = 0;
		if (volume > 1) volume = 1;

		tunePlayer.playTune(tune || DEFAULT_TOWN_TUNE, sampler, 66, volume).done(() => {
			if (notifyDone) {
				void sendToWorker({ type: 'town-tune-complete' });
			}
			resolve();
		});
	});
}

async function applyTabAudioState() {
	const shouldPause = playback.tabAudio === 'pause' && playback.isTabAudible;
	const shouldReduce = playback.tabAudio === 'reduce' && playback.isTabAudible;

	if (shouldPause) {
		if (!tabAudioPaused) {
			tabAudioPaused = true;
			if (!audio.paused) {
				ignoreNextPauseEvent = true;
				audio.pause();
			}
			void sendToWorker({ type: 'pause', tabPaused: true });
		}
	} else if (tabAudioPaused) {
		tabAudioPaused = false;
		if (!townTunePlaying && currentMode !== 'paused') {
			await playAudio();
		}
		if (currentMode !== 'paused') {
			void sendToWorker({ type: 'unpause' });
		}
	}

	audio.dataset.reduced = shouldReduce ? 'true' : 'false';
	setVolume();
}

function setVolume() {
	let volume = playback.volume;
	const shouldReduce = audio.dataset.reduced === 'true';

	if (shouldReduce) {
		volume = volume * (1 - playback.tabAudioReduceValue / 100);
	}

	if (volume < 0) volume = 0;
	if (volume > 1) volume = 1;

	audio.volume = volume;
}

async function playAudio() {
	await audioContext.resume();

	try {
		await audio.play();
		if (currentLoopTime) {
			scheduleLoop(currentLoopTime);
		}
	} catch (_error) {
		void sendToWorker({ type: 'music-failed' });
	}
}

async function loadAudioSource(remoteUrl) {
	clearLoop();

	const sourceUrl = await resolveAudioSource(remoteUrl);
	const previousObjectUrl = currentObjectUrl;
	currentObjectUrl = sourceUrl.startsWith('blob:') ? sourceUrl : null;

	audio.src = sourceUrl;
	audio.load();

	await waitForAudioMetadata();

	if (previousObjectUrl) {
		URL.revokeObjectURL(previousObjectUrl);
	}
}

async function resolveAudioSource(remoteUrl) {
	try {
		const response = await fetch(remoteUrl, { cache: 'no-store' });
		if (!response.ok) throw new Error(`Track request failed with ${response.status}`);
		const blob = await response.blob();
		return URL.createObjectURL(blob);
	} catch (_error) {
		return remoteUrl;
	}
}

function waitForAudioMetadata() {
	return new Promise((resolve, reject) => {
		if (audio.readyState >= 1) {
			resolve();
			return;
		}

		const cleanup = () => {
			audio.removeEventListener('loadedmetadata', onLoaded);
			audio.removeEventListener('error', onError);
		};

		const onLoaded = () => {
			cleanup();
			resolve();
		};

		const onError = () => {
			cleanup();
			reject(new Error('Failed to load audio metadata'));
		};

		audio.addEventListener('loadedmetadata', onLoaded, { once: true });
		audio.addEventListener('error', onError, { once: true });
	});
}

function scheduleLoop(loopTime) {
	clearLoop();
	currentLoopTime = loopTime;

	if (!loopTime) return;

	const remaining = Math.max(0, loopTime.end - audio.currentTime);
	loopTimeoutId = setTimeout(() => {
		audio.currentTime = loopTime.start;
		scheduleLoop(loopTime);
	}, remaining * 1000);
}

async function fadeOutAudio(durationMs) {
	if (audio.paused) return;

	const originalVolume = audio.volume;
	const step = audio.volume / Math.max(1, durationMs / 100);

	await new Promise((resolve) => {
		fadeIntervalId = setInterval(() => {
			if (audio.volume > step) {
				audio.volume -= step;
				return;
			}

			clearInterval(fadeIntervalId);
			fadeIntervalId = null;
			ignoreNextPauseEvent = true;
			audio.pause();
			audio.volume = originalVolume;
			resolve();
		}, 100);
	});
}

async function pauseAudio() {
	clearLoop();

	if (townTunePlaying) {
		pausedDuringTownTune = true;
	}

	if (!audio.paused) {
		await fadeOutAudio(300);
	}
}

async function stopPlayback() {
	clearLoop();
	audio.removeEventListener('ended', playKkSong);
	currentMode = 'paused';
	currentHourTrack = null;
	tabAudioPaused = false;
	clearMediaArtworkUrls();

	if (!audio.paused) {
		ignoreNextPauseEvent = true;
		audio.pause();
	}

	audio.removeAttribute('src');
	audio.load();

	if (currentObjectUrl) {
		URL.revokeObjectURL(currentObjectUrl);
		currentObjectUrl = null;
	}
}

function clearLoop() {
	if (loopTimeoutId) {
		clearTimeout(loopTimeoutId);
		loopTimeoutId = null;
	}

	if (fadeIntervalId) {
		clearInterval(fadeIntervalId);
		fadeIntervalId = null;
	}
}

function handlePauseEvent() {
	if (ignoreNextPauseEvent) {
		ignoreNextPauseEvent = false;
		return;
	}

	if (!tabAudioPaused) {
		void sendToWorker({ type: 'pause', tabPaused: false });
	}
}

function setMediaSessionHandlers() {
	if (!supportsMediaSession) return;

	navigator.mediaSession.setActionHandler('play', () => {
		void sendToWorker({ type: 'toggle-playback' });
	});
	navigator.mediaSession.setActionHandler('pause', () => {
		void sendToWorker({ type: 'toggle-playback' });
	});
	navigator.mediaSession.setActionHandler('nexttrack', () => {
		if (currentMode === 'kk') {
			void playKkSong();
		}
	});
}

async function updateHourlyMediaMetadata(game, hour, weather) {
	if (!supportsMediaSession) return;

	const artwork = await buildMediaArtwork([
		{ path: `img/cover/${game}.png`, sizes: '512x512', type: 'image/png' }
	]);

	navigator.mediaSession.metadata = new MediaMetadata({
		title: `${formatHour(hour)} (${capitalize(weather)})`,
		artist: gameNames[game],
		album: 'Animal Crossing Music',
		artwork
	});
}

async function updateKkMediaMetadata(title, fileName) {
	if (!supportsMediaSession) return;

	const artwork = await buildMediaArtwork([
		{
			url: `https://acmusicext.com/static/kk/art/${encodeURIComponent(fileName)}.png`,
			sizes: '128x128',
			type: 'image/png'
		},
		{
			path: 'img/cover/kk.png',
			sizes: '512x512',
			type: 'image/png'
		}
	]);

	navigator.mediaSession.metadata = new MediaMetadata({
		title,
		artist: 'K.K. Slider',
		album: 'Animal Crossing Music',
		artwork
	});
}

function normalizeLoopTime(loopTime) {
	if (!loopTime) return null;

	return {
		start: parseFloat(loopTime.start),
		end: parseFloat(loopTime.end)
	};
}

function sendToWorker(message) {
	return chrome.runtime.sendMessage({ ...message, target: 'worker' });
}

async function buildMediaArtwork(sources) {
	clearMediaArtworkUrls();

	const artwork = [];

	for (const source of sources) {
		const resolvedSrc = await resolveMediaArtworkSource(source);
		if (!resolvedSrc) continue;

		artwork.push({
			src: resolvedSrc,
			sizes: source.sizes,
			type: source.type
		});
	}

	return artwork;
}

async function resolveMediaArtworkSource(source) {
	if (source.url && /^(https?|data|blob):/.test(source.url)) {
		return source.url;
	}

	if (!source.path) return '';

	try {
		const response = await fetch(chrome.runtime.getURL(source.path), { cache: 'force-cache' });
		if (!response.ok) throw new Error(`Artwork request failed with ${response.status}`);

		const blobUrl = URL.createObjectURL(await response.blob());
		mediaArtworkUrls.push(blobUrl);
		return blobUrl;
	} catch (_error) {
		return source.url || '';
	}
}

function clearMediaArtworkUrls() {
	for (const url of mediaArtworkUrls) {
		URL.revokeObjectURL(url);
	}
	mediaArtworkUrls = [];
}
