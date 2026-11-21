import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  Commitment, ComputeBudgetProgram, Connection, Keypair, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY, SystemProgram,
  Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { getAuthToken, permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import idl from "../idl/inside_job.json";
import {
  ATA_PROGRAM, BASE_RPC, EPHEMERAL_VAULT, MAGIC_CONTEXT, MAGIC_PROGRAM, PROGRAM_ID, TEE_RPC, TEE_WS, TOKEN_PROGRAM, VRF_EPHEMERAL_QUEUE,
} from "./config";
import { ROOM_SIZE, decodeMarket, decodePot, decodeRoom, decodeView, decodeWorld, MarketState, MAXP, PotState, RoomState, ViewState, WorldState } from "./decode";

export const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
export const VRF_PROGRAM = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");

const le64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const roomPda = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("room"), le64(id)], PROGRAM_ID)[0];
export const worldPda = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("world"), le64(id)], PROGRAM_ID)[0];
export const viewPda = (id: number, seat: number) =>
  PublicKey.findProgramAddressSync([Buffer.from("view"), le64(id), Buffer.from([seat])], PROGRAM_ID)[0];
export const permPda = (acc: PublicKey) => permissionPdaFromAccount(acc);
const pdaCache = new Map<number, { room: PublicKey; world: PublicKey }>();
const pdasOf = (id: number) => {
  let p = pdaCache.get(id);
  if (!p) { p = { room: roomPda(id), world: worldPda(id) }; pdaCache.set(id, p); }
  return p;
};
const ACT_DISC = Buffer.from((idl as any).instructions.find((i: any) => i.name === "act").discriminator);
const le64n = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
export const potPda = (id: number, nonce: bigint) =>
  PublicKey.findProgramAddressSync([Buffer.from("pot"), le64(id), le64n(nonce)], PROGRAM_ID)[0];
/** The heist's move log (rollup only; sealed until lights-on). */
export const logPda = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("log"), le64(id)], PROGRAM_ID)[0];
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
/** The Tip Line for heist `matchNo` of room `id` (Solana). */
export const marketPda = (id: number, matchNo: number) =>
  PublicKey.findProgramAddressSync([Buffer.from("market"), le64(id), le32(matchNo)], PROGRAM_ID)[0];
/** Associated token account of `owner` for `mint`. */
export const ataOf = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
export function randomNonce(): bigint {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  const n = Buffer.from(b).readBigUInt64LE(0);
  return n === 0n ? 1n : n;
}

/** Any injected Solana wallet (Phantom, Solflare, Backpack…): the subset we use. */
export interface InjectedWallet {
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey } | void>;
  disconnect?(): Promise<void>;
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
  isPhantom?: boolean;
  isSolflare?: boolean;
}
export function findWallet(): { wallet: InjectedWallet; name: string } | null {
  const w = window as any;
  if (w.phantom?.solana) return { wallet: w.phantom.solana, name: "Phantom" };
  if (w.solflare?.isSolflare) return { wallet: w.solflare, name: "Solflare" };
  if (w.backpack?.solana) return { wallet: w.backpack.solana, name: "Backpack" };
  if (w.solana) return { wallet: w.solana, name: "Wallet" };
  return null;
}
export const vrfIdentity = () => PublicKey.findProgramAddressSync([Buffer.from("identity")], PROGRAM_ID)[0];

export interface TxEvent { sig: string; label: string; at: number; ok?: boolean; err?: string; base?: boolean }

/** A wallet adapter backed by an in-memory keypair (the browser session key). */
export class KeyWallet {
  constructor(public payer: Keypair) {}
  get publicKey() { return this.payer.publicKey; }
  async signTransaction<T extends Transaction>(tx: T): Promise<T> { tx.partialSign(this.payer); return tx; }
  async signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]> { txs.forEach((t) => t.partialSign(this.payer)); return txs; }
}

export function loadSessionKey(storageKey = "ij.session"): Keypair {
  try {
    const s = localStorage.getItem(storageKey);
    if (s) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  } catch { /* ignore */ }
  const kp = Keypair.generate();
  try { localStorage.setItem(storageKey, JSON.stringify([...kp.secretKey])); } catch { /* private mode */ }
  return kp;
}

export function randomSalt(): number[] {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b];
}

export function encodeName(name: string): number[] {
  const b = new TextEncoder().encode(name.trim().toUpperCase().slice(0, 12));
  const out = new Array(12).fill(0);
  b.slice(0, 12).forEach((x, i) => (out[i] = x));
  return out;
}

