import { useState } from "react";
import type { TxEvent } from "../chain/client";
import { explorerTx } from "../chain/config";

/**
 * Every transaction this browser sent, with where it lives and an explorer link.
 * Floating pill on the landing page; `inline` (inside the in-game 🔒 drawer) so it
 * never covers the heist.
 */
export default function ChainLog({ txs, inline, totals }: { txs: TxEvent[]; inline?: boolean; totals?: { all: number; acts: number } }) {
  const [open, setOpen] = useState(false);
  const acts = totals?.acts ?? txs.filter((t) => t.label === "act").length;
  const all = totals?.all ?? txs.length;
  const shown = txs.filter((t) => t.label !== "act").slice(0, 30);
  const rows = shown.map((t) => (
    <a key={t.sig} href={explorerTx(t.sig, !t.base)} target="_blank" rel="noreferrer" className={`logrow ${t.ok === false ? "bad" : t.ok ? "ok" : ""}`}>
      <span><span className={`where ${t.base ? "sol" : "tee"}`}>{t.base ? "SOLANA" : "TEE"}</span> {t.label}</span>
      <span className="mono small">{t.sig.slice(0, 10)}…</span>
      <span className="small">{t.ok === false ? `✗ ${t.err?.slice(0, 40)}` : t.ok ? "✓" : "…"}</span>
    </a>
  ));
  if (inline) {
    return (
      <div className="proofcard">
        <h3>⛓ Chain log · {all} txs ({acts} moves)</h3>
        <p className="muted small">Every move is a gasless transaction on MagicBlock's Private Ephemeral Rollup, signed by your session key. Moves are not listed individually.</p>
        <div className="loglist inline">{rows.length ? rows : <span className="muted small">Nothing yet.</span>}</div>
      </div>
    );
  }
  return (
    <div className={`chainlog ${open ? "open" : ""}`}>
      <button className="pill" onClick={() => setOpen(!open)}>
        <span className="live" /> Solana → <b>TEE rollup</b> → Solana · {all} txs ({acts} moves) {open ? "▾" : "▴"}
      </button>
      {open && (
        <div className="loglist">
          <p className="muted small">Every move is a gasless transaction on MagicBlock's Private Ephemeral Rollup, signed by your session key. Moves are not listed individually.</p>
          {rows}
        </div>
      )}
    </div>
  );
}
