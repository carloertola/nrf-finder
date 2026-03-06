export const BASE_TRIALS = [
  { bpm: 6.5, focus: 'Smoothness of heart-rate curve' },
  { bpm: 6.0, focus: 'Peak-trough amplitude (HRmax - HRmin)' },
  { bpm: 5.5, focus: 'Phase synchrony (target ~0° shift)' },
  { bpm: 5.0, focus: 'LF spectral power density (0.04-0.15 Hz)' },
  { bpm: 4.5, focus: 'Singular / clean LF spectral peak' },
];

const TRIAL_DURATION_SEC = 120;
const REST_DURATION_SEC = 120;

export function getTrialDurationSec() {
  return TRIAL_DURATION_SEC;
}

export function getRestDurationSec() {
  return REST_DURATION_SEC;
}

export function estimateRmssd(rrIntervalsMs) {
  if (rrIntervalsMs.length < 3) return null;
  const diffs = [];
  for (let i = 1; i < rrIntervalsMs.length; i += 1) {
    diffs.push(rrIntervalsMs[i] - rrIntervalsMs[i - 1]);
  }
  const sqMean = diffs.reduce((acc, d) => acc + d * d, 0) / diffs.length;
  return Math.sqrt(sqMean);
}

export function computeSmoothness(hrSeries) {
  if (hrSeries.length < 6) return null;
  let sumAbsDiff = 0;
  for (let i = 1; i < hrSeries.length; i += 1) {
    sumAbsDiff += Math.abs(hrSeries[i] - hrSeries[i - 1]);
  }
  const avgChange = sumAbsDiff / (hrSeries.length - 1);
  return Math.max(0, 100 - avgChange * 8);
}

export function estimateAmplitude(hrSeries) {
  if (hrSeries.length < 10) return null;
  const max = Math.max(...hrSeries);
  const min = Math.min(...hrSeries);
  return max - min;
}

export function estimateCoherence(hrSeries, pacingBpm) {
  if (hrSeries.length < 20) return null;
  const meanHr = hrSeries.reduce((a, b) => a + b, 0) / hrSeries.length;
  const variance = hrSeries.reduce((acc, v) => acc + (v - meanHr) ** 2, 0) / hrSeries.length;
  const normalized = Math.sqrt(variance) / Math.max(1, meanHr);
  const pacingWeight = 1 - Math.min(0.5, Math.abs(6 - pacingBpm) / 10);
  return Math.max(0, Math.min(100, normalized * 500 * pacingWeight));
}

export function summarizeResonance(phases) {
  const ranked = phases
    .filter((phase) => Number.isFinite(phase.coherence) && Number.isFinite(phase.smoothness))
    .map((phase) => ({
      ...phase,
      score:
        phase.coherence * 0.34 +
        phase.amplitude * 0.22 +
        phase.lfPower * 0.16 +
        phase.spectralCleanliness * 0.12 +
        phase.smoothness * 0.10 +
        phase.phaseSynchrony * 0.06,
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;

  const winner = ranked[0];
  return {
    bpm: winner.bpm,
    hz: winner.bpm / 60,
    secondsPerBreath: 60 / winner.bpm,
    confidence: Math.min(99, Math.max(50, Math.round(winner.score))),
    winningMetrics: winner,
    boundaryExtensionNeeded: winner.bpm === 6.5 || winner.bpm === 4.5,
    boundaryDirection: winner.bpm === 6.5 ? 'upper' : winner.bpm === 4.5 ? 'lower' : null,
  };
}
