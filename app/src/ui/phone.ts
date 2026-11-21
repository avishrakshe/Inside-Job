// Phone mode: the whole app plays as a landscape game (intro → menu → lobby → heist).
// Android: fullscreen + orientation lock. iOS (no lock) or a portrait-locked phone: the
// app shell is rotated 90° in CSS (`.shell.rot`), and touch input is rotated to match.
import { useEffect, useState } from "react";

export function useMedia(q: string) {
  const [m, setM] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return m;
}

/** ?touch=1 forces the phone build on a desktop browser (QA). */
export const FORCE_TOUCH = typeof location !== "undefined" && /[?&]touch=1/.test(location.search);

/** A phone (not a tablet): touch-first and a short side. */
export function usePhone() {
  const coarse = useMedia("(pointer: coarse)");
  const small = typeof screen !== "undefined" && Math.min(screen.width, screen.height) < 600;
  return FORCE_TOUCH || (coarse && small);
}

/**
 * Is the phone physically held upright? Uses the device orientation, not the viewport shape:
 * `(orientation: portrait)` flips to "landscape" when the on-screen keyboard squashes the
 * viewport, which un-rotated the whole game the moment you tapped a chat box.
 */
function devicePortrait(): boolean {
  if (FORCE_TOUCH) return matchMedia("(orientation: portrait)").matches; // desktop QA: window shape
  const t = (screen as any).orientation?.type as string | undefined;
  if (t) return t.startsWith("portrait");
  const o = (window as any).orientation;
  if (typeof o === "number") return o % 180 === 0;
  return Math.min(screen.width, screen.height) === screen.width && screen.height > screen.width;
}

export function usePortrait() {
  const [p, setP] = useState(() => typeof screen !== "undefined" && devicePortrait());
  useEffect(() => {
    const f = () => setP(devicePortrait());
    const so = (screen as any).orientation;
    so?.addEventListener?.("change", f);
    window.addEventListener("orientationchange", f);
    window.addEventListener("resize", f);
    const mq = matchMedia("(orientation: portrait)");
    mq.addEventListener("change", f);
    f();
    return () => {
      so?.removeEventListener?.("change", f);
      window.removeEventListener("orientationchange", f);
      window.removeEventListener("resize", f);
      mq.removeEventListener("change", f);
    };
  }, []);
  return p;
}

const canFullscreen = () => {
  const el = document.documentElement as any;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
};
const inFullscreen = () => !!(document.fullscreenElement || (document as any).webkitFullscreenElement);

/** Call from a tap (user activation is required). Silent where unsupported (iPhone Safari). */
export function goLandscape() {
  const el = document.documentElement as any;
  const lock = () => (screen.orientation as any)?.lock?.("landscape")?.catch?.(() => {});
  if (inFullscreen()) { lock(); return; }
  if (!canFullscreen()) return;
  try {
    const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.();
    Promise.resolve(fs).then(lock).catch(() => {});
  } catch { /* not allowed here */ }
}

/**
 * A tap re-enters fullscreen landscape if the browser dropped out of it, but at most every
 * 20 s: re-requesting on every joystick release resized the screen mid-heist and fought a
 * player who had deliberately left fullscreen.
 */
let lastRetry = 0;
export function keepLandscape() {
  if (inFullscreen() || !canFullscreen()) return;
  const now = Date.now();
  if (now - lastRetry < 20_000) return;
  lastRetry = now;
  goLandscape();
}

/** Map a screen-space vector into the (possibly rotated) app's own axes. */
export function unrotate(el: Element, sx: number, sy: number): [number, number] {
  return el.closest(".rot") ? [sy, -sx] : [sx, sy];
}
