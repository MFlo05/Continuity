/**
 * budget-categories.ts — keyword-based auto-categorizer for quick-capture
 * entries, transcribed from 00-System/Skills/budget-capture.md's category
 * tables. This is a manual copy, not a live read of that file — it can drift
 * if the skill doc's categories/keywords change. The "Clean up with AI"
 * button (which runs the actual skill) is the reconciliation path for
 * anything this misses or gets wrong.
 */

export const EXPENSE_CATEGORIES: Record<string, string[]> = {
  Housing:       ['rent', 'mortgage', 'hoa', 'property tax', 'home insurance'],
  Groceries:     ['groceries', 'supermarket', 'costco', 'whole foods', "trader joe's", 'food store', 'market', 'save on foods', 'h&w produce', 'safeway', 'sobeys', 'superstore'],
  Transport:     ['gas', 'fuel', 'uber', 'lyft', 'bus', 'metro', 'parking', 'car insurance', 'auto', 'ev charge', 'bird scooter'],
  Utilities:     ['electric', 'water', 'internet', 'phone bill', 'utility', 'epcor', 'wifi', 'telus', 'propane'],
  'Dining Out':  ['restaurant', 'dinner', 'lunch', 'coffee', 'café', 'cafe', 'bar', 'takeout', 'delivery', 'doordash', 'uber eats', 'breakfast', 'beers', 'pub', 'bistro'],
  Shopping:      ['amazon', 'clothes', 'shoes', 'target', 'walmart', 'online order', 'purchase', 'craft supplies'],
  'Savings/Inv': ['transfer to savings', 'investment', 'vanguard', 'fidelity', '401k', 'ira', 'brokerage', 'tfsa', 'questrade'],
  Entertainment: ['netflix', 'hulu', 'disney+', 'cinema', 'movie', 'concert', 'event', 'tickets'],
  Subscriptions: ['spotify', 'apple music', 'subscription', 'membership', 'annual fee', 'software', 'claude ai', 'ici.tv'],
  Health:        ['doctor', 'dentist', 'pharmacy', 'gym', 'health insurance', 'medical', 'prescription', 'personal care'],
  Hardware:      ['home depot', 'home hardware', 'rona', 'tools', 'home renos', 'tool rental', 'hardware store', 'plants', 'gardening', 'greenhouse', 'nursery', 'trailer rental', 'pressure washer'],
  Travel:        ['hotel', 'plane ticket', 'airline ticket', 'airbnb'],
  'Self Care':   ['haircut'],
};

export const INCOME_CATEGORIES: Record<string, string[]> = {
  Salary:         ['paycheck', 'paycheque', 'salary', 'direct deposit', 'employer', 'wages'],
  Freelance:      ['freelance', 'contract', 'invoice', 'client', 'consulting'],
  Investment:     ['dividend', 'interest', 'capital gain', 'stock sale'],
  'Side Hustle':  ['etsy', 'ebay', 'side project', 'gig'],
  Gift:           ['gift', 'birthday', 'e-transfer'],
  'Rental Income': ['rent payment', 'rental income', 'tenant'],
};

export const EXPENSE_FALLBACK = 'Other';
export const INCOME_FALLBACK = 'Other Income';

export const EXPENSE_CATEGORY_NAMES = [...Object.keys(EXPENSE_CATEGORIES), EXPENSE_FALLBACK];
export const INCOME_CATEGORY_NAMES = [...Object.keys(INCOME_CATEGORIES), INCOME_FALLBACK];

/** Lowercase substring match against each category's keyword list, first hit wins. */
export function guessCategory(description: string, kind: 'income' | 'expense'): string {
  const text = description.toLowerCase();
  const table = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  for (const [category, keywords] of Object.entries(table)) {
    if (keywords.some(k => text.includes(k))) return category;
  }
  return kind === 'expense' ? EXPENSE_FALLBACK : INCOME_FALLBACK;
}
