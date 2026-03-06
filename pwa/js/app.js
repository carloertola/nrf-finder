import {
  BASE_TRIALS,
  computeSmoothness,
  estimateAmplitude,
  estimateCoherence,
  estimateRmssd,
  getRestDurationSec,
  getTrialDurationSec,
  summarizeResonance,
} from './nrf-analysis.js';
import { SensorHub } from './sensors.js';

const el = {
  screens: {
    intro: document.querySelector('#screen-intro'),
    assessment: document.querySelector('#screen-assessment'),
    results: document.querySelector('#screen-results'),
  },
  connectBle: document.querySelector('#connect-ble'),
  connectCamera: document.querySelector('#connect-camera'),
  connectionStatus: document.querySelector('#connection-status'),
  goAssessment: document.querySelector('#go-assessment'),
  backIntro: document.querySelector('#back-intro'),
  restartFlow: document.querySelector('#restart-flow'),
  pacerCircle: document.querySelector('#pacer-circle'),
  startSession: document.querySelector('#start-session'),
  stopSession: document.querySelector('#stop-session'),
  sessionStatus: document.querySelector('#session-status'),
  phaseLabel: document.querySelector('#phase-label'),
  phaseProgress: document.querySelector('#phase-progress'),
  hrValue: document.querySelector('#hr-value'),
  smoothnessValue: document.querySelector('#smoothness-value'),
  coherenceValue: document.querySelector('#coherence-value'),
  focusMetric: document.querySelector('#focus-metric'),
  resultText: document.querySelector('#result-text'),
  resultConfidence: document.querySelector('#result-confidence'),
  resultDetails: document.querySelector('#result-details'),
};

const state = {
  running: false,
  intervalKind: 'trial',
  intervalStartMs: 0,
  intervalTimer: null,
  pacerTimer: null,
  trialIndex: 0,
  trials: [...BASE_TRIALS],
  trialResults: [],
  hrSamples: [],
  rrIntervals: [],
};

function showScreen(screenName) {
  Object.values(el.screens).forEach((node) => node.classList.remove('active'));
  el.screens[screenName].classList.add('active');
}

