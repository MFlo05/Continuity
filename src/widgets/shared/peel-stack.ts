// Scroll-driven "peel stack" physics — shared by the Meal Planner's Recipe
// Box modal (RecipeBoxModal.tsx) and the standalone Recipe Box widget
// (recipe-box/RecipeBoxWidget.tsx). Extracted here (rather than left
// duplicated in both, the usual "two instances isn't there yet" rule) since
// it's not just similar-looking code — it's the exact numeric behavior the
// user asked to keep identical between the two, just at different scales.
// Everything else (scroll handler, DOM refs, windowing, card markup) stays
// separately implemented per file.
//
// i = a card's absolute index in the filtered list, k = the fractional
// "current front index" derived from scroll position. `front` is normally
// `cap * peek` — computed by the caller, not baked in here, since callers
// use very different peek/cap values for a modal-sized vs. widget-sized card.
export interface PeelConfig {
  peek:      number;
  scaleStep: number;
  cap:       number;
  front:     number;
}

export interface PeelResult {
  ty:  number;
  sc:  number;
  op:  number;
  rot: number;
  z:   number;
}

export function peelFor(i: number, k: number, cfg: PeelConfig): PeelResult {
  const { peek, scaleStep, cap, front } = cfg;
  const eff = i - k;
  if (eff <= -1) return { ty: front + 400, sc: 1, op: 0, rot: 0, z: 50 };
  if (eff < 0) {
    const peel = -eff;
    return { ty: front + peel * 400, sc: 1 - peel * 0.03, op: peel > 0.82 ? 0 : 1, rot: peel * 4, z: 110 };
  }
  const d = Math.min(eff, cap);
  return { ty: front - d * peek, sc: 1 - d * scaleStep, op: eff > cap + 0.6 ? 0 : 1, rot: 0, z: 100 - Math.round(eff) };
}
