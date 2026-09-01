// Pure helpers for checklist run items — no DB imports, unit-testable like
// lib/staffAvailabilityCalc.ts. A run's `items` column stores a snapshot taken from the
// template at creation time (see scripts/migrations/025_clinic_operations.sql), so all of
// this operates on plain arrays, never on the template itself.

export interface ChecklistRunItem {
  label: string;
  checked: boolean;
  checkedBy: string | null;
  checkedByName: string | null;
  checkedAt: string | null;
}

// Builds the initial snapshot for a new run from a template's item labels — everything
// starts unchecked.
export function snapshotItems(labels: string[]): ChecklistRunItem[] {
  return labels.map((label) => ({ label, checked: false, checkedBy: null, checkedByName: null, checkedAt: null }));
}

// Toggles a single item by index, stamping who did it and when when checking (and
// clearing the stamp when unchecking — an unchecked item was, by definition, not done by
// anyone). Returns a new array; never mutates `items`.
export function toggleItem(
  items: ChecklistRunItem[],
  index: number,
  checked: boolean,
  userId: string,
  userName: string,
  now: Date,
): ChecklistRunItem[] {
  return items.map((item, i) => {
    if (i !== index) return item;
    return checked
      ? { ...item, checked: true, checkedBy: userId, checkedByName: userName, checkedAt: now.toISOString() }
      : { ...item, checked: false, checkedBy: null, checkedByName: null, checkedAt: null };
  });
}

// A run with zero items is never "complete" — there's nothing to have finished checking,
// so it stays in_progress until the template it came from actually has items.
export function isRunComplete(items: ChecklistRunItem[]): boolean {
  return items.length > 0 && items.every((i) => i.checked);
}

export function countChecked(items: ChecklistRunItem[]): number {
  return items.filter((i) => i.checked).length;
}