const sensorHub = new SensorHub((hr, ts) => {
  state.hrSamples.push({ hr, ts, trialIndex: state.trialIndex });
  el.hrValue.textContent = String(hr);

  const rr = 60000 / Math.max(1, hr);
  state.rrIntervals.push(rr);

  const recentHrs = state.hrSamples.slice(-40).map((s) => s.hr);
  const smoothness = computeSmoothness(recentHrs);
  const coherence = estimateCoherence(recentHrs, state.trials[state.trialIndex]?.bpm ?? 6);

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

function stopPacerRestView() {
  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);
  el.pacerCircle.style.transform = 'scale(1)';
  el.pacerCircle.textContent = 'Rest\nBreathe naturally';
}

function normalizeLFMetrics(value, maxValue) {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
  return Math.max(0, Math.min(100, (value / maxValue) * 100));
}

function finalizeResults() {
  const summary = summarizeResonance(state.trialResults);
  if (!summary) {
    updateStatus('Session ended with insufficient quality data.');
    return;
  }

  el.resultText.textContent = `Estimated NRF: ${summary.bpm.toFixed(2)} BPM (${summary.hz.toFixed(4)} Hz, ${summary.secondsPerBreath.toFixed(2)} s per breath).`;
  el.resultConfidence.textContent = `Confidence: ${summary.confidence}%`;
  el.resultDetails.innerHTML = '';

  state.trialResults
    .sort((a, b) => b.finalScore - a.finalScore)
    .forEach((trial) => {
      const li = document.createElement('li');
      li.textContent = `${trial.bpm.toFixed(1)} BPM — Score ${trial.finalScore.toFixed(1)} | Coherence ${trial.coherence.toFixed(1)} | Amplitude ${trial.amplitude.toFixed(1)} | Smoothness ${trial.smoothness.toFixed(1)}`;
      el.resultDetails.appendChild(li);
    });

  if (summary.boundaryExtensionNeeded) {
    const extensionBpm = summary.boundaryDirection === 'upper' ? 7.0 : 4.0;
    const li = document.createElement('li');
    li.textContent = `Protocol note: best score hit boundary (${summary.bpm.toFixed(1)} BPM). Consider extension trial at ${extensionBpm.toFixed(1)} BPM.`;
    el.resultDetails.appendChild(li);
  }

  showScreen('results');
}

function completeTrial() {
  const currentTrial = state.trials[state.trialIndex];
  const trialSamples = state.hrSamples.filter((s) => s.trialIndex === state.trialIndex).map((s) => s.hr);
  const smoothness = computeSmoothness(trialSamples) ?? 0;
  const coherence = estimateCoherence(trialSamples, currentTrial.bpm) ?? 0;
  const amplitudeRaw = estimateAmplitude(trialSamples) ?? 0;
  const rmssd = estimateRmssd(state.rrIntervals.slice(-120)) ?? 0;

  state.trialResults.push({
    bpm: currentTrial.bpm,
    smoothness,
    coherence,
    amplitudeRaw,
    rmssd,
    phaseSynchrony: coherence,
    lfPowerRaw: rmssd,
    spectralCleanliness: smoothness,
    amplitude: 0,
    lfPower: 0,
    finalScore: 0,
  });
}

function scoreTrials() {
  const maxAmplitude = Math.max(...state.trialResults.map((t) => t.amplitudeRaw), 1);
  const maxLf = Math.max(...state.trialResults.map((t) => t.lfPowerRaw), 1);

  state.trialResults.forEach((trial) => {
    trial.amplitude = normalizeLFMetrics(trial.amplitudeRaw, maxAmplitude);
    trial.lfPower = normalizeLFMetrics(trial.lfPowerRaw, maxLf);
    trial.finalScore =
      trial.coherence * 0.34 +
      trial.amplitude * 0.22 +
      trial.lfPower * 0.16 +
      trial.spectralCleanliness * 0.12 +
      trial.smoothness * 0.10 +
      trial.phaseSynchrony * 0.06;
  });
}

function startInterval(kind) {
  state.intervalKind = kind;
  state.intervalStartMs = performance.now();

  const currentTrial = state.trials[state.trialIndex];
  if (kind === 'trial') {
    animatePacer(currentTrial.bpm);
    el.phaseLabel.textContent = `Trial ${state.trialIndex + 1}/${state.trials.length}: ${currentTrial.bpm.toFixed(1)} BPM`;
    el.focusMetric.textContent = currentTrial.focus;
    updateStatus(`Trial running at ${currentTrial.bpm.toFixed(1)} BPM. Follow inhale/exhale pacing.`);
  } else {
    stopPacerRestView();
    el.phaseLabel.textContent = `Rest interval ${state.trialIndex}/${state.trials.length}`;
    el.focusMetric.textContent = 'Recovery to baseline';
    updateStatus('Rest period: breathe naturally for 2 minutes.');
  }
}

function stopSession(reason = 'Session stopped.') {
  state.running = false;
  if (state.intervalTimer) clearInterval(state.intervalTimer);
  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);
  updateStatus(reason);
}

function runSessionLoop() {
  if (state.intervalTimer) clearInterval(state.intervalTimer);

  state.intervalTimer = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - state.intervalStartMs;
    const durationMs = (state.intervalKind === 'trial' ? getTrialDurationSec() : getRestDurationSec()) * 1000;
    el.phaseProgress.value = Math.min(100, (elapsedMs / durationMs) * 100);

    if (elapsedMs < durationMs) return;

    el.phaseProgress.value = 0;

    if (state.intervalKind === 'trial') {
      completeTrial();

      if (state.trialIndex === state.trials.length - 1) {
        stopSession('Assessment complete.');
        scoreTrials();
        finalizeResults();
        return;
      }

      startInterval('rest');
      return;
    }

    state.trialIndex += 1;
    startInterval('trial');
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

el.goAssessment.addEventListener('click', () => showScreen('assessment'));
el.backIntro.addEventListener('click', () => showScreen('intro'));
el.restartFlow.addEventListener('click', () => {
  showScreen('intro');
  el.phaseProgress.value = 0;
  el.resultDetails.innerHTML = '';
});

el.startSession.addEventListener('click', () => {
  if (state.running) return;
  state.running = true;
  state.trialIndex = 0;
  state.trials = [...BASE_TRIALS];
  state.trialResults = [];
  state.hrSamples = [];
  state.rrIntervals = [];
  el.phaseProgress.value = 0;

  startInterval('trial');
  runSessionLoop();
});

el.stopSession.addEventListener('click', () => {
  if (!state.running) return;
  stopSession('Session stopped by user.');
});

window.addEventListener('beforeunload', () => sensorHub.disconnect());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
