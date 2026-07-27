<div align="center">

<img src="TextGO.png" alt="logo" height="150">

<h1>TextGO</h1>

<p><strong>All-in-One Text Tool</strong></p>

[![GitHub Release](https://img.shields.io/github/v/release/C5H12O5/TextGO?label=Release&color=blue&style=flat)](https://github.com/C5H12O5/TextGO/releases)
[![GitHub Stars](https://img.shields.io/github/stars/C5H12O5/TextGO?logo=github&label=Stars&style=flat&color=yellow)](https://github.com/C5H12O5/TextGO/stargazers)
![GitHub Downloads](https://img.shields.io/github/downloads/C5H12O5/TextGO/total?logo=github&label=Downloads&style=flat&color=green)
[![GPLv3 License](https://img.shields.io/badge/License-GPLv3-BD0000.svg?style=flat)](LICENSE)
[![Tauri Version](https://img.shields.io/badge/Tauri-v2.11.5-24C8D8.svg?style=flat&logo=tauri)](https://tauri.app/)
[![Svelte Version](https://img.shields.io/badge/Svelte-v5.56.6-FF3E00.svg?style=flat&logo=svelte)](https://svelte.dev/)
![macOS](https://img.shields.io/badge/macOS-333333.svg?style=flat&logo=apple)
![Windows](https://img.shields.io/badge/Windows-0078D4.svg?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+Cgk8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTA0IDE0NHY1MS42NGE4IDggMCAwIDEtOCA4YTguNSA4LjUgMCAwIDEtMS40My0uMTNsLTY0LTExLjY0QTggOCAwIDAgMSAyNCAxODR2LTQwYTggOCAwIDAgMSA4LThoNjRhOCA4IDAgMCAxIDggOG0tMi44Ny04OS43OGE4IDggMCAwIDAtNi41Ni0xLjczbC02NCAxMS42NEE4IDggMCAwIDAgMjQgNzJ2NDBhOCA4IDAgMCAwIDggOGg2NGE4IDggMCAwIDAgOC04VjYwLjM2YTggOCAwIDAgMC0yLjg3LTYuMTRNMjA4IDEzNmgtODBhOCA4IDAgMCAwLTggOHY1Ny40NWE4IDggMCAwIDAgNi41NyA3Ljg4bDgwIDE0LjU0YTcuNiA3LjYgMCAwIDAgMS40My4xM2E4IDggMCAwIDAgOC04di03MmE4IDggMCAwIDAtOC04bTUuMTMtMTAyLjE0YTggOCAwIDAgMC02LjU2LTEuNzNsLTgwIDE0LjU1YTggOCAwIDAgMC02LjU3IDcuODdWMTEyYTggOCAwIDAgMCA4IDhoODBhOCA4IDAgMCAwIDgtOFY0MGE4IDggMCAwIDAtMi44Ny02LjE0IiBzdHJva2Utd2lkdGg9IjYuNSIgc3Ryb2tlPSIjZmZmIiAvPgo8L3N2Zz4=)

📖 English / [简体中文](README.zh-CN.md)

_TextGO is a cross-platform text processing tool that recognizes text types and runs custom actions._

</div>

| <img align="center" src="screenshots/toolbar_mode.gif" /> | <img align="center" src="screenshots/quiet_mode.gif" /> |
| --------------------------------------------------------- | ------------------------------------------------------- |

## ✨ Core Features

- **Multiple Triggers**: Configure independent rules for hotkeys, double-click, shift-click, and drag-select.
- **Flexible Modes**: Choose instant execution or interactive toolbar mode based on your workflow.
- **Customizable Icons**: Upload custom SVG icons to personalize the toolbar.
- **Ready to Use**: Start quickly with built-in text types and processing actions.
- **Highly Extensible**: Extend with regex, ML models, scripts, and local or cloud AI for recognition and processing.

| <img align="center" src="screenshots/new_rule.png" /> | <img align="center" src="screenshots/model_providers.png" /> | <img align="center" src="screenshots/update_script.png" /> |
| ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |

## ⬇️ Getting Started

### Installation

Download the installer for your platform from [**GitHub Releases**](https://github.com/C5H12O5/TextGO/releases) and follow the installation instructions.

### Permissions

TextGO requires the `Accessibility` permission on macOS to function properly.

**Setup steps:**

1. Open "System Settings" > "Privacy & Security" > "Accessibility"
2. Find TextGO and enable it
3. If TextGO is not listed, click the "+" button to add it manually

> [!TIP]
> The system prompts for authorization when the app is first used.

### Extensions

Browse and install extensions from the official [**Extensions**](https://textgo.xylitol.top/extensions) page:

| <img align="center" src="screenshots/scripts.png" /> | <img align="center" src="screenshots/websites.png" /> |
| ---------------------------------------------------- | ----------------------------------------------------- |

### FAQ

<details>
<summary>1. macOS says the app is damaged and cannot be opened.</summary>

<br>

_Run this command in Terminal:_

```bash
sudo xattr -r -d com.apple.quarantine /Applications/TextGO.app
```

</details>

<details>
<summary>2. macOS says Apple cannot check the app for malicious software.</summary>

<br>

_Follow these steps:_

1. Open "System Settings" > "Privacy & Security"
2. Find the blocked application in the "Security" section
3. Click the "Open Anyway" button
4. Enter your login password and confirm

</details>

<details>
<summary>3. Accessibility permission stops working after a TextGO update.</summary>

<br>

_TextGO is unsigned, so macOS binds Accessibility permission to its current binary. An update changes the binary identity and invalidates the permission, even if System Settings still shows it as enabled._

_To restore permission:_

1. Open "System Settings" > "Privacy & Security" > "Accessibility"
2. Select TextGO from the list and remove it with the "−" button
3. Click the "+" button to add TextGO back

</details>

> [!NOTE]
> For detailed usage instructions, please refer to the [User Guide](https://textgo.xylitol.top/guide/getting-started).

## 🛠️ Development

1. Follow the [official Tauri documentation](https://v2.tauri.app/start/prerequisites/) to install Rust and Node.js; use [pnpm](https://pnpm.io/) as the package manager
2. Clone and set up the project:
   ```bash
   git clone https://github.com/C5H12O5/TextGO.git
   cd TextGO
   pnpm install
   ```
3. Start development mode:

   ```bash
   pnpm tauri dev

   # enable debug logs on Unix-like systems
   RUST_LOG=debug pnpm tauri dev

   # enable debug logs on Windows PowerShell
   $env:RUST_LOG="debug"; pnpm tauri dev
   ```

4. Build installer:
   ```bash
   pnpm tauri build
   ```

## 🎉 Acknowledgments

This project builds on many excellent open-source projects. We thank their developers and contributors.

For a complete list of third-party dependencies and licenses, see [LICENSES.md](LICENSES.md).

## 📄 License

This project is licensed under the [GPLv3 License](LICENSE).
