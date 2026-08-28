// One-off OpenAI key, scoped to the browser session.
//
// Admin-only by design: it is the escape hatch for "the project key is out of
// credit and I need this produced now", and it bills the admin's own account.
// The UI never offers it to a regular user, and the server rejects it from one
// (rejectClientOpenAiKeyIfDisabled). sessionStorage clears with the tab, so the
// next visit falls back to the project key.
const SESSION_OPENAI_KEY = 'openai_session_key';

export function getSessionOpenAiKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_OPENAI_KEY);
  } catch {
    return null;
  }
}

export function setSessionOpenAiKey(key: string) {
  try {
    sessionStorage.setItem(SESSION_OPENAI_KEY, key);
  } catch {
    /* sessionStorage unavailable — the key just won't persist for the session */
  }
}

export function clearSessionOpenAiKey() {
  try {
    sessionStorage.removeItem(SESSION_OPENAI_KEY);
  } catch {
    /* ignore */
  }
}
