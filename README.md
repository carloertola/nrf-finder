# NRF Finder PWA

A Progressive Web App page for estimating a user's natural resonance frequency (NRF) using paced breathing + real-time heart biofeedback.

## What this implementation includes

- **PWA-ready page** (manifest + service worker).
- **Guided stepped breathing protocol** around the common resonance range (4.5–6.5 BPM), inspired by Vaschillo et al. resonance frequency analysis methods.
- **Real-time metrics** during the session:
  - Heart Rate (BPM)
  - HRV smoothness proxy
  - Coherence proxy score
- **Sensor options**:
  - Web Bluetooth Heart Rate Service support (works with many BLE HR monitors such as Polar H10-compatible profiles).
  - Camera PPG mode scaffold (currently experimental synthetic stream for development; hook-in point for full rPPG pipeline).
- **Session completion output** with estimated NRF in:
  - BPM
  - Hz
  - Seconds per breath

## Tech + structure

This repo is structured so the page can be dropped into a PHP MVC app as its own route/page later.

```text
pwa/
  index.html
  manifest.webmanifest
  sw.js
  css/styles.css
  js/app.js
  js/nrf-analysis.js
  js/sensors.js
  icons/
scripts/run-local.sh
```

## Local development (one command)

From the repo root:

```bash
./scripts/run-local.sh
```

Then open:

- http://localhost:8080

> Note: use HTTPS (or localhost) for Web Bluetooth and camera access in modern browsers.

## NRF analysis model notes

This app uses a practical stepped breathing scan and scores each breathing rate by coherence + smoothness proxies, then selects the highest scoring phase as the NRF estimate.

For production-grade clinical accuracy, you should extend `js/nrf-analysis.js` with:

- spectral peak power around the paced frequency,
- phase synchrony / transfer function estimates,
- protocol controls for trial length and repeatability,
- artifact rejection and quality gates.

## Device compatibility notes

- **Direct browser BLE**: best for devices exposing standard Heart Rate Service characteristics.
- **Oura/Garmin**: usually consumed via cloud APIs or app ecosystems; direct browser connection may not be available.
- **Camera PPG**: scaffolded here for easy replacement with a full rPPG implementation (POS/CHROM + filtering + robust peak detection).

## Styling requirements implemented

- Colors:
  - Primary: `#006080`
  - Accent: `#363636`
  - Background: `#F1F1F1`
- Fonts:
  - Montserrat (titles/buttons)
  - Source Sans Pro (body/subtitles)
