// Screen Wake Lock (W4.0-1): keep the display on while the game is visible.
// Android installed-PWAs dim into screen lock during touch-idle stretches
// (prep phase, watching a wave resolve) — rAF alone doesn't stop the OS
// idle timeout. Feature-detected no-op where the API is missing; a denied
// request (low battery, platform refusal) is also non-fatal: game runs on.
//
// Lifecycle: the browser force-releases the sentinel when the document
// hides; we re-acquire on the visibilitychange back to visible.

let sentinel: WakeLockSentinel | null = null;

async function acquire(): Promise<void> {
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null; // denied or unsupported at runtime — retry never blocks play
  }
}

/** Acquire a screen wake lock for the app's lifetime (re-acquires on return
 *  from background). Call once at startup; safe to call where unsupported. */
export function keepScreenAwake(): void {
  if (!('wakeLock' in navigator)) return;
  if (document.visibilityState === 'visible') void acquire();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}
