# Wallet pass (P0.2)

Date: 2026-11-09. Every run is automated in headless Chromium with the real wallet (web wallet or unpacked Chrome extension), a new Friendbot key, and no mocks. A paid win means: link the wallet, sit, play Air while two Table helper bots play Table (`scripts/run-paid-win-helpers.sh`), and see exactly 1.0000000 XLM arrive on Horizon from the contract.

## Results

| Wallet | Link (one signature) | Paid win | Wrong network | Where |
|---|---|---|---|---|
| Albedo (web, albedo.link) | PASS. Live: accept `8a87142e…`, 4 paid wins. Re-link from a new browser passed twice. | PASS. Live amarilla hand 20, settle [`654792bd…`](https://stellar.expert/explorer/testnet/tx/654792bdca5c93b7672f699e0c0f041dfd4691e738afaeeb7e0fe0754bea132a) | Cannot happen: Albedo signs for the network the site asks for. | Live site |
| xBull (web, wallet.xbull.app) | PASS. Accept [`698f05e0…`](https://stellar.expert/explorer/testnet/tx/698f05e01129686bc853d007495385681b9db3f9480873d461e662ab052f71ed) | PASS. Test cheyen, settle [`278fe54d…`](https://stellar.expert/explorer/testnet/tx/278fe54d1cba43ac3a17d03017ebc8eb894e7be3ead3bda91bb8fc80a3b53827) | Cannot happen: with Main Network set, the sign request still says TESTNET. | Test site |
| Varial 5.52.0 (extension, formerly Freighter) | PASS. Live accept [`4a99d3de…`](https://stellar.expert/explorer/testnet/tx/4a99d3de3d45bc51805cfb8ad01f1608ecf9af86c0c7c674badcfc15d83f698d). No warning on github.io in Test Net mode. | PASS. Live abelen hand 21, settle [`ae813e24…`](https://stellar.expert/explorer/testnet/tx/ae813e2491ec5c580892de062580fe7e14402d0e4d1a8859aa6e8c157ce9b389) | On Main Net, Varial flags `eserergun.github.io` as malicious before the site can check the network. On localhost the site shows "Your wallet is not on testnet." | Live site |
| Rabet 1.8.0 (extension) | PASS. Accept [`cedc97c0…`](https://stellar.expert/explorer/testnet/tx/cedc97c08ff9159e3e4f8f8a3c44f5e34070d9913b0fdf506b5383e21010e4db) | PASS. Test billen hand 86, settle [`46711783…`](https://stellar.expert/explorer/testnet/tx/467117837bfbf3bc587d11d34390f631c9bf50a27e5f72bc419cfee26b61dc7c). Receipt tx link 0.06 s after the receipt. | Cannot happen: the kit calls `rabet.sign(xdr, "testnet")`, so the sign request says "Test network" even on Main Network. | Test site |
| Hana 5.14 (extension) | PASS. Accept [`335477ac…`](https://stellar.expert/explorer/testnet/tx/335477accebd06b9f276ad28ecf45322d4334239567a70ede84a1e2803e4500a) | PASS. Test cheyen hand 95, settle [`b355ca88…`](https://stellar.expert/explorer/testnet/tx/b355ca889389621f0f4b3a2993d9bb05aafa50d616c3bacdfb21135ac15fcea0) | Not run (time box). Hana has no `getNetwork`; the signature check stays the last guard. | Test site |
| LOBSTR (extension) | Manual | Manual | Manual | The extension holds no keys. It pairs with the LOBSTR phone app by QR code, and every signature happens on the phone. |
| MetaMask 13.56 | Not possible | Not possible | Always Mainnet | `@metamask/connect-stellar` 0.3.0 opens `stellar:pubnet` sessions only, and MetaMask flags `eserergun.github.io` as malicious. The site hides MetaMask until the connector supports testnet. |
| Phones (iOS Safari, Android Chrome) | Manual | Manual | Manual | Emulation passes; a real device was not available. |

Link time on the live site (round 1, before the speed fixes): from the wallet pick to "Sign the link" 47 to 94 s (Friendbot for the session key, then `offer`), and from the sign click to seated 28 to 49 s. Round 2 numbers are in `docs/p0-acceptance.md`.

Each link is one `accept` call with the wallet as the source. After it, `chair --player <session>` returns `claimed: true` with the wallet as owner.

## How each wallet was driven

- **Albedo:** open `albedo.link/import`, paste the secret, set a password. The kit opens popups at `albedo.link/confirm`; click "Confirm using MyAccount" and enter the password.
- **xBull:** open `wallet.xbull.app`, "Import Secret Key", set a password. The kit opens `wallet.xbull.app/connect`; click "Connect", then "Continue" on the sign request.
- **Varial:** CRX from the Chrome Web Store update URL (id `bcacfldlkkdogcmkkibnjlakofdplcbk`). Persistent headless Chromium with `--load-extension`. Onboarding: "Create new wallet", password, "Do this later", `#/account/import`, then Settings > Network > Test Net. Connect opens `#/grant-access`, sign opens `#/sign-transaction`.
- **Rabet, Hana, MetaMask, LOBSTR:** step by step in [`wallet-drivers/`](wallet-drivers/). Rabet needs `--screen-info={0,0 1920x1080}` in headless Chromium. Hana cannot use an imported `S...` key for Stellar, so the driver funds its seed account; in headless Chromium it opens no window, so the driver opens `popup.html`.
- **Helpers:** `scripts/run-paid-win-helpers.sh` makes new keyfiles for every run. The bots stop taking cards after their last hand and stay until they stand.

The scripts live in `scratch/` on the machine that ran them (not in git, with keys in mode 600 files).

## Findings and fixes

1. **OwnerBusy blocked a re-link.** A wallet whose chair belonged to an old browser could not link a new one. **Fixed (wasm `56dfc186` and later):** `accept` stands up the owner's other chair. Verified twice on the live site.
2. **A player who linked during an open minute missed it.** **Fixed:** the wallet and secret doors link first, then sit.
3. **The receipt had no tx link when another client settled.** **Fixed:** the receipt takes the settle hash from the next room read.
4. **The Friendbot line kept counting under a wallet error.** **Fixed:** the progress lines hide while the doors show an error, and a failed connect offers "Connect again".
5. **Rabet's rejection showed "[object Object]".** **Fixed:** wallet rejection objects become words ("You turned the request down in the wallet.").
6. **A wallet popup closed without an answer left the doors waiting.** **Fixed:** connect times out after 120 s.
7. **Main Net warnings:** Varial and MetaMask flag `eserergun.github.io` as malicious. This is outside the site; see `docs/ops/wrong-network.md`. The wallet step tells the player what the warning means.

## Still manual

- LOBSTR with the phone app.
- Hana wrong-network probe: `NET=main node scratch/final2/hana/run.mjs` (it rejects the sign request).
- Real phones and real Safari.
