/** AAA extras (post stack, sun shadow map) — desktop by default, ?fx=off
 *  to A/B the cost in the overlay; phones skip them entirely. */
export const AAA_FX =
  typeof window !== 'undefined' &&
  !('ontouchstart' in window) &&
  new URLSearchParams(window.location.search).get('fx') !== 'off'
