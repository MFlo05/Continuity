import type { PageLayout } from './types';

export const DEFAULT_PAGES: PageLayout[] = [
  {
    id: 'work',
    label: 'Work',
    items: [
      { id: 'work-taskmgr',    type: 'task-manager',  x: 0, y: 0,  w: 12, h: 6 },
      { id: 'work-cal',        type: 'calendar-strip', x: 0, y: 6, w: 12, h: 3 },
      { id: 'work-kanban',     type: 'kanban',        x: 0, y: 8,  w: 6,  h: 10,
        config: { listFile: 'Work', col1: 'Active', col2: 'On Hold' } },
      { id: 'work-meeting',    type: 'meeting-log',   x: 6, y: 8,  w: 6,  h: 5 },
      { id: 'work-process',    type: 'process-notes', x: 6, y: 13, w: 6,  h: 5 },
    ],
  },
  {
    id: 'life',
    label: 'Life',
    items: [
      { id: 'life-taskmgr',    type: 'task-manager',  x: 0, y: 0, w: 12, h: 6 },
      { id: 'life-cal',        type: 'calendar-strip', x: 0, y: 6, w: 12, h: 3 },
      { id: 'life-kanban',     type: 'kanban',        x: 0, y: 8, w: 12, h: 10,
        config: { listFile: 'Life', col1: 'Active', col2: 'On Hold' } },
    ],
  },
  {
    id: 'budget',
    label: 'Budget',
    items: [
      { id: 'budget-period',  type: 'time-period',          x: 0, y: 0,  w: 3,  h: 2 },
      { id: 'budget-yearly',  type: 'budget-stats-yearly',  x: 0, y: 2,  w: 12, h: 2 },
      { id: 'budget-monthly', type: 'budget-stats-monthly', x: 0, y: 4,  w: 12, h: 2 },
      { id: 'budget-donut',   type: 'expense-donut',        x: 0, y: 6,  w: 6,  h: 6 },
      { id: 'budget-bar',     type: 'income-expense-bar',   x: 6, y: 6,  w: 6,  h: 6 },
      { id: 'budget-tracker', type: 'income-expense-tracker', x: 0, y: 12, w: 6, h: 4 },
    ],
  },
  {
    id: 'grow',
    label: 'Grow',
    items: [
      { id: 'grow-art',          type: 'art-quote-hero',    x: 0, y: 0,  w: 12, h: 4 },
      { id: 'grow-french-read',  type: 'french-reading',    x: 0, y: 4,  w: 6,  h: 10 },
      { id: 'grow-french-flash', type: 'french-flashcards', x: 6, y: 4,  w: 6,  h: 10 },
      { id: 'grow-bookmarks',    type: 'bookmark-revival',  x: 0, y: 14, w: 6,  h: 5 },
      { id: 'grow-braindump',    type: 'brain-dump',        x: 6, y: 14, w: 6,  h: 5 },
    ],
  },
];
