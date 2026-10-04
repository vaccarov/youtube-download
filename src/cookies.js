import { ALL_CLIENTS, baseArgs, cookieArgs } from './args.js';
import { DEFAULT_COOKIES_BROWSERS } from './config.js';
import { ICON } from './terminal.js';
import { captureYtDlp } from './ytdlp.js';

/** Errors meaning YouTube demands a signed-in session to even list better formats. */
const SIGNIN_PATTERN = [
  /Please sign in/i,
  /Sign in to confirm/i,
  /Sign in required/i,
  /confirm you.?'re not a bot/i,
  /not a bot/i,
  /bot check/i,
];

export function isSignInError(message) {
  return SIGNIN_PATTERN.some((pattern) => pattern.test(message ?? ''));
}

/**
 * Probes each browser in order with a harmless --simulate extraction on a single
 * video, and returns the first one whose cookies unlock it. Never downloads.
 */
export async function findWorkingCookiesBrowser(context, videoUrl) {
  for (const browser of DEFAULT_COOKIES_BROWSERS) {
    console.log(`${ICON.tool} Trying ${browser} cookies...`);
    const args = [
      ...baseArgs(context),
      ...cookieArgs({ ...context, cookies: browser }),
      ...ALL_CLIENTS,
      '--simulate',
      videoUrl,
    ];
    const { code, stderr } = await captureYtDlp(context, args);
    if (code === 0) {
      console.log(`${ICON.ok} ${browser}: session OK.`);
      return browser;
    }
    const detail = stderr.split('\n').find((line) => line.includes('ERROR'))?.replace(/^ERROR:\s*/, '').trim();
    if (context.verbose) console.log(`${ICON.warn} ${browser}: ${detail ?? `exit ${code}`}`);
  }
  return null;
}