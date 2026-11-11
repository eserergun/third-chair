# LOBSTR driver (room denvar, TEST site)

Result: BLOCKED. The LOBSTR extension holds no keys. It pairs with the LOBSTR mobile app by QR code. Every connection and every signature goes to the phone.

## What the automation did

1. Downloaded the CRX from the Chrome Web Store update URL:
   `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx2,crx3&x=id%3Dldiagbjmlmjiieclmdkagofdjcgodjle%26uc`
   Store id `ldiagbjmlmjiieclmdkagofdjcgodjle`, manifest version 2.1.0.
2. Unpacked it with `unzip` into `ext/` (ignore the "extra bytes" warning; that is the CRX header).
3. Ran `node scratch/final2/lobstr/probe.mjs` from the repo root. It loads `ext/` in a persistent headless Chromium context with `--load-extension`, the same way as `scratch/wallets/varial.mjs`.
4. Extension page `index.html`: "Welcome to LOBSTR extension", then "Get Started". The next page is "Connect your wallet" with a QR code. It has no input fields: no import of a secret key, no password, no seed phrase. Screenshots: `shots/01-ext-welcome.png`, `shots/02-ext-connect.png`.
5. Site: `https://eserergun.github.io/third-chair/test/#/room/denvar`, "Sit down", "Connect a Stellar wallet", "LOBSTR" in the kit modal. With no paired phone the site shows "Couldn't open access prompt" (an error string from the extension). Screenshot: `shots/12-site-after-pick.png`. Log: `probe.log`.

## Why it cannot run without a person

- Source evidence (`ext/background.min.js`, `ext/index.min.js`): pairing codes, a `LOGIN` poll against `https://lobstr.co/api/v1/lobstr-extension/connections/<key>/`, and UI text "Continue in LOBSTR app", "We've sent a signature request ... to the LOBSTR app on your phone".
- `@lobstrco/signer-extension-api` only posts messages to the extension (`REQUEST_ACCESS`, `SIGN`). It has no local signing.
- The kit module `lobstr.module.js` has no `getNetwork` (it rejects). The site then skips its network check at connect and relies on `verifySignedBy` after signing.

## What a person must do (repeat the pass by hand)

1. Install the LOBSTR mobile app (iOS or Android). Create or import a wallet on a new Friendbot key. LOBSTR needs a lobstr.co account (email, and 2FA if enabled). Turn on testnet in the app if the app version supports it.
2. In desktop Chrome, install the LOBSTR extension from the Chrome Web Store (id above). Open it, "Get Started", scan the QR code with the app (Scan button), and confirm in the app.
3. Link: open the TEST site room denvar, "Sit down", "Connect a Stellar wallet", "LOBSTR". Approve access in the extension popup. Click "Sign the link (one signature)". Approve the request on the phone. Expect the doors to close and the chair to show Linked with the wallet address.
4. Paid win: `DEP=deployments/testnet-test.json ROOM=denvar HANDS=4 ./scripts/run-paid-win-helpers.sh`. Play Air when the roster shows you and both helpers. Expect note 4 and 1 XLM to the wallet. Check the settle tx on Horizon.
5. Wrong network: stand up. Pair a mainnet wallet (or switch the app to mainnet). Clear site localStorage, reload, connect with LOBSTR. The site cannot ask LOBSTR for its network at connect. Expect the site to reach "Sign the link". If the phone shows a sign request, check the network shown, then reject it. If a signature does come back for mainnet, the site should show "Your wallet is not on testnet. Switch it to Testnet and try again." Approve nothing on Mainnet.
