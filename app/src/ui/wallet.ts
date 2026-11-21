import { useCallback, useEffect, useState } from "react";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { findWallet, InjectedWallet } from "../chain/client";
import { BASE_RPC } from "../chain/config";

export interface WalletState {
  wallet: InjectedWallet;
  name: string;
  pubkey: PublicKey;
  balance: number | null; // SOL on devnet
}

const base = new Connection(BASE_RPC, "confirmed");
export const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 4 });
export const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

/** A browser wallet (Phantom / Solflare / Backpack), only needed for staked tables. */
export function useWallet() {
  const [state, setState] = useState<WalletState | null>(null);
  const [available, setAvailable] = useState<string | null>(null);

  useEffect(() => {
    // wallets inject late; look a few times
    let n = 0;
    const look = () => { const f = findWallet(); setAvailable(f?.name ?? null); if (!f && ++n < 6) setTimeout(look, 500); };
    look();
  }, []);

  const refresh = useCallback(async (s: WalletState | null = state) => {
    if (!s) return;
    const b = await base.getBalance(s.pubkey).catch(() => null);
    setState((cur) => (cur && cur.pubkey.equals(s.pubkey) ? { ...cur, balance: b === null ? null : b / LAMPORTS_PER_SOL } : cur));
  }, [state]);

  const connect = useCallback(async (): Promise<WalletState> => {
    const f = findWallet();
    if (!f) throw new Error("No Solana wallet found. Install Phantom or Solflare, switch it to Devnet, then reload.");
    const res = await f.wallet.connect();
    const pk = (res && (res as any).publicKey) || f.wallet.publicKey;
    if (!pk) throw new Error("The wallet did not share a public key.");
    const s: WalletState = { wallet: f.wallet, name: f.name, pubkey: new PublicKey(pk.toString()), balance: null };
    setState(s);
    refresh(s);
    return s;
  }, [refresh]);

  const disconnect = useCallback(async () => {
    try { await state?.wallet.disconnect?.(); } catch { /* ignore */ }
    setState(null);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const t = setInterval(() => refresh(), 15_000);
    return () => clearInterval(t);
  }, [state, refresh]);

  return { wallet: state, available, connect, disconnect, refresh };
}
