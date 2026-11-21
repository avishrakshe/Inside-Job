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

/** Call from a tap (user activation is required). Silent where unsupported. */
export function goLandscape() {
  const el = document.documentElement as any;
  if (document.fullscreenElement) {
    (screen.orientation as any)?.lock?.("landscape")?.catch?.(() => {});
    return;
  }
  const fs = el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.();
  Promise.resolve(fs)
    .then(() => (screen.orientation as any)?.lock?.("landscape"))
    .catch(() => {});
}

/** Map a screen-space vector into the (possibly rotated) app's own axes. */
export function unrotate(el: Element, sx: number, sy: number): [number, number] {
  return el.closest(".rot") ? [sy, -sx] : [sx, sy];
}
