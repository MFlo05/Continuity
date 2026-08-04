import type { LayoutItem } from '../../types';

// Seeded the first time a class's own page is opened (see class-layout.ts's
// readClassLayout) — mirrors the real, hand-arranged layout on ANGL-123 (a
// live class in the vault) now that all 7 class-page widgets exist, rather
// than the original 5-widget mockup arrangement this replaced. Two-column:
// Notes+Assignments+Resources/Policies/Grade left-and-bottom (w8, x0),
// Calendar+Class Tasks right (w4, x8 — 8+4=12, exact fit on the 12-col
// grid). A function, not a static array, so every seed call mints fresh ids
// (same `${type}-${Date.now()}` convention as app.tsx's handleAddWidget) —
// two different classes opened for the first time in the same session must
// never end up sharing ids.
export function DEFAULT_CLASS_LAYOUT(): LayoutItem[] {
  const t = Date.now();
  return [
    { id: `class-notes-widget-${t}-0`,       type: 'class-notes-widget',       x: 0, y: 0,  w: 8, h: 4 },
    { id: `class-calendar-widget-${t}-1`,    type: 'class-calendar-widget',    x: 8, y: 0,  w: 4, h: 4 },
    { id: `class-assignments-widget-${t}-2`, type: 'class-assignments-widget', x: 0, y: 4,  w: 8, h: 5 },
    { id: `class-todo-widget-${t}-3`,        type: 'class-todo-widget',        x: 8, y: 4,  w: 4, h: 5 },
    { id: `class-resources-widget-${t}-4`,   type: 'class-resources-widget',   x: 0, y: 9,  w: 4, h: 3 },
    { id: `class-policies-widget-${t}-5`,    type: 'class-policies-widget',    x: 4, y: 9,  w: 4, h: 3 },
    { id: `class-grade-widget-${t}-6`,       type: 'class-grade-widget',       x: 8, y: 9,  w: 4, h: 3 },
  ];
}
