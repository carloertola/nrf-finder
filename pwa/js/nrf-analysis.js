export const BASE_TRIALS = [
  { bpm: 6.5, focus: 'Smoothness of the HR waveform' },
  { bpm: 6.0, focus: 'Peak-to-trough HR amplitude' },
  { bpm: 5.5, focus: 'Phase synchrony (near 0° shift)' },
  { bpm: 5.0, focus: 'LF power concentration (0.04-0.15 Hz)' },
  { bpm: 4.5, focus: 'Clean single LF spectral peak' },
];

const TRIAL_DURATION_SEC = 120;
const REST_DURATION_SEC = 120;

export const LF_RANGE = [0.04, 0.15];

export function getTrialDurationSec() {
  return TRIAL_DURATION_SEC;
}

export function getRestDurationSec() {
  return REST_DURATION_SEC;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function detrend(values) {
  const m = mean(values);
  return values.map((v) => v - m);
}

function linearResample(samples, fs = 4) {
  if (samples.length < 2) return [];
  const start = samples[0].ts;
  const end = samples[samples.length - 1].ts;
  const step = 1000 / fs;
  const out = [];
  let i = 0;

  for (let t = start; t <= end; t += step) {
    while (i < samples.length - 2 && samples[i + 1].ts < t) i += 1;
    const a = samples[i];
    const b = samples[i + 1];
    const dt = Math.max(1, b.ts - a.ts);
    const ratio = clamp((t - a.ts) / dt, 0, 1);
    out.push({ t, v: a.hr + (b.hr - a.hr) * ratio });
  }

  return out;
}

function dftPower(signal, fs) {
  const n = signal.length;
  if (n < 16) return [];
  const w = signal.map((v, i) => {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return v * hann;
  });

  const bins = [];
  for (let k = 1; k < Math.floor(n / 2); k += 1) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i += 1) {
      const a = (2 * Math.PI * k * i) / n;
      re += w[i] * Math.cos(a);
      im -= w[i] * Math.sin(a);
    }
    const freq = (k * fs) / n;
    bins.push({ freq, power: (re * re + im * im) / n });
  }
  return bins;
}

export function estimateRmssd(rrIntervalsMs) {
  if (rrIntervalsMs.length < 3) return 0;
  const diffs = [];
  for (let i = 1; i < rrIntervalsMs.length; i += 1) diffs.push(rrIntervalsMs[i] - rrIntervalsMs[i - 1]);
  return Math.sqrt(mean(diffs.map((d) => d * d)));
}

export function computeSmoothness(hrSeries) {
  if (hrSeries.length < 6) return 0;
  const diffs = [];
  for (let i = 1; i < hrSeries.length; i += 1) diffs.push(Math.abs(hrSeries[i] - hrSeries[i - 1]));
  return clamp(100 - mean(diffs) * 8, 0, 100);
}

export function estimateAmplitude(hrSeries) {
  if (hrSeries.length < 8) return 0;
  return Math.max(...hrSeries) - Math.min(...hrSeries);
}

export function estimatePhaseSynchrony(samples, pacingBpm) {
  if (samples.length < 20) return 0;
  const f = pacingBpm / 60;
  const start = samples[0].ts;
  const x = detrend(samples.map((s) => s.hr));
  const refSin = samples.map((s) => Math.sin(2 * Math.PI * f * ((s.ts - start) / 1000)));
  const refCos = samples.map((s) => Math.cos(2 * Math.PI * f * ((s.ts - start) / 1000)));

  let xs = 0;
  let xc = 0;
  for (let i = 0; i < x.length; i += 1) {
    xs += x[i] * refSin[i];
    xc += x[i] * refCos[i];
  }

  const phaseRad = Math.atan2(xc, xs);
  const phaseDeg = Math.abs((phaseRad * 180) / Math.PI);
  const wrapped = Math.min(phaseDeg, Math.abs(360 - phaseDeg));
  const score = clamp(100 - wrapped * 1.2, 0, 100);
  return score;
}

