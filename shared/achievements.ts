import type { Achievement } from './contracts.js';
// Older awards have no counter and represent a completed one-step achievement.
export const achievementTarget = (a: Achievement) => a.target ?? 1;
export const achievementProgress = (a: Achievement) => a.progress ?? 1;
export const achievementComplete = (a: Achievement) =>
  achievementProgress(a) >= achievementTarget(a);
