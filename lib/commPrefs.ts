// Pure helper — no DB imports, unit-testable like lib/noShowRisk.ts.
//
// `patients.comm_prefs` (see lib/types/patient.ts's CommPrefs, edited via
// components/patient/CommPrefsCard.tsx) already lets a patient opt out of a
// channel — but until now nothing in lib/jobsRunner.ts actually looked at
// it: every automated SMS (reminders, risk outreach, lifecycle reactivation,
// recall reminders, waitlist slot offers) went out regardless of
// `doNotContact`. That's a real compliance-shaped bug, not a missing nice-to-
// have — a patient who explicitly said "don't SMS me" kept getting texted.
//
// Every automated queue*() function in lib/jobsRunner.ts (and
// notifyWaitlistOfFreedSlot in lib/waitlist.ts) must call this before
// queuing a message. A human sending something manually (e.g. a receptionist
// typing a note) is unaffected — this only gates the automated jobs.

export interface CommPrefsLike {
  doNotContact?: string[] | null;
}

// 'phone' é a chamada; 'sms' é a mensagem. O e-mail saiu com a decisão de o agente ser
// só chamada e SMS (migração 052) — `patients.email` continua a existir como campo da
// ficha, mas já não é uma via por onde o sistema fale com ninguém.
export function canAutoContact(commPrefs: CommPrefsLike | null | undefined, channel: 'sms' | 'phone') {
  const list = commPrefs?.doNotContact;
  if (!Array.isArray(list)) return true;
  return !list.includes(channel);
}
