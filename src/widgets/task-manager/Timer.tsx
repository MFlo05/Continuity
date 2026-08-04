import type { MITState } from '../../context/DashboardContext';

// Live "seconds remaining" for the Focus Timer. Deliberately not clamped to
// 0 here — negative values are how TimerPanel detects "just expired" vs
// "still running" (fmt() does the clamping only at display time). Runs
// entirely off startedAt/estimateSecs (or pausedRemaining while paused)
// rather than a stored countdown, so it stays correct across re-renders and
// doesn't drift from setInterval jitter.
export function getRemaining(mit: MITState): number {
  if (mit.isPaused) return mit.pausedRemaining;
  const elapsedSecs = (Date.now() - mit.startedAt) / 1000;
  return mit.estimateSecs - elapsedSecs;
}
