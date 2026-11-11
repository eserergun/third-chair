# Driving Rabet (Chrome extension) with Playwright

Wallet: Rabet 1.8.0. Chrome Web Store id `hgmoaheomcjnaheggkfafnjilfcefbmo`.
Unpacked extension id in this run: `jomffoooamjgfnopolhpfmpcboolobkk`.

## Install

1. Download the CRX:
   `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3Dhgmoaheomcjnaheggkfafnjilfcefbmo%26uc`
2. Strip the CRX3 header (12 bytes + header length at bytes 8..12, little endian). Unzip the rest into `ext/rabet/`.
3. Delete `ext/rabet/_metadata` (Chrome refuses names that start with `_` in an unpacked extension).
4. Launch a persistent headless Chromium context (`rlib.mjs` `launch()`):
   `--load-extension=<ext>`, `--disable-extensions-except=<ext>`, and **`--screen-info={0,0 1920x1080}`**.

The screen flag is required. Rabet opens its popup with `chrome.windows.create` at
`left = screenX + outerWidth - 380`. The default headless screen is too small, so Chrome
refuses the bounds ("Bounds must be at least 50% within visible screen space").
Rabet then answers `connect()` with `{error: "internal-error"}` and the site shows
"Unhandled error from the wallet". No popup opens.

## Onboard (`rlib.mjs` `onboard()`, about 6 s)

Page: `chrome-extension://<id>/dist/popup.html`.

1. Click "Get Started".
2. "Launch the App" sits in a carousel. Playwright does not see it as visible. Click it with `el.click()` in the page.
3. Fill `input[name=password]` and `input[name=confirm]`. Click "Continue".
4. Click "Import Wallet". Fill `input[name=key]` with the secret key. Click "Import".
5. Network: the header button shows "Main Network" (the default). Click it, then click "Test Network" (`setNetwork()`).

The password and key live in `keys/` (mode 600). Nothing prints them.

## Connect and sign (`run.mjs`)

- Kit modal: click the text "Rabet". The kit calls `window.rabet.connect()`.
- Rabet opens `dist/interaction.html` as a new popup window. Catch it with `ctx.on("page")`.
- Connect popup: an "Unlock" page first (fill the password, click "Unlock"), then `#/contact-request` "Connect Request". Click "Connect".
- Sign popup: `#/confirm` "Approve Transaction" with a "Test network" badge. Click "Confirm" (or "Reject").
- Rabet closes its popup window after 30 s (`WINDOW_TIMEOUT_SECONDS`). Approve quickly.

## Commands

From the repo root:

```
node scratch/final2/rabet/mkkey.mjs rabet                       # new Friendbot key, prints only the public key
NET=test node scratch/final2/rabet/run.mjs                      # onboard, link, paid win (starts helpers itself)
NET=main LABEL=run-main node scratch/final2/rabet/run.mjs       # wrong network probe: rejects the sign, switches back to Testnet
```

`run.mjs` starts `scripts/run-paid-win-helpers.sh` (DEP=deployments/testnet-test.json ROOM=billen HANDS=4)
in its own process group and kills the group at the end. It plays Air only after Tab1 and Tab2 are in the roster.

## Notes

- Rabet does not support `getNetwork`. The site cannot read the wallet network.
- The kit sends `rabet.sign(xdr, "testnet")`. Rabet signs for the network the dapp asks for, even when its own header says Main Network.
- A fresh browser profile is used on each run. The site storage is therefore empty on each run.
