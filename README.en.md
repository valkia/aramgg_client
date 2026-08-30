<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="ARAMGG Assistant with read-only LCU guidance, local Augment OCR, and in-game recommendation overlays" />
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/valkia/aramgg_client/releases/latest"><img src="https://img.shields.io/github/v/release/valkia/aramgg_client?style=flat-square&color=c8a96a&label=release" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-111923?style=flat-square&logo=windows11&logoColor=f4ecdc" alt="Windows x64" />
  <img src="https://img.shields.io/badge/LCU-read--only-54d884?style=flat-square" alt="Read-only LCU integration" />
  <img src="https://img.shields.io/badge/UI-zh--CN%20%7C%20en--US%20%7C%20zh--TW-c29c6d?style=flat-square" alt="Simplified Chinese, English, and Traditional Chinese" />
</p>

<p align="center">
  A Windows desktop companion for League of Legends ARAM: get champion and bench guidance in champion select, recognize all three Augment cards in-game, and keep win-rate, build, and skill recommendations beside the match.
</p>

<p align="center">
  <a href="https://github.com/valkia/aramgg_client/releases/latest"><strong>Download for Windows</strong></a>
  ·
  <a href="./docs/USER_GUIDE_AUTO_AUGMENT.md">User guide</a>
  ·
  <a href="./docs/LCU_TROUBLESHOOTING.md">LCU troubleshooting</a>
</p>

## See it in a match

<p align="center">
  <img src="./docs/aramgg-in-game-preview.png" width="100%" alt="Three-card Augment overlay and right-side recommendation panel during an ARAM match" />
</p>

<p align="center">
  <sub>The top overlay preserves left, center, and right card order; the side panel extends the result with win rates, recommendation scores, and related builds.</sub>
</p>

<p align="center">
  <img src="./docs/image.png" alt="ARAMGG Assistant control panel" width="380" />
  <img src="./docs/image0.png" alt="Champion details and ARAM bench recommendations" width="360" />
</p>

## What it does in one match

| Stage | What ARAMGG reads | What you see |
| --- | --- | --- |
| `ChampSelect` | Read-only LCU champion-select, champion, and bench state | Current-champion data and guidance for every available bench candidate |
| `InProgress` | The left, center, and right Augment title regions on screen | A three-card top overlay and a right-side win-rate and recommendation list |
| Throughout | Complete bundled or cached data for the active locale | Champion, Augment, build, Summoner Spell, and skill-order guidance |

> [!IMPORTANT]
> Recommendation flows read state and statistics only. ARAMGG never picks a champion, swaps the bench, locks in, or accepts a trade; every game action stays with the player.

## More than a data overlay

- **Game-stage aware.** LCU gameflow decides when champion-select guidance is relevant and when in-game OCR may run. Stale results are cleared after the match stage ends.
- **Position-stable recognition.** PaddleOCR reads dedicated left, center, and right title regions. An unread slot stays empty instead of borrowing broad OCR text that could reorder the cards.
- **Local-first rendering.** Complete bundled or cached data renders first. Remote version checks run in the background, and a new dataset activates only after all required files are ready.
- **One locale for UI and data.** `zh-CN`, `en-US`, and `zh-TW` switch transactionally so the interface cannot move to a new language while its data remains on the old one.

## Install and use

