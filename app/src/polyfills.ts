// Must be the first import: some Solana/MagicBlock modules touch Buffer at load time.
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;
(globalThis as any).process ??= { env: {} };
