import api from './api';

// Whether a cancellation has to say why is a setting, not a constant:
// Leave Tracker > Configuration > Leave Request. Every screen that cancels a
// leave asks the same question through here, so the three of them cannot drift
// into asking for a reason in one place and silently skipping it in another —
// the server rejects a missing reason regardless of which screen sent it.
let cached = null;

export async function cancellationRules() {
  if (cached) return cached;
  try {
    const r = await api.get('/leave-config/request');
    cached = r.data.data || {};
  } catch {
    // A failed read must not block cancelling. The server still enforces the
    // rule, so the worst case is one avoidable round trip telling the user a
    // reason is needed.
    cached = {};
  }
  return cached;
}

/**
 * Confirms the cancellation and collects a reason when one is required.
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function confirmCancel(message = 'Cancel this leave request?') {
  const rules = await cancellationRules();
  if (!rules.cancellationReasonMandatory) {
    return { ok: window.confirm(message), reason: '' };
  }
  const reason = window.prompt(`${message}\n\nReason for cancelling:`);
  if (reason === null) return { ok: false, reason: '' };
  if (!reason.trim()) {
    return { ok: false, reason: '', empty: true };
  }
  return { ok: true, reason: reason.trim() };
}
