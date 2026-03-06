# NRF Finder PWA

Welcome! This project is a browser-based Progressive Web App that helps a user identify their **Natural Resonance Frequency (NRF)** using paced breathing + real-time heart biofeedback.

---

## Quick Start (First-Time User)

### 1) Launch locally
```bash
./scripts/run-local.sh
```
Open: **http://localhost:8080**

### 2) Follow the 3-screen flow
1. **Intro & Connection**
   - Learn the protocol.
   - Connect a BLE HR device, or authorize camera PPG.
2. **Assessment**
   - Complete paced breathing trials at 6.5, 6.0, 5.5, 5.0, 4.5 BPM.
   - Each trial is 2 minutes.
   - Rest 2 minutes between trials.
3. **Results**
   - Review NRF in BPM, Hz, and seconds per breath.
   - Inspect confidence and trial-by-trial analysis details.

---

## App Dashboard (What You See During Assessment)

- **Heart Rate (BPM)**: live pulse estimate from BLE or camera PPG.
- **HRV Smoothness**: waveform regularity proxy.
- **Coherence**: integrated resonance-quality score.
- **Current Focus**: criterion emphasized for the current trial.
- **Progress bar**: current trial/rest completion status.

---

## Protocol Implemented

- Trial sequence: **6.5 → 4.5 BPM** (descending by 0.5 BPM)
- Trial duration: **120 seconds** each
- Rest duration: **120 seconds** between trials
- Boundary rule:
  - If best result is at **6.5 BPM**, suggest **7.0 BPM** extension.
  - If best result is at **4.5 BPM**, suggest **4.0 BPM** extension.

---

## Signal & Scoring Engine (Built-in)

The analysis layer converts incoming cardio data into interpretable resonance markers:

- **Time-domain metrics**
  - RMSSD proxy from RR intervals
  - HR amplitude (peak-to-trough)
  - Smoothness score
- **Frequency-domain metrics**
  - LF band power estimate (0.04–0.15 Hz)
  - LF peak frequency
  - Spectral cleanliness (single-peak preference)
- **Synchrony metrics**
  - Respiratory phase synchrony proxy (goal: near 0° shift)

A weighted score ranks each paced trial and returns:
- Best NRF candidate
- Confidence score
- Per-trial breakdown for transparent review

---

## Sensor Compatibility

- **BLE (Web Bluetooth)**
  - Supports standard Heart Rate Service devices (e.g., Polar H10-compatible profiles).
- **Camera PPG**
  - Real-time camera brightness pulse extraction (works best with finger on lens + flash).
- **Oura / Garmin**
  - Usually API/cloud ecosystem based; direct browser pairing may vary by platform.

---

## Project Structure

```text
pwa/
  index.html                 # 3-screen UI
  css/styles.css             # theme + animations
  js/app.js                  # UX flow + session orchestration
  js/nrf-analysis.js         # metrics, spectrum, scoring, summary
  js/sensors.js              # BLE + camera PPG acquisition
  manifest.webmanifest       # PWA manifest
  sw.js                      # service worker
  icons/
scripts/run-local.sh         # one-command local server
```

---

## Visual Theme

- Primary: `#006080`
- Accent: `#363636`
- Background: `#F1F1F1`
- Fonts:
  - Montserrat (headings/buttons)
  - Source Sans Pro (body)
