# MetaMask driver (Stellar Wallets Kit, @metamask/connect-stellar 0.3.0)

Date: 2026-11-09. Room: amarilla (2). TEST site: https://eserergun.github.io/third-chair/test/

## What the connector uses

- `@metamask/connect-stellar` 0.3.0 does not call `wallet_requestSnaps`. It uses the MetaMask Multichain API (`@metamask/multichain-api-client` 0.12.0, `wallet_createSession` / `wallet_invokeMethod`) over the Chrome `externally_connectable` transport. It finds the extension id by a `metamask_getProviderState` post message, so an unpacked copy with a different id works.
- MetaMask 13.56.0 ships the Stellar support as a preinstalled snap, `npm:@metamask/stellar-wallet-snap`. No snap install prompt appears. The snap derives the Stellar account at onboarding.
- The connector supports only `stellar:pubnet` (`types.mjs`: `Scope = { PUBNET }`, `NETWORK_PASSPHRASE` has only the public passphrase). `requestAccess()` always creates a PUBNET session. `getNetwork()` always returns `Public Global Stellar Network ; September 2015`. `signTransaction(xdr, { networkPassphrase: TESTNET })` throws `Unknown network passphrase` before MetaMask sees it. There is no network switch.

## Install

1. Download the CRX: `curl -sL -o mm.crx "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=138.0.0.0&acceptformat=crx2,crx3&x=id%3Dnkbihfbeogaeaoehlefnkodbefgpgknn%26uc"`
2. `unzip mm.crx -d ext/mm` (ignore the "extra bytes" warning). Version 13.56.0, MV3.
3. Launch a persistent headless Chromium with `--disable-extensions-except=<ext/mm> --load-extension=<ext/mm>` (`mmlib.mjs`).

## Onboarding (`onboard.mjs`, about 20 s, no human step)

`#/onboarding/welcome` -> "Create a new wallet" -> "Use Secret Recovery Phrase" -> fill both password fields, tick the box -> "Create password" -> `setup-passkey`: "Maybe later" -> `review-recovery-phrase`: "Remind me later" (the seed is never revealed) -> metametrics: "Continue" -> "Open wallet". The password is in `secret-pass.txt` (mode 600). If the profile reopens on `#/onboarding/unlock`, fill the password and click "Unlock".

## Stellar address

Home -> "Receive" -> the Stellar row "Show QR code" button (`data-testid=multichain-address-row-qr-button`). The QR panel shows the full address. Address: `GCZPUQ6CJ7AGMDADJLAXHWRS7Z46XECKBCOI4PFS7GPHAC5EKFHX2TJQ`. Funded by Friendbot (`addr.mjs`).

## Connect (`connect.mjs`)

- Room page -> "Sit down" -> "Connect a Stellar wallet" -> click the "MetaMask" row in the kit modal.
- MetaMask did not open its own popup window in headless Chromium. Workaround: about 4 s after the pick, open `chrome-extension://<id>/notification.html` in a new tab. It shows the pending `#/connect/<id>` request.
- Playwright `evaluate` / `evaluateAll` fails on MetaMask pages (LavaMoat scuttling). Use locators, `innerText` and `getAttribute` only.
- Service worker console lines `RPC (<origin>): wallet_createSession -> success|error` show the request result.

## Results

- eserergun.github.io: MetaMask shows "Malicious—flagged as unsafe" and "This site shows signs of phishing or wallet-draining activity". Buttons: "Back to safety", "Connect anyway", "Cancel". The script never approves this. Cancel -> site says "User rejected the request."
- localhost (old local TEST build from `scratch/wallets/dist`, probe only): no warning. "Connect" -> `wallet_createSession -> success` -> site says "Your wallet is not on testnet. Switch it to Testnet and try again." No signature request.

## Run

```
node scratch/final2/metamask/onboard.mjs
node scratch/final2/metamask/addr.mjs
TAG=c node scratch/final2/metamask/connect.mjs                 # github.io, stops at the warning
CLEAR=1 REJECT=1 TAG=wn node scratch/final2/metamask/connect.mjs  # github.io, clears storage, clicks Cancel
APPURL=http://localhost:5288/third-chair/ TAG=lh APPROVE=1 node scratch/final2/metamask/connect.mjs  # needs a local preview
```