export function spectralMetrics(samples) {
  const fs = 4;
  const resampled = linearResample(samples, fs);
  if (resampled.length < 30) return { lfPower: 0, peakFreq: 0, cleanliness: 0 };

  const signal = detrend(resampled.map((s) => s.v));
  const spectrum = dftPower(signal, fs);
  const lfBins = spectrum.filter((b) => b.freq >= LF_RANGE[0] && b.freq <= LF_RANGE[1]);
  if (!lfBins.length) return { lfPower: 0, peakFreq: 0, cleanliness: 0 };

  const totalLf = lfBins.reduce((a, b) => a + b.power, 0);
  let peak = lfBins[0];
  for (const b of lfBins) if (b.power > peak.power) peak = b;

  const neighborhood = lfBins
    .filter((b) => Math.abs(b.freq - peak.freq) <= 0.015)
    .reduce((a, b) => a + b.power, 0);

  const cleanliness = clamp((peak.power / Math.max(totalLf - neighborhood + peak.power, 1e-6)) * 100, 0, 100);
  return {
    lfPower: clamp(Math.log10(1 + totalLf) * 30, 0, 100),
    peakFreq: peak.freq,
    cleanliness,
  };
}

export function buildTrialMetrics(samples, rrIntervalsMs, bpm) {
  const hrSeries = samples.map((s) => s.hr);
  const smoothness = computeSmoothness(hrSeries);
  const amplitudeRaw = estimateAmplitude(hrSeries);
  const phaseSynchrony = estimatePhaseSynchrony(samples, bpm);
  const { lfPower, peakFreq, cleanliness } = spectralMetrics(samples);
  const rmssd = estimateRmssd(rrIntervalsMs);

  const coherence = clamp(
    phaseSynchrony * 0.4 + smoothness * 0.2 + lfPower * 0.2 + cleanliness * 0.1 + clamp(amplitudeRaw * 3, 0, 100) * 0.1,
    0,
    100,
  );

  return {
    bpm,
    smoothness,
    amplitudeRaw,
    phaseSynchrony,
    lfPower,
    spectralCleanliness: cleanliness,
    peakFreq,
    rmssd,
    coherence,
  };
}

export function normalizeAndScoreTrials(trials) {
  if (!trials.length) return [];
  const ampMean = mean(trials.map((t) => t.amplitudeRaw));
  const ampStd = Math.max(std(trials.map((t) => t.amplitudeRaw)), 0.1);

  return trials.map((t) => {
    const amplitude = clamp(50 + ((t.amplitudeRaw - ampMean) / ampStd) * 12, 0, 100);
    const finalScore = clamp(
      t.phaseSynchrony * 0.3 +
        amplitude * 0.2 +
        t.lfPower * 0.2 +
        t.spectralCleanliness * 0.12 +
        t.smoothness * 0.1 +
        t.coherence * 0.08,
      0,
      100,
    );
    return { ...t, amplitude, finalScore };
  });
}

export function summarizeResonance(scoredTrials) {
  if (!scoredTrials.length) return null;
  const ranked = [...scoredTrials].sort((a, b) => b.finalScore - a.finalScore);
  const winner = ranked[0];
  const second = ranked[1] ?? winner;
  const separation = clamp(winner.finalScore - second.finalScore, 0, 15);
  const confidence = clamp(Math.round(65 + separation * 2.2 + winner.phaseSynchrony * 0.15), 50, 99);

  return {
    bpm: winner.bpm,
    hz: winner.bpm / 60,
    secondsPerBreath: 60 / winner.bpm,
    confidence,
    winner,
    ranked,
    boundaryExtensionNeeded: winner.bpm === 6.5 || winner.bpm === 4.5,
    boundaryDirection: winner.bpm === 6.5 ? 'upper' : winner.bpm === 4.5 ? 'lower' : null,
  };
}
