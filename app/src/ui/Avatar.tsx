import { useEffect, useRef } from "react";
import { drawAvatar } from "../game/render";

/** One robber, drawn by the same sprite code as the game. `animate` adds an idle bob. */
export default function Avatar({ seat, size = 48, ghost, ko, mole, facing, animate, className }: {
  seat: number; size?: number; ghost?: boolean; ko?: boolean; mole?: boolean; facing?: number; animate?: boolean; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const paint = (t: number) => {
      drawAvatar(ctx, c.width, c.height, seat, { ghost, ko, mole, facing, t: t + seat * 500 });
      if (animate || ghost) raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [seat, size, ghost, ko, mole, facing, animate]);
  return <canvas ref={ref} className={`avatar ${className ?? ""}`} style={{ width: size, height: size }} />;
}