export class GameClient {
  conn!: Connection;
  program!: Program;
  token = "";
  listeners: ((e: TxEvent) => void)[] = [];
  private seq = 1;

  constructor(public session: Keypair, public commitment: Commitment = "confirmed") {}

  get pubkey() { return this.session.publicKey; }

  /** Sign the TEE's challenge with the session key (no wallet popup) and open the rollup. */
  async connect(): Promise<void> {
    const res = await getAuthToken(TEE_RPC, this.session.publicKey, async (m: Uint8Array) => nacl.sign.detached(m, this.session.secretKey));
    this.token = res.token;
    this.conn = new Connection(`${TEE_RPC}?token=${this.token}`, { wsEndpoint: `${TEE_WS}?token=${this.token}`, commitment: this.commitment });
    const provider = new AnchorProvider(this.conn, new KeyWallet(this.session) as any, { commitment: this.commitment, skipPreflight: true });
    this.program = new Program(idl as Idl, provider);
  }

  onTx(fn: (e: TxEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  private emit(e: TxEvent) { this.listeners.forEach((f) => f(e)); }

  // ---- blockhash cache for the move stream. A rollup blockhash stays valid for 6000 slots
  // (~60 s); fetching one per move cost a full extra round trip on every 100 ms step.
  // Only `act` uses it: each act carries a fresh seq, so its signature is always unique.
  // (A cached hash would make two identical `tick`s collide as "already processed".)
  private bh: { hash: string; at: number } | null = null;
  private bhLoading: Promise<string> | null = null;
  private refreshBlockhash(): Promise<string> {
    if (!this.bhLoading) {
      this.bhLoading = this.conn.getLatestBlockhash().then((r) => {
        this.bh = { hash: r.blockhash, at: Date.now() };
        return r.blockhash;
      }).finally(() => { this.bhLoading = null; });
    }
    return this.bhLoading;
  }
  private async fastBlockhash(): Promise<string> {
    const b = this.bh, age = b ? Date.now() - b.at : Infinity;
    if (b && age < 20_000) {
      if (age > 6_000) this.refreshBlockhash().catch(() => {}); // refresh in the background
      return b.hash;
    }
    return this.refreshBlockhash();
  }

  async send(ixs: TransactionInstruction[], label: string, opts: { confirm?: boolean; fastHash?: boolean } = {}): Promise<string> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.session.publicKey;
    tx.recentBlockhash = opts.fastHash ? await this.fastBlockhash() : (await this.conn.getLatestBlockhash()).blockhash;
    tx.sign(this.session);
    const sig = await this.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const ev: TxEvent = { sig, label, at: Date.now() };
    this.emit(ev);
    if (opts.confirm !== false) {
      const r = await this.conn.confirmTransaction(sig, this.commitment);
      if (r.value.err) {
        const err = await this.explain(sig, r.value.err);
        this.emit({ ...ev, ok: false, err });
        throw new Error(`${label} failed: ${err}`);
      }
      this.emit({ ...ev, ok: true });
    }
    return sig;
  }

  private async explain(sig: string, fallback: unknown): Promise<string> {
    try {
      const tx = await this.conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? [];
      const m = logs.find((l) => l.includes("Error Message:")) ?? logs.find((l) => l.includes("failed")) ?? "";
      return m.replace(/^Program log: AnchorError.*Error Message: /, "") || JSON.stringify(fallback);
    } catch {
      return JSON.stringify(fallback);
    }
  }

  // ------------------------------------------------------------ reads

  // ---- resilience: three failed reads in a row → fresh TEE auth token + connection
  private fails = 0;
  private reauthing: Promise<void> | null = null;
  private noteOk() { this.fails = 0; }
  private noteFail() {
    if (++this.fails >= 3 && !this.reauthing) {
      this.reauthing = this.connect().catch(() => {}).finally(() => { this.reauthing = null; this.fails = 0; });
    }
  }

  async fetchRooms(ids: number[]): Promise<(RoomState | null)[]> {
    let infos;
    try { infos = await this.conn.getMultipleAccountsInfo(ids.map(roomPda)); this.noteOk(); } catch (e) { this.noteFail(); throw e; }
    return infos.map((i) => (i && i.data.length >= 8 + ROOM_SIZE ? decodeRoom(i.data) : null));
  }
  async fetchRoom(id: number) { return (await this.fetchRooms([id]))[0]; }
  async fetchView(id: number, seat: number): Promise<ViewState | null> {
    let i;
    try { i = await this.conn.getAccountInfo(viewPda(id, seat)); this.noteOk(); } catch (e) { this.noteFail(); throw e; }
    return i && i.data.length >= 120 ? decodeView(i.data) : null;
  }
  async fetchWorld(id: number): Promise<WorldState | null> {
    const i = await this.conn.getAccountInfo(worldPda(id));
    return i && i.data.length >= 600 ? decodeWorld(i.data) : null;
  }
  /** Raw Room + World + move log from the rollup (public after lights-on) for the replay. */
  async fetchRevealed(id: number): Promise<{ room: Uint8Array; world: Uint8Array; log: Uint8Array } | null> {
    const [r, w, l] = await this.conn.getMultipleAccountsInfo([roomPda(id), worldPda(id), logPda(id)]);
    if (!r || !w || !l) return null;
    return { room: r.data, world: w.data, log: l.data };
  }
  /** The Room as Solana holds it (the last commit), read from the base layer. */
  async fetchBaseRoom(id: number): Promise<RoomState | null> {
    const i = await this.base.getAccountInfo(roomPda(id));
    return i && i.data.length >= 8 + ROOM_SIZE ? decodeRoom(i.data) : null;
  }
  /** Token base units `owner` holds of `mint` (0 if no token account yet). */
  async tokenUnits(owner: PublicKey, mint: PublicKey): Promise<number> {
    try { return Number((await this.base.getTokenAccountBalance(ataOf(owner, mint))).value.amount); } catch { return 0; }
  }
  async fetchMarket(id: number, matchNo: number): Promise<MarketState | null> {
    const i = await this.base.getAccountInfo(marketPda(id, matchNo));
    return i && i.data.length >= 8 + 1362 ? decodeMarket(i.data) : null;
  }
  /** Raw read used by the "try to cheat" console: returns null when the TEE refuses. */
  async tryRead(addr: PublicKey): Promise<{ ok: boolean; bytes: number; note: string }> {
    try {
      const i = await this.conn.getAccountInfo(addr);
      if (!i) return { ok: false, bytes: 0, note: "TEE returned null — sealed" };
      return { ok: true, bytes: i.data.length, note: `readable (${i.data.length} bytes)` };
    } catch (e: any) {
      return { ok: false, bytes: 0, note: `refused: ${String(e?.message ?? e).slice(0, 80)}` };
    }
  }

  /**
   * Wiretap attempt for the "try to cheat" console: fetch a gameplay tx with NO auth token.
   * The TEE RPC returns a redacted shell (signature, slot, time; no accounts, data or logs).
   */
  async tryReadTx(sig: string): Promise<{ ok: boolean; note: string }> {
    try {
      const t: any = await new Connection(TEE_RPC, "confirmed").getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!t) return { ok: false, note: "not found" };
      const m = t.transaction?.message;
      const keys = (m?.staticAccountKeys ?? m?.accountKeys ?? []).length;
      const ixs = (m?.compiledInstructions ?? m?.instructions ?? []).length;
      const logs = (t.meta?.logMessages ?? []).length;
      const leaked = keys + ixs + logs > 0;
      return { ok: leaked, note: leaked ? `${keys} accounts, ${ixs} instructions, ${logs} logs visible` : `redacted shell: slot ${t.slot}, 0 accounts, 0 instructions, 0 logs` };
    } catch (e: any) {
      return { ok: false, note: `refused: ${String(e?.message ?? e).slice(0, 80)}` };
    }
  }
  /** Can anyone list the transactions that touched an account (e.g. every move sent to the World)? */
  async tryListTxs(addr: PublicKey): Promise<{ ok: boolean; note: string }> {
    try {
      const sigs = await new Connection(TEE_RPC, "confirmed").getSignaturesForAddress(addr, { limit: 100 });
      return { ok: sigs.length > 0, note: `${sigs.length} signatures listed` };
    } catch (e: any) {
      return { ok: false, note: `refused: ${String(e?.message ?? e).slice(0, 80)}` };
    }
  }
  lastActSig = "";

