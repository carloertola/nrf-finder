import {
  BASE_TRIALS,
  buildTrialMetrics,
  getRestDurationSec,
  getTrialDurationSec,
  normalizeAndScoreTrials,
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
  liveHr: [],
  rr: [],
  samplesByTrial: new Map(),
  currentScreen: 'intro',
};

function setAriaForScreens(active) {
  Object.entries(el.screens).forEach(([key, node]) => {
    node.setAttribute('aria-hidden', key === active ? 'false' : 'true');
  });
}

function showScreen(next) {
  if (next === state.currentScreen) return;
  const prevNode = el.screens[state.currentScreen];
  const nextNode = el.screens[next];

  prevNode.classList.remove('active', 'screen-in');
  prevNode.classList.add('screen-out');

  setTimeout(() => {
    prevNode.classList.remove('screen-out');
    nextNode.classList.add('active', 'screen-in');
    setTimeout(() => nextNode.classList.remove('screen-in'), 260);
  }, 140);

  state.currentScreen = next;
  setAriaForScreens(next);
}

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

function renderRestPacer() {
  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);
  el.pacerCircle.style.transform = 'scale(1)';
  el.pacerCircle.textContent = 'Rest';
}

function addSampleToTrial(trialIndex, sample) {
  const existing = state.samplesByTrial.get(trialIndex) ?? [];
  existing.push(sample);
  state.samplesByTrial.set(trialIndex, existing);
}

function updateLiveCards() {
  const recent = state.liveHr.slice(-30);
  const hr = recent.length ? recent[recent.length - 1].hr : 0;
  el.hrValue.textContent = hr ? String(Math.round(hr)) : '--';

  if (recent.length < 6) {
    el.smoothnessValue.textContent = '--';
    el.coherenceValue.textContent = '--';
    return;
  }

  const diffs = [];
  for (let i = 1; i < recent.length; i += 1) diffs.push(Math.abs(recent[i].hr - recent[i - 1].hr));
  const smoothness = Math.max(0, Math.min(100, 100 - diffs.reduce((a, b) => a + b, 0) / diffs.length * 8));

  const v = recent.map((s) => s.hr);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const varc = v.reduce((acc, x) => acc + (x - mean) ** 2, 0) / v.length;
  const coherence = Math.max(0, Math.min(100, Math.sqrt(varc) * 9));

  el.smoothnessValue.textContent = `${smoothness.toFixed(1)} / 100`;
  el.coherenceValue.textContent = `${coherence.toFixed(1)} / 100`;
}

function completeCurrentTrial() {
  const trial = state.trials[state.trialIndex];
  const samples = state.samplesByTrial.get(state.trialIndex) ?? [];
  const rrWindow = state.rr.slice(-300);

  const metrics = buildTrialMetrics(samples, rrWindow, trial.bpm);
  state.trialResults.push(metrics);
}

function finishSession() {
  state.running = false;
  if (state.intervalTimer) clearInterval(state.intervalTimer);
  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);

  const scored = normalizeAndScoreTrials(state.trialResults);
  const summary = summarizeResonance(scored);

  if (!summary) {
    updateStatus('Not enough quality signal was captured. Please retry with a stable sensor connection.');
    return;
  }

  el.resultText.textContent = `Estimated NRF: ${summary.bpm.toFixed(2)} BPM (${summary.hz.toFixed(4)} Hz, ${summary.secondsPerBreath.toFixed(2)} s per breath).`;
  el.resultConfidence.textContent = `Confidence score: ${summary.confidence}%`;
  el.resultDetails.innerHTML = '';

  summary.ranked.forEach((trial) => {
    const li = document.createElement('li');
    li.textContent = `${trial.bpm.toFixed(1)} BPM | Score ${trial.finalScore.toFixed(1)} | Coherence ${trial.coherence.toFixed(1)} | Phase sync ${trial.phaseSynchrony.toFixed(1)} | LF ${trial.lfPower.toFixed(1)} | Peak ${trial.peakFreq.toFixed(3)} Hz`;
    el.resultDetails.appendChild(li);
  });

  if (summary.boundaryExtensionNeeded) {
    const extension = summary.boundaryDirection === 'upper' ? 7.0 : 4.0;
    const li = document.createElement('li');
    li.textContent = `Boundary protocol note: strongest response at ${summary.bpm.toFixed(1)} BPM. Add an extension trial at ${extension.toFixed(1)} BPM.`;
    el.resultDetails.appendChild(li);
  }

  showScreen('results');
}

