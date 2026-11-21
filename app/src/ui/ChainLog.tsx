import { useState } from "react";
import type { TxEvent } from "../chain/client";
import { explorerTx } from "../chain/config";

/** Every transaction this browser sent, with where it lives and an explorer link. */
export default function ChainLog({ txs }: { txs: TxEvent[] }) {
  const [open, setOpen] = useState(false);
  const acts = txs.filter((t) => t.label === "act").length;
  const shown = txs.filter((t) => t.label !== "act").slice(0, 30);
  return (
    <div className={`chainlog ${open ? "open" : ""}`}>
      <button className="pill" onClick={() => setOpen(!open)}>
        <span className="live" /> Solana → <b>TEE rollup</b> → Solana · {txs.length} txs ({acts} moves) {open ? "▾" : "▴"}
      </button>
      {open && (
        <div className="loglist">
          <p className="muted small">Every move is a gasless transaction on MagicBlock's Private Ephemeral Rollup, signed by your session key. Moves are not listed individually.</p>
          {shown.map((t) => (
            <a key={t.sig} href={explorerTx(t.sig, !t.base)} target="_blank" rel="noreferrer" className={`logrow ${t.ok === false ? "bad" : t.ok ? "ok" : ""}`}>
              <span><span className={`where ${t.base ? "sol" : "tee"}`}>{t.base ? "SOLANA" : "TEE"}</span> {t.label}</span>
              <span className="mono small">{t.sig.slice(0, 10)}…</span>
              <span className="small">{t.ok === false ? `✗ ${t.err?.slice(0, 40)}` : t.ok ? "✓" : "…"}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
