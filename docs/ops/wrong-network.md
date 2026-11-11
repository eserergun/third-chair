# Wrong network

## What the app does

1. Stellar Wallets Kit is initialized on TESTNET only.
2. After the wallet picker returns an address, the client asks the wallet for its network (`getNetwork()`, where the wallet module supports it) and stops with "Your wallet is not on testnet. Switch it to Testnet and try again." before building the link transaction.
3. The link signature is parsed with the testnet passphrase. A signature for the public network throws the same message, so wallets without `getNetwork()` are covered too.
4. Unit tests cover both checks.

These checks run on a new wallet link. A chair that is already linked does not ask the wallet again.

## Mainnet "malicious site" warning

Varial set to Mainnet shows "This site was flagged as malicious" when connecting to `eserergun.github.io` (seen 2026-11-08 and again 2026-11-09), before the app can show its own message. MetaMask 13.56 shows "Malicious—flagged as unsafe" for the same domain. These warnings come from the wallets' site scanning, not from the app. Do not approve them. On Testnet, Varial shows no warning and the flow links and pays normally. The wallet step of the doors says: "If your wallet warns that this site is malicious, it is set to Mainnet. Cancel, switch it to Testnet, and connect again."

To remove the warnings: ask each wallet's scanning provider to review the domain (Varial: its scam-site report; MetaMask: the `eth-phishing-detect` repo or support), or move to a custom domain. The "Use a testnet secret key" door asks for an `S...` key, which scanners may read as phishing; hiding it behind a URL flag before a review would help.

Wallets that sign for the passphrase the kit sends (Albedo, xBull, Rabet) cannot sign for Mainnet here at all. Wallets without `getNetwork()` (Rabet, Hana, LOBSTR) rely on the signature check in step 3.

Results per wallet: [wallet-pass.md](wallet-pass.md).
