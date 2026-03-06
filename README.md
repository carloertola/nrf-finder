# NRF Finder PWA

A Progressive Web App page for estimating a user's natural resonance frequency (NRF) using paced breathing + real-time heart biofeedback.

## What this implementation includes

- **3-screen flow**:
  1. Intro + setup + sensor connection
  2. Guided assessment with paced trials and rests
  3. Final NRF results with confidence and per-trial details
- **Vaschillo/Lehrer-style standardized trial sequence**:
  - Trial rates: 6.5, 6.0, 5.5, 5.0, 4.5 BPM (descending by 0.5)
  - Trial duration: 2 minutes each
  - Rest duration: 2 minutes between trials
- **Live metrics** during assessment:
  - Heart Rate (BPM)
  - HRV smoothness proxy
  - Coherence proxy
  - Trial focus prompt (what to pay attention to)
- **Sensor options**:
  - Web Bluetooth Heart Rate Service support (works with many BLE HR monitors such as Polar H10-compatible profiles).
  - Camera PPG mode scaffold (currently experimental synthetic stream for development; hook-in point for full rPPG pipeline).
- **Session completion output** with estimated NRF in BPM, Hz, and seconds per breath.

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

The scoring combines multiple resonance-selection criteria inspired by Vaschillo/Lehrer priorities:

- Phase synchrony proxy
- Peak-trough amplitude (HR max - HR min)
- LF-power proxy
- Spectral cleanliness proxy
- Smoothness

If the strongest trial is at a boundary (4.5 or 6.5 BPM), results include a protocol note recommending an extension trial at 4.0 or 7.0 BPM.

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
