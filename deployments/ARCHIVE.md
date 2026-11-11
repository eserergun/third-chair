# Archived deployments

Every contract below is still on Stellar testnet. None of them is used by the site any more. The current contracts are in `deployments/testnet.json` (live) and `deployments/testnet-test.json` (test).

## v3, current (2026-11-09)

| | Live | Test |
|---|---|---|
| Contract | `CC3PPBRDTZ6LFAM3XNABLSNAWTHQOSMFFW66TGD6SMHG5PH37BBNOV2Y` | `CC2UPOKB4ACKNYUG7JUCR5HZ6HY6VGVCXHQNSCKHUOILHO4P2PHWFLUQ` |
| Minute / reveal | 60 s / 45 s | 20 s / 20 s |
| Wasm | `8f7c473c625ab8a0f9d4b69bc8e5ddb5effbef16be1f5d5f66a02cd0645aa440` after in-place upgrades (deployed as `2d57c6a4…`; `56dfc186…` before the slept-winner rule). rustc 1.95.0, Stellar CLI 30.0.1, `stellar contract build` | same |
| Admin | `GC2SWUC254XOXW6PG4A7ZBRIMSQAS2OS73BSN76HG5OWYP6TJAJG43C3` (local `stellar keys` alias `standoff-admin`; also the repo secret `STANDOFF_ADMIN_SECRET`) | same |
| Purse at deploy | 40,000 XLM | 20,000 XLM |

The purse came from the v1 contracts (admin `withdraw`), not from new Friendbot accounts.

## v2, retired (2026-11-08)

A cloud agent deployed these with its own admin key while it could not upgrade v1. Their admin secret never left that agent's machine, so they are abandoned.

| | Live | Test |
|---|---|---|
| Contract | `CAKFLIWLGHE2XKBSO4W6TMR2NX3SFR3K2TPIZ2NO5V5FEDVF75YWRJEA` | `CBF3HJCISL7DFOXLL2DPFTIR5SMBIGA7VZGZ7OU36RJVE2HLZTBO2YNJ` |
| Wasm | `b135f18ef6e9751cd44f24f7c5c3df5c54f7c99d7947cffadf998767a5bbf2ed` | same |
| Admin | `GA63WF6JKE3Z5LOLR23WJPB6DA5TYAQLDGIGPJ6XZHCCL3GBDXGWGRYX` (secret not available here) | same |

Verified on v2: a Varial (Chrome) link and a paid win on the test contract (settle `23111f592d70297247164550cfe393ccb55f55ccaae4c92309f1e18969bbf308`, `paid=10000000`).

## v1, retired (2026-11-07 to 2026-11-09)

| | Live | Test |
|---|---|---|
| Contract | `CD5PQMSHJ5PLB7QPPFMO2LOMGW7NV47L3SXMJMULYCVUAKCZ3N5QJHE2` | `CDUK4RWKP4ENVORVZQA5S6C2LOZY3KLHLRECEHSFAM43USRLL5R55R2I` |
| Wasm | `b075f1a10479f631b605c273619703111f5fb45bbedfe0fa5408fb7ecfe2c620` (after two in-place upgrades) | same |
| Admin | `GC2SWUC254XOXW6PG4A7ZBRIMSQAS2OS73BSN76HG5OWYP6TJAJG43C3` | same |

The 12-agent playtest ran on v1: 66 settled hands verified, payouts on hands 61 and 65. The treasuries (39,998 and 19,998 XLM) were withdrawn on 2026-11-09 to fund v3.
