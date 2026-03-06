export const BREATH_PHASES_BPM = [4.5, 5.0, 5.5, 6.0, 6.5];
const PHASE_DURATION_SEC = 90;

export function getPhaseDurationSec() {
  return PHASE_DURATION_SEC;
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
      score: phase.coherence * 0.65 + phase.smoothness * 0.35,
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;
  const winner = ranked[0];
  const bpm = winner.bpm;
  return {
    bpm,
    hz: bpm / 60,
    secondsPerBreath: 60 / bpm,
    confidence: Math.min(98, Math.round(winner.score)),
  };
}
