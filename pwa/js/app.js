import {
  BREATH_PHASES_BPM,
  computeSmoothness,
  estimateCoherence,
  estimateRmssd,
  getPhaseDurationSec,
  summarizeResonance,
} from './nrf-analysis.js';
import { SensorHub } from './sensors.js';

const el = {
  connectBle: document.querySelector('#connect-ble'),
  connectCamera: document.querySelector('#connect-camera'),
  connectionStatus: document.querySelector('#connection-status'),
  pacerCircle: document.querySelector('#pacer-circle'),
  startSession: document.querySelector('#start-session'),
  stopSession: document.querySelector('#stop-session'),
  sessionStatus: document.querySelector('#session-status'),
  phaseProgress: document.querySelector('#phase-progress'),
  hrValue: document.querySelector('#hr-value'),
  smoothnessValue: document.querySelector('#smoothness-value'),
  coherenceValue: document.querySelector('#coherence-value'),
  resultCard: document.querySelector('#result-card'),
  resultText: document.querySelector('#result-text'),
};

const state = {
  running: false,
  phaseIndex: 0,
  phaseStartMs: 0,
  phases: [],
  hrSamples: [],
  rrIntervals: [],
  lastBeatTs: null,
  pacerTimer: null,
  phaseTimer: null,
};

const sensorHub = new SensorHub((hr, ts) => {
  state.hrSamples.push({ hr, ts });
  el.hrValue.textContent = String(hr);

  if (state.lastBeatTs && hr > 0) {
    const rr = 60000 / hr;
    state.rrIntervals.push(rr);
  }
  state.lastBeatTs = ts;

  const recentHrs = state.hrSamples.slice(-40).map((s) => s.hr);
  const smoothness = computeSmoothness(recentHrs);
  const coherence = estimateCoherence(recentHrs, BREATH_PHASES_BPM[state.phaseIndex] ?? 6);

  el.smoothnessValue.textContent = smoothness === null ? '--' : `${smoothness.toFixed(1)} / 100`;
  el.coherenceValue.textContent = coherence === null ? '--' : `${coherence.toFixed(1)} / 100`;
});

function updateStatus(msg) {
  el.sessionStatus.textContent = msg;
}

function animatePacer(bpm) {
  const cycleMs = (60 / bpm) * 1000;
  const started = performance.now();

  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);

  const tick = (now) => {
    const t = ((now - started) % cycleMs) / cycleMs;
    const inhale = t < 0.5;
    const phaseT = inhale ? t * 2 : (t - 0.5) * 2;
    const scale = inhale ? 1 + phaseT * 0.45 : 1.45 - phaseT * 0.45;
    el.pacerCircle.style.transform = `scale(${scale})`;
    el.pacerCircle.textContent = inhale ? 'Inhale' : 'Exhale';
    state.pacerTimer = requestAnimationFrame(tick);
  };

  state.pacerTimer = requestAnimationFrame(tick);
}

function finishSession() {
  state.running = false;
  if (state.phaseTimer) clearInterval(state.phaseTimer);
  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);

  const result = summarizeResonance(state.phases);
  if (!result) {
    updateStatus('Session ended, but insufficient data for a confident NRF estimate.');
    return;
  }

  el.resultCard.hidden = false;
  el.resultText.textContent = `Your estimated NRF is ${result.bpm.toFixed(2)} BPM (${result.hz.toFixed(4)} Hz, one breath every ${result.secondsPerBreath.toFixed(2)} s). Confidence: ${result.confidence}%.`;
  updateStatus('Session completed successfully.');
}

function runPhaseLoop() {
  const phaseDurationMs = getPhaseDurationSec() * 1000;
  state.phaseStartMs = performance.now();

  state.phaseTimer = setInterval(() => {
    const now = performance.now();
    const elapsed = now - state.phaseStartMs;
    const progress = Math.min(100, (elapsed / phaseDurationMs) * 100);
    el.phaseProgress.value = progress;

    if (elapsed >= phaseDurationMs) {
      const phaseBpm = BREATH_PHASES_BPM[state.phaseIndex];
      const recentHrs = state.hrSamples
        .filter((s) => s.ts >= state.phaseStartMs)
        .map((s) => s.hr);
      state.phases.push({
        bpm: phaseBpm,
        smoothness: computeSmoothness(recentHrs) ?? 0,
        coherence: estimateCoherence(recentHrs, phaseBpm) ?? 0,
        rmssd: estimateRmssd(state.rrIntervals) ?? 0,
      });

      state.phaseIndex += 1;
      if (state.phaseIndex >= BREATH_PHASES_BPM.length) {
        finishSession();
        return;
      }

      state.phaseStartMs = now;
      el.phaseProgress.value = 0;
      const nextBpm = BREATH_PHASES_BPM[state.phaseIndex];
      animatePacer(nextBpm);
      updateStatus(`Phase ${state.phaseIndex + 1}/${BREATH_PHASES_BPM.length}: breathe at ${nextBpm.toFixed(1)} BPM.`);
    }
  }, 200);
}

el.connectBle.addEventListener('click', async () => {
  try {
    const msg = await sensorHub.connectBLE();
    el.connectionStatus.textContent = `Status: ${msg}`;
  } catch (err) {
    el.connectionStatus.textContent = `Status: BLE connect failed (${err.message})`;
  }
});

el.connectCamera.addEventListener('click', async () => {
  try {
    const msg = await sensorHub.connectCameraPPG();
    el.connectionStatus.textContent = `Status: ${msg}`;
  } catch (err) {
    el.connectionStatus.textContent = `Status: Camera connect failed (${err.message})`;
  }
});

el.startSession.addEventListener('click', () => {
  if (state.running) return;
  state.running = true;
  state.phaseIndex = 0;
  state.phases = [];
  state.hrSamples = [];
  state.rrIntervals = [];
  state.lastBeatTs = null;
  el.resultCard.hidden = true;
  el.phaseProgress.value = 0;

  const bpm = BREATH_PHASES_BPM[state.phaseIndex];
  animatePacer(bpm);
  updateStatus(`Phase 1/${BREATH_PHASES_BPM.length}: breathe at ${bpm.toFixed(1)} BPM.`);
  runPhaseLoop();
});

el.stopSession.addEventListener('click', () => {
  if (!state.running) return;
  state.running = false;
  if (state.phaseTimer) clearInterval(state.phaseTimer);
  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);
  updateStatus('Session stopped by user.');
});

window.addEventListener('beforeunload', () => sensorHub.disconnect());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