function startInterval(kind) {
  state.intervalKind = kind;
  state.intervalStartMs = performance.now();
  const trial = state.trials[state.trialIndex];

  if (kind === 'trial') {
    animatePacer(trial.bpm);
    el.phaseLabel.textContent = `Trial ${state.trialIndex + 1}/${state.trials.length} — ${trial.bpm.toFixed(1)} BPM`;
    el.focusMetric.textContent = trial.focus;
    updateStatus(`Trial active. Match the pacer at ${trial.bpm.toFixed(1)} BPM.`);
  } else {
    renderRestPacer();
    el.phaseLabel.textContent = `Rest ${state.trialIndex + 1}/${state.trials.length - 1}`;
    el.focusMetric.textContent = 'Recovery to baseline';
    updateStatus('Rest interval: breathe naturally for 2 minutes.');
  }
}

function stopSession(reason = 'Session stopped.') {
  state.running = false;
  if (state.intervalTimer) clearInterval(state.intervalTimer);
  if (state.pacerTimer) cancelAnimationFrame(state.pacerTimer);
  updateStatus(reason);
}

function runLoop() {
  if (state.intervalTimer) clearInterval(state.intervalTimer);

  state.intervalTimer = setInterval(() => {
    const durationMs = (state.intervalKind === 'trial' ? getTrialDurationSec() : getRestDurationSec()) * 1000;
    const elapsedMs = performance.now() - state.intervalStartMs;
    el.phaseProgress.value = Math.min(100, (elapsedMs / durationMs) * 100);

    if (elapsedMs < durationMs) return;

    el.phaseProgress.value = 0;

    if (state.intervalKind === 'trial') {
      completeCurrentTrial();
      if (state.trialIndex === state.trials.length - 1) {
        stopSession('Assessment complete.');
        finishSession();
        return;
      }
      startInterval('rest');
      return;
    }

    state.trialIndex += 1;
    startInterval('trial');
  }, 200);
}

const sensorHub = new SensorHub((sample) => {
  state.liveHr.push({ ts: sample.ts, hr: sample.hr });
  state.rr.push(...(sample.rrIntervals ?? []));
  if (state.running && state.intervalKind === 'trial') {
    addSampleToTrial(state.trialIndex, { ts: sample.ts, hr: sample.hr, pulseStrength: sample.pulseStrength ?? null });
  }
  updateLiveCards();
});

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
el.backIntro.addEventListener('click', () => {
  if (state.running) stopSession('Session paused.');
  showScreen('intro');
});
el.restartFlow.addEventListener('click', () => {
  showScreen('intro');
  state.trialResults = [];
  state.samplesByTrial.clear();
  state.liveHr = [];
  state.rr = [];
  el.phaseProgress.value = 0;
  el.resultDetails.innerHTML = '';
  el.resultText.textContent = '';
  el.resultConfidence.textContent = '';
});

el.startSession.addEventListener('click', () => {
  if (state.running) return;
  state.running = true;
  state.trialIndex = 0;
  state.trialResults = [];
  state.samplesByTrial.clear();
  state.rr = [];
  state.liveHr = [];
  el.phaseProgress.value = 0;
  startInterval('trial');
  runLoop();
});

el.stopSession.addEventListener('click', () => {
  if (!state.running) return;
  stopSession('Session stopped by user.');
});

window.addEventListener('beforeunload', () => sensorHub.disconnect());
setAriaForScreens('intro');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