  subscribeRoom(id: number, cb: (r: RoomState) => void): () => void {
    const sub = this.conn.onAccountChange(roomPda(id), (i) => cb(decodeRoom(i.data)), { commitment: "processed" });
    return () => { this.conn.removeAccountChangeListener(sub); };
  }
  subscribeView(id: number, seat: number, cb: (v: ViewState) => void): () => void {
    const sub = this.conn.onAccountChange(viewPda(id, seat), (i) => { if (i.data.length >= 120) cb(decodeView(i.data)); }, { commitment: "processed" });
    return () => { this.conn.removeAccountChangeListener(sub); };
  }

  // ------------------------------------------------------------ instructions

  private seatAccounts(id: number, seat: number) {
    const view = viewPda(id, seat);
    return {
      signer: this.pubkey, room: roomPda(id), world: worldPda(id), view, viewPermission: permPda(view),
      permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT, magicProgram: MAGIC_PROGRAM,
    };
  }
  private actAccounts(id: number) {
    return { player: this.pubkey, room: roomPda(id), world: worldPda(id) };
  }

  /** Free tables: no wallet. Staked tables: `wallet` + the Pot `nonce` the ticket was bought for. */
  async join(id: number, seat: number, name: string, wallet?: PublicKey, nonce: bigint = 0n) {
    let b = this.program.methods
      .join(seat, encodeName(name), wallet ?? this.pubkey, randomSalt(), new BN(nonce.toString()))
      .accountsPartial(this.seatAccounts(id, seat));
    if (nonce !== 0n) b = b.remainingAccounts([{ pubkey: potPda(id, nonce), isSigner: false, isWritable: false }]);
    return this.send([await b.instruction()], nonce ? `join seat ${seat} (staked)` : `join seat ${seat}`);
  }

