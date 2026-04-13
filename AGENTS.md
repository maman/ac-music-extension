# Repository Guidelines

## Project Structure & Module Organization
This repository is a Chrome extension with no build step. The root contains the extension entry points: `manifest.json`, `options.html`, and `offscreen.html`.

- `scripts/background/`: MV3 runtime code. `service_worker.js` coordinates state, alarms, badges, notifications, and weather; `offscreen.js` handles audio playback and Media Session work.
- `scripts/options/`: options-page UI logic such as settings, navigation, contributors, and the town tune editor.
- `scripts/global/`: shared browser-side utilities like `tune_player.js` and `weather_api.js`.
- `img/`, `sound/`, `css/`, `docs/`: packaged assets and styles.
- Legacy MV2 files still exist in `scripts/background/`; do not reuse them for new work unless you are intentionally porting logic.

## Build, Test, and Development Commands
There is no bundler or test runner. Work directly on the source files and load the repo as an unpacked extension.

- `open chrome://extensions` then enable Developer Mode and use **Load unpacked** on this directory.
- `node --check scripts/background/service_worker.js`: syntax-check the MV3 worker.
- `node --check scripts/background/offscreen.js`: syntax-check offscreen playback logic.
- `node --check scripts/options/options.js`: syntax-check options-page changes.
- `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`: validate manifest JSON.

## Coding Style & Naming Conventions
Use the existing plain JavaScript style: tabs for indentation, semicolons optional, and single quotes by default. Keep functions small and focused. Use:

- `camelCase` for variables/functions
- `UPPER_SNAKE_CASE` for shared constants
- descriptive file names by feature, for example `weather_api.js`, `service_worker.js`

There is no formatter configured, so match the surrounding file style exactly.

## Testing Guidelines
Manual verification is required. After edits, reload the unpacked extension and test the affected flow in Chrome.

Focus on:
- toolbar action play/pause
- live weather updates
- offscreen audio playback
- options-page persistence
- background-play behavior when the last window closes

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects, for example `Migrate extension to Manifest V3` or `Add options to choose specific K.K. songs`.

For pull requests:
- target `develop`
- describe user-visible behavior changes
- link related issues when applicable
- include screenshots for options-page UI changes
- mention manual test coverage and any remaining runtime risks

## Security & Configuration Tips
Keep `manifest.json` permissions minimal. Any new network dependency must be added to `host_permissions` and documented. For location features, prefer browser geolocation plus explicit user action over silent lookup.
