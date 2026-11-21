// Product analytics via Vercel Web Analytics (page views are automatic; these are custom
// events). Values are coarse game facts only: room ids, outcomes, step names. Never keys,
// wallets, names or chat.
import { track } from "@vercel/analytics";

type Props = Record<string, string | number | boolean | null>;

export function trackEvent(name: string, props: Props = {}) {
  try {
    track(name, props);
  } catch {
    /* analytics must never break the game */
  }
}
