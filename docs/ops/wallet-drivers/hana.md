# Hana Wallet driver (TEST site, room cheyen)

Wallet: Hana Wallet 5.14.0.0, Chrome Web Store id `jfdlamikmbghhapbgfoogdffldioobgl`.
All scripts are in this folder. Run them with node from the repo root.

## Install

1. Download the CRX from the Web Store update URL:
   `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0&acceptformat=crx2,crx3&x=id%3Djfdlamikmbghhapbgfoogdffldioobgl%26uc`
   It is saved to `dl/hana.crx` (about 25 MB).
2. Unpack it with `unzip` into `ext/hana` (ignore the "extra bytes" warning).
3. `hlib.mjs` launches a persistent headless Chromium (`channel: "chromium"`) with
   `--disable-extensions-except` and `--load-extension` set to `ext/hana`.
   The profile is in the scratchpad (`hana-ud`). Keep it between runs.

## Onboard (`onboard.mjs`, then `setup.mjs`, `derive.mjs`)

1. Hana opens `main.html` with an email login. Click "MORE OPTIONS", then the third icon (sprout).
   The icon has no label. The script clicks at (708, 606) in a 1280x860 viewport.
2. Pick "New seed phrase account". Fill `password` and `confirmPassword` (`keys/pass.txt`, mode 600).
3. The seed shows in 12 read-only inputs. The script saves it to `keys/seed.txt` (mode 600).
   Click the "Continue" link.
4. The quiz asks for 3 words ("Tap your fourth word"). The script clicks the input with that word.
5. Wait for "Accept & Continue" (it loads for some seconds), click it.
6. In `popup.html`: Addresses tab, turn on the Stellar switch (`.react-switch-handle` index 12).
7. Network: wallets menu (button "Open wallets menu") > "Mainnet / Change network" >
   "Stellar Expand" > "Stellar testnet". `net.mjs test|main` does this.
8. Key: "Add wallet" > "Restore a private key" > "Private key" accepts a Stellar `S...` secret,
   but the imported wallet shows Stellar as INELIGIBLE. So the run uses the seed account instead.
   `derive.mjs` derives its Stellar address with SEP-5 (m/44'/148'/0'):
   `GA4PXIPN2ZR3ZYP2DHL2EQJ6KRIX2DIVNAORSQOLMRAMB63OXRVBYHZ2`. Then fund it with Friendbot.

## Connect and sign (`run.mjs`)

- Unlock first: open `main.html`, fill the password, click "Unlock". Then close every other tab.
- In headless Chromium, Hana opens no approval window. The background adds a pending request,
  and nothing shows. The script opens `chrome-extension://<id>/popup.html` in a new tab.
  The popup shows the pending request (this is what the toolbar icon shows to a person).
- Connect (first time per site): "CONNECTION REQUEST FOR ACCOUNT 1". The "Authorize" button
  stays disabled until you turn on the Account 1 switch (click at (316, 418) in a 400x640 popup).
  Click "Authorize". The popup then shows "Something went wrong", but the address reaches the site.
  Later connects for the same site return the address at once, with no popup.
- Sign: "Signing Request at eserergun.github.io with Account 1 on Stellar". It shows the
  `accept` call on the TEST contract. Click "Sign".

## Paid win

`run.mjs` starts `DEP=deployments/testnet-test.json ROOM=cheyen HANDS=4 ./scripts/run-paid-win-helpers.sh`
in its own process group, waits for Tab1 and Tab2 in the roster, then presses key 1 (Air).
Do not click "Sit down" again while a card is sending (see the report).

## Stand up

`standup.mjs` opens the room with the same profile and clicks "Stand up".
