/**
 * Two small pieces of remembered user state, with deliberately different
 * lifetimes.
 *
 * THE EARTH PRO HINT is a convenience, so it is remembered FOREVER
 * (localStorage). Telling someone twice that .kmz files open in Google Earth
 * Pro is nagging.
 *
 * THE EARTH WEB CONSENT is a confidentiality decision, so it is remembered only
 * FOR THE SESSION (sessionStorage). It authorises putting a real surveyed
 * coordinate into a third-party URL, which CLAUDE.md otherwise forbids
 * outright. Persisting that across sessions would mean a decision taken once,
 * months ago, silently authorising every future coordinate — including for
 * sites and datasets that did not exist when it was given. A session is short
 * enough that the person clicking is the person who agreed.
 *
 * Both accessors are wrapped: Safari private mode throws on storage access
 * rather than returning null, and a thrown error here must never break an
 * upload flow. Failing closed is right for consent (ask again) and harmless for
 * the hint (show it again).
 */

const HINT_KEY = 'naksha.kmz.earthProHintDismissed';
const CONSENT_KEY = 'naksha.kmz.earthWebConsented';

function readFlag(storage: 'local' | 'session', key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    return store.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeFlag(storage: 'local' | 'session', key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    store.setItem(key, 'true');
  } catch {
    // Nothing to do and nothing worth reporting: the user simply sees the hint
    // or the confirmation once more.
  }
}

/** Has the user dismissed the "opens in Google Earth Pro" hint, ever? */
export const earthProHintDismissed = (): boolean => readFlag('local', HINT_KEY);
export const dismissEarthProHint = (): void => writeFlag('local', HINT_KEY);

/** Has the user agreed, this session, to send coordinates to Google Earth Web? */
export const earthWebConsented = (): boolean => readFlag('session', CONSENT_KEY);
export const grantEarthWebConsent = (): void => writeFlag('session', CONSENT_KEY);