  // ------------------------------------------------------------ Solana (base layer): the money

  base = new Connection(BASE_RPC, "confirmed");

  async fetchPot(id: number, nonce: bigint): Promise<PotState | null> {
    if (!nonce) return null;
    const i = await this.base.getAccountInfo(potPda(id, nonce));
    return i && i.data.length >= 8 + 612 ? decodePot(i.data) : null;
  }

  /** The wallet pays the stake (USDC) into the Pot and names this browser's session key. */
  async buyTicket(wallet: InjectedWallet, id: number, nonce: bigint, mint: PublicKey): Promise<string> {
    const owner = wallet.publicKey!;
    const pot = potPda(id, nonce);
    const ix = await this.program.methods
      .buyTicket(new BN(id), new BN(nonce.toString()), this.pubkey)
      .accountsPartial({
        wallet: owner, walletAta: ataOf(owner, mint), room: roomPda(id), pot, vault: ataOf(pot, mint), mint,
        tokenProgram: TOKEN_PROGRAM, ataProgram: ATA_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    return this.sendBase(wallet, [ix], "buy ticket (USDC into the Pot)");
  }

  private async potAccounts(id: number, nonce: bigint, mint: PublicKey) {
    const pot = await this.fetchPot(id, nonce);
    const potKey = potPda(id, nonce);
    const metas = [
      { pubkey: potKey, w: true }, { pubkey: roomPda(id), w: false }, { pubkey: ataOf(potKey, mint), w: true },
      { pubkey: mint, w: false }, { pubkey: TOKEN_PROGRAM, w: false },
      ...(pot ? pot.wallets.slice(0, pot.n).map((w) => ({ pubkey: ataOf(new PublicKey(w), mint), w: true })) : []),
    ];
    return metas.map((m) => ({ pubkey: m.pubkey, isSigner: false, isWritable: m.w }));
  }

  // ------------------------------------------------------------ Tip Line (Solana + rollup)

  /** Spectator: stake `units` of USDC on heist `matchNo`'s Tip Line, naming this session key. */
  async buyTip(wallet: InjectedWallet, id: number, matchNo: number, units: number, mint: PublicKey): Promise<string> {
    const owner = wallet.publicKey!;
    const market = marketPda(id, matchNo);
    const ix = await this.program.methods
      .buyTip(new BN(id), matchNo, new BN(units), this.pubkey)
      .accountsPartial({
        wallet: owner, walletAta: ataOf(owner, mint), room: roomPda(id), market, vault: ataOf(market, mint), mint,
        tokenProgram: TOKEN_PROGRAM, ataProgram: ATA_PROGRAM, systemProgram: SystemProgram.programId,
      })
      .instruction();
    return this.sendBase(wallet, [ix], "Tip Line: stake (USDC)");
  }
  /** Inside the rollup, signed by the session key the tip named: "seat N is the Mole". */
  async pick(id: number, matchNo: number, seat: number) {
    const ix = await this.program.methods.pick(seat).accountsPartial({ player: this.pubkey, room: roomPda(id) })
      .remainingAccounts([{ pubkey: marketPda(id, matchNo), isSigner: false, isWritable: false }]).instruction();
    return this.send([ix], `Tip Line: pick seat ${seat}`);
  }
  /** Permissionless fallback if the Magic Action didn't land (or a refund after 20 min). */
  async recordTips(wallet: InjectedWallet, id: number, matchNo: number) {
    const ix = await this.program.methods.recordTips(new BN(id), matchNo).accountsPartial({})
      .remainingAccounts([
        { pubkey: marketPda(id, matchNo), isSigner: false, isWritable: true },
        { pubkey: roomPda(id), isSigner: false, isWritable: false },
      ]).instruction();
    return this.sendBase(wallet, [ix], "Tip Line: resolve from the committed Room");
  }
  async claimTip(wallet: InjectedWallet, id: number, matchNo: number, entry: number, entryWallet: PublicKey, mint: PublicKey) {
    const market = marketPda(id, matchNo);
    const ix = await this.program.methods.claimTip(new BN(id), matchNo, entry)
      .accountsPartial({ market, vault: ataOf(market, mint), dest: ataOf(entryWallet, mint), mint, tokenProgram: TOKEN_PROGRAM, room: roomPda(id) })
      .instruction();
    return this.sendBase(wallet, [ix], "Tip Line: claim");
  }
  /** Permissionless fallback if the Magic Action didn't land: same payout, read from the committed Room. */
  async settle(wallet: InjectedWallet, id: number, nonce: bigint, mint: PublicKey) {
    const ix = await this.program.methods.settle(new BN(id), new BN(nonce.toString()))
      .accountsPartial({}).remainingAccounts(await this.potAccounts(id, nonce, mint)).instruction();
    return this.sendBase(wallet, [ix], "settle the Pot on Solana");
  }
  async refund(wallet: InjectedWallet, id: number, nonce: bigint, mint: PublicKey) {
    const ix = await this.program.methods.refund(new BN(id), new BN(nonce.toString()))
      .accountsPartial({}).remainingAccounts(await this.potAccounts(id, nonce, mint)).instruction();
    return this.sendBase(wallet, [ix], "refund the Pot");
  }

  async sendBase(wallet: InjectedWallet, ixs: TransactionInstruction[], label: string): Promise<string> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = wallet.publicKey!;
    tx.recentBlockhash = (await this.base.getLatestBlockhash()).blockhash;
    const signed = await wallet.signTransaction(tx);
    const sig = await this.base.sendRawTransaction(signed.serialize());
    const ev: TxEvent = { sig, label, at: Date.now(), base: true };
    this.emit(ev);
    const r = await this.base.confirmTransaction(sig, "confirmed");
    if (r.value.err) {
      const t = await this.base.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
      const m = (t?.meta?.logMessages ?? []).find((l) => l.includes("Error Message:"))?.replace(/^.*Error Message: /, "") ?? JSON.stringify(r.value.err);
      this.emit({ ...ev, ok: false, err: m });
      throw new Error(`${label} failed: ${m}`);
    }
    this.emit({ ...ev, ok: true });
    return sig;
  }
  async leave(id: number, seat: number) {
    const ix = await this.program.methods.leave(seat).accountsPartial(this.seatAccounts(id, seat)).instruction();
    return this.send([ix], `leave seat ${seat}`);
  }
  async setSalt(id: number) {
    const ix = await this.program.methods.setSalt(randomSalt()).accountsPartial(this.actAccounts(id)).instruction();
    return this.send([ix], "fresh sealed salt", { confirm: false });
  }
  async startMatch(id: number, fillTo: number) {
    const ix = await this.program.methods
      .startMatch(fillTo, Math.floor(Math.random() * 256))
      .accountsPartial({
        payer: this.pubkey, room: roomPda(id), world: worldPda(id), oracleQueue: VRF_EPHEMERAL_QUEUE, magicProgram: MAGIC_PROGRAM,
        programIdentity: vrfIdentity(), vrfProgram: VRF_PROGRAM, slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, systemProgram: SystemProgram.programId,
        log: logPda(id), logPermission: permPda(logPda(id)), permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT,
      })
      .remainingAccounts(Array.from({ length: MAXP }, (_, s) => ({ pubkey: viewPda(id, s), isSigner: false, isWritable: true })))
      .instruction();
    return this.send([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix], "start heist (VRF + crank)");
  }
  async fallbackDeal(id: number) {
    const ix = await this.program.methods.fallbackDeal().accountsPartial(this.actAccounts(id)).instruction();
    return this.send([ix], "fallback deal");
  }
  /** Fire-and-forget: one uniform instruction for every gameplay action. */
  async act(id: number, input: number) {
    // hand-encoded (discriminator + u8 input + u32 seq): this runs 10×/s, and the Anchor
    // builder plus two PDA searches per call were measurable on phones
    const data = Buffer.alloc(13);
    ACT_DISC.copy(data, 0);
    data.writeUInt8(input & 0xff, 8);
    data.writeUInt32LE(this.seq++ >>> 0, 9);
    const { room, world } = pdasOf(id);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID, data,
      keys: [
        { pubkey: this.pubkey, isSigner: true, isWritable: false },
        { pubkey: room, isSigner: false, isWritable: true },
        { pubkey: world, isSigner: false, isWritable: true },
      ],
    });
    const sig = await this.send([ix], "act", { confirm: false, fastHash: true });
    this.lastActSig = sig;
    return sig;
  }
  async vote(id: number, target: number) {
    const ix = await this.program.methods.vote(target).accountsPartial(this.actAccounts(id)).instruction();
    return this.send([ix], `sealed vote`);
  }
  async chat(id: number, text: string) {
    const bytes = new TextEncoder().encode(text).slice(0, 48);
    const arr = new Array(48).fill(0);
    bytes.forEach((b, i) => (arr[i] = b));
    const ix = await this.program.methods.chat(bytes.length, arr).accountsPartial(this.actAccounts(id)).instruction();
    return this.send([ix], "chat");
  }
  /** Push the Room (carrying the deal commitment) to Solana before play. Once per heist. */
  async commitDeal(id: number) {
    const ix = await this.program.methods.commitDeal()
      .accountsPartial({ payer: this.pubkey, room: roomPda(id), magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT }).instruction();
    return this.send([ix], "commit the deal to Solana");
  }
  async tick(id: number) {
    const accs: Record<string, PublicKey> = { room: roomPda(id), world: worldPda(id), log: logPda(id) };
    for (let s = 0; s < MAXP; s++) accs[`view${s}`] = viewPda(id, s);
    const ix = await this.program.methods.tick().accountsPartial(accs).instruction();
    return this.send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix], "tick (fallback)", { confirm: false });
  }
  private lightsAccounts(id: number) {
    const world = worldPda(id);
    return {
      payer: this.pubkey, room: roomPda(id), world, worldPermission: permPda(world),
      permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT, magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT,
      log: logPda(id), logPermission: permPda(logPda(id)),
    };
  }
  private viewPerms(id: number) {
    const out: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
    for (let s = 0; s < MAXP; s++) {
      const v = viewPda(id, s);
      out.push({ pubkey: v, isSigner: false, isWritable: true }, { pubkey: permPda(v), isSigner: false, isWritable: true });
    }
    return out;
  }
  /** Lights on: unseal the World, every View and the move log (all inside the rollup). */
  async finish(id: number) {
    const ix = await this.program.methods.finish().accountsPartial(this.lightsAccounts(id)).remainingAccounts(this.viewPerms(id)).instruction();
    return this.send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }), ix], "lights on");
  }
  /** After lights-on: commit the final Room to Solana (+ Magic Actions: settle the Pot, resolve the Tip Line). Once per heist. */
  async commitResult(id: number, nonce: bigint = 0n) {
    const rest = nonce !== 0n ? [{ pubkey: potPda(id, nonce), isSigner: false, isWritable: false }] : [];
    const ix = await this.program.methods.commitResult()
      .accountsPartial({ payer: this.pubkey, room: roomPda(id), magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT })
      .remainingAccounts(rest).instruction();
    return this.send([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix], nonce ? "commit result to Solana + settle Pot" : "commit result to Solana");
  }
  async reset(id: number) {
    const ix = await this.program.methods.reset().accountsPartial(this.lightsAccounts(id)).remainingAccounts(this.viewPerms(id)).instruction();
    return this.send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ix], "re-seal for next heist");
  }
}