1. Download the latest `aramgg_client Setup <version>.exe` from [Releases](https://github.com/valkia/aramgg_client/releases/latest).
2. Install and launch ARAMGG Assistant, then launch League Client. The app discovers LCU from the running client first.
3. Enter ARAM: use the champion detail window during champion select, then wait for an Augment selection screen in-game.
4. If automatic recognition misses, press `F1` to capture and analyze manually.

The game-directory setting is not required for normal use. It is an advanced fallback for reading the LCU lockfile and logs only when process-first discovery fails.

## How it works

```text
League Client ──read-only LCU──> stage router ──ChampSelect──> champion / bench guidance
                                      └────────InProgress──> screen capture
                                                               │
local-first locale data <──────── PaddleOCR title regions <────┘
          │
          └──────────────────────> three-card overlay / side panel
```

The renderer has no Node access and reaches the main process only through business APIs exposed by the sandboxed preload. Electron windows keep `contextIsolation`, `sandbox`, and `webSecurity` enabled.

## Develop locally

Use Node `22.18.0` and npm 10.

```bash
git clone https://github.com/valkia/aramgg_client.git
cd aramgg_client
npm install
npm run prepare:client-data
npm run dev
```

Run the main quality gates before submitting changes:

```bash
npm run test:unit
npm run test:augment-ocr
npm run lint
npm run type-check
npm run build
```

The app uses Electron, Vue 3, electron-vite, TypeScript, and PaddleOCR. Process-boundary code lives in `src/main/`, `src/preload/`, `src/renderer/`, and `src/shared/`; tests live in `tests/unit/` and `tests/electron/`.

## Documentation

- [Complete architecture](./COMPLETE_ARCHITECTURE.md)
- [Automatic Augment detection guide](./docs/USER_GUIDE_AUTO_AUGMENT.md)
- [LCU troubleshooting](./docs/LCU_TROUBLESHOOTING.md)
- [Performance and thermal diagnostics](./docs/PERFORMANCE_DIAGNOSTICS.md)
- [ARAM LCU read-only recommendation progress](./docs/ARAM_LCU_READONLY_RECOMMENDATION_PROGRESS.md)
- [Client data API distribution strategy](./docs/client-api-strategy.md)
- [Electron client update strategy](./docs/ELECTRON_APP_UPDATE_STRATEGY.md)
- [TypeScript development conventions](./docs/TYPESCRIPT_INTEGRATION.md)

Client data APIs, API key applications, and integration notes are available on the [ARAMGG Data API developer page](https://data.dtodo.cn/developer.html).

<details>
<summary><strong>Maintainers: release and quality checks</strong></summary>

GitHub Actions runs lint, type-check, unit tests, and packaging on a Windows runner. Official releases use `npm run release:patch|minor|major` to create the version commit and annotated tag, followed by `npm run release:push`.

Source builds and ordinary local packages do not upload match history to production. Only the official GitHub release workflow injects the official channel marker and production upload origin.

After dependency or lockfile changes, validate with npm 10 before publishing:

```bash
npx -p npm@10 npm ci --ignore-scripts
```

After publishing the installer, update `client.latestVersion`, `client.downloadUrl`, and the release notes in the remote `/api/client/v1/config` response. Keep `client.autoUpdateEnabled` off until the complete update path has been verified.

</details>

<details>
<summary><strong>Star history</strong></summary>

<p align="center">
  <a href="https://www.star-history.com/?repos=valkia%2Faramgg_client&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=valkia/aramgg_client&type=date&theme=dark&legend=top-left&sealed_token=4WUaLyfHuhwVpa6CaVWxo9JwrU2ORlLI9dAYuWiPKDmieAkfPBMEhZVkaRE_Uh1S09rcn68ut9p3OTdv9g44qUeyk6rhtzkLF2KZ2_fbpLsIYVIxlwgpXj4aGR84y6dlAebI8UBtjKZlyxHepOvNbgHdzcQZqUinKSJCfAOSVoRjwL1xngr9YyeBPBBN" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=valkia/aramgg_client&type=date&legend=top-left&sealed_token=4WUaLyfHuhwVpa6CaVWxo9JwrU2ORlLI9dAYuWiPKDmieAkfPBMEhZVkaRE_Uh1S09rcn68ut9p3OTdv9g44qUeyk6rhtzkLF2KZ2_fbpLsIYVIxlwgpXj4aGR84y6dlAebI8UBtjKZlyxHepOvNbgHdzcQZqUinKSJCfAOSVoRjwL1xngr9YyeBPBBN" />
      <img src="https://api.star-history.com/chart?repos=valkia/aramgg_client&type=date&legend=top-left&sealed_token=4WUaLyfHuhwVpa6CaVWxo9JwrU2ORlLI9dAYuWiPKDmieAkfPBMEhZVkaRE_Uh1S09rcn68ut9p3OTdv9g44qUeyk6rhtzkLF2KZ2_fbpLsIYVIxlwgpXj4aGR84y6dlAebI8UBtjKZlyxHepOvNbgHdzcQZqUinKSJCfAOSVoRjwL1xngr9YyeBPBBN" alt="aramgg_client star history chart" width="900" />
    </picture>
  </a>
</p>

</details>

<details>
<summary><strong>Support the project</strong></summary>

If ARAMGG helps you, you can support its continued development and maintenance.

<p align="center">
  <img src="./docs/assets/support/wechat.jpg" alt="WeChat support QR code" width="220" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./docs/assets/support/alipay.jpg" alt="Alipay support QR code" width="220" />
</p>

</details>
