// Owner wallet: Stellar Wallets Kit 2.8.0 (v2 static API, loaded on first click) or a pasted secret.
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { ChainError } from "./errors";
import { keypairSigner, type Signer } from "./tx";

type Kit = typeof import("@creit.tech/stellar-wallets-kit").StellarWalletsKit;

let kitPromise: Promise<Kit> | null = null;

/** Kit wallets that cannot work on this testnet site (see loadKit). */
export const HIDDEN_WALLETS = new Set(["metamask"]);

export function loadKit(): Promise<Kit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      const [{ StellarWalletsKit }, { defaultModules }, { Networks: KitNetworks }] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit"),
        import("@creit.tech/stellar-wallets-kit/modules/utils"),
        import("@creit.tech/stellar-wallets-kit/types"),
      ]);
      // MetaMask's Stellar connector (@metamask/connect-stellar 0.3.0) opens pubnet sessions only,
      // so it can never link on testnet. Hide it until the connector supports testnet.
      const modules = defaultModules().filter((m) => !HIDDEN_WALLETS.has(m.productId));
      StellarWalletsKit.init({ modules, network: KitNetworks.TESTNET });
      return StellarWalletsKit;
    })();
    kitPromise.catch(() => (kitPromise = null));
  }
  return kitPromise;
}

const WRONG_NETWORK_MSG = "Your wallet is not on testnet. Switch it to Testnet and try again.";

/** Reject a wallet-reported passphrase that is not the deployment network (usually testnet). */
export function assertWalletPassphrase(reported: string, expected: string): void {
  if (reported === expected) return;
  throw new ChainError(WRONG_NETWORK_MSG, null, "WrongNetwork");
}

/**
 * Ask the connected kit module which network it is on. Throws WrongNetwork when the wallet
 * reports public/mainnet (or any other passphrase). Does not change wallet settings and does
 * not bypass extension phishing/malicious-site warnings — if the wallet refuses the site,
 * stop; do not approve the warning.
 */
export async function requireKitNetwork(kit: Kit, expectedPassphrase: string): Promise<void> {
  let reported: string | undefined;
  try {
    const net = await kit.getNetwork();
    reported = net?.networkPassphrase;
  } catch {
    // Some modules omit getNetwork; signature verification still enforces the network later.
    return;
  }
  if (typeof reported === "string" && reported.length > 0) assertWalletPassphrase(reported, expectedPassphrase);
}

/** Click 1: open the wallet picker. Call directly inside the click handler. */
export async function connectKit(expectedPassphrase: string = Networks.TESTNET, timeoutMs = 120_000): Promise<{ address: string; walletName: string }> {
  const kit = await loadKit();
  // A wallet popup that is closed without an answer can leave authModal pending forever.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new ChainError("The wallet did not answer. Open it and connect again.", null, "WalletTimeout")), timeoutMs);
  });
  let address: string;
  try {
    ({ address } = await Promise.race([kit.authModal(), timeout]));
  } finally {
    if (timer) clearTimeout(timer);
  }
  await requireKitNetwork(kit, expectedPassphrase);
  let walletName = "Wallet";
  try {
    walletName = kit.selectedModule?.productName ?? walletName;
  } catch {
    /* no module info */
  }
  return { address, walletName };
}

/** Parse with the expected passphrase and check one signature from `owner`. */
export function verifySignedBy(signedXdr: string, owner: string, networkPassphrase: string): void {
  const kp = Keypair.fromPublicKey(owner);
  const check = (pass: string): boolean => {
    try {
      const tx = TransactionBuilder.fromXDR(signedXdr, pass);
      const hash = tx.hash();
      return tx.signatures.some((s) => {
        try {
          return kp.verify(hash, s.signature);
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  };
  if (check(networkPassphrase)) return;
  const other = networkPassphrase === Networks.TESTNET ? Networks.PUBLIC : Networks.TESTNET;
  if (check(other)) throw new ChainError(WRONG_NETWORK_MSG, null, "WrongNetwork");
  throw new ChainError("Your wallet signed with a different account.", null, "WrongAccount");
}

/** Signer backed by the kit. The first await is signTransaction (SPEC 6.1 click 2). */
export function walletSigner(kit: Kit, owner: string, networkPassphrase: string, timeoutMs = 120_000): Signer {
  return {
    address: owner,
    async signTransaction(txXdr: string) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new ChainError("The wallet did not answer. Open the wallet again.", null, "WalletTimeout")), timeoutMs);
      });
      try {
        const { signedTxXdr } = await Promise.race([kit.signTransaction(txXdr, { networkPassphrase, address: owner }), timeout]);
        verifySignedBy(signedTxXdr, owner, networkPassphrase);
        return signedTxXdr;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

export function secretSigner(secret: string, networkPassphrase: string): Signer {
  let kp: Keypair;
  try {
    kp = Keypair.fromSecret(secret.trim());
  } catch {
    throw new ChainError("That is not a Stellar secret key.", null, "BadSecret");
  }
  return keypairSigner(kp, networkPassphrase);
}
