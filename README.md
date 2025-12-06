![TextGO](https://socialify.git.ci/C5H12O5/TextGO/image?font=Raleway&forks=1&issues=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2FC5H12O5%2FTextGO%2Frefs%2Fheads%2Fmain%2Fapp-icon.png&name=1&owner=1&pattern=Plus&pulls=1&stargazers=1&theme=Auto)

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/C5H12O5/TextGO?label=Release&color=blue&style=flat-square)](https://github.com/C5H12O5/TextGO/releases)
[![GPLv3 License](https://img.shields.io/badge/License-GPLv3-BD0000.svg?style=flat-square)](LICENSE)
[![Tauri Version](https://img.shields.io/badge/Tauri-v2.9.4-24C8D8.svg?style=flat-square&logo=tauri)](https://tauri.app/)
[![Svelte Version](https://img.shields.io/badge/Svelte-v5.45.5-FF3E00.svg?style=flat-square&logo=svelte)](https://svelte.dev/)
![macOS](https://img.shields.io/badge/macOS-333333.svg?style=flat-square&logo=apple)
![Windows](https://img.shields.io/badge/Windows-0078D4.svg?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+Cgk8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTA0IDE0NHY1MS42NGE4IDggMCAwIDEtOCA4YTguNSA4LjUgMCAwIDEtMS40My0uMTNsLTY0LTExLjY0QTggOCAwIDAgMSAyNCAxODR2LTQwYTggOCAwIDAgMSA4LThoNjRhOCA4IDAgMCAxIDggOG0tMi44Ny04OS43OGE4IDggMCAwIDAtNi41Ni0xLjczbC02NCAxMS42NEE4IDggMCAwIDAgMjQgNzJ2NDBhOCA4IDAgMCAwIDggOGg2NGE4IDggMCAwIDAgOC04VjYwLjM2YTggOCAwIDAgMC0yLjg3LTYuMTRNMjA4IDEzNmgtODBhOCA4IDAgMCAwLTggOHY1Ny40NWE4IDggMCAwIDAgNi41NyA3Ljg4bDgwIDE0LjU0YTcuNiA3LjYgMCAwIDAgMS40My4xM2E4IDggMCAwIDAgOC04di03MmE4IDggMCAwIDAtOC04bTUuMTMtMTAyLjE0YTggOCAwIDAgMC02LjU2LTEuNzNsLTgwIDE0LjU1YTggOCAwIDAgMC02LjU3IDcuODdWMTEyYTggOCAwIDAgMCA4IDhoODBhOCA4IDAgMCAwIDgtOFY0MGE4IDggMCAwIDAtMi44Ny02LjE0IiBzdHJva2Utd2lkdGg9IjYuNSIgc3Ryb2tlPSIjZmZmIiAvPgo8L3N2Zz4=)

📖 English / [简体中文](README.zh-CN.md)

</div>

> TextGO is a cross-platform text processing tool that automatically recognizes text types and executes custom actions via a global hotkey.

## ✨ Core Features

1. **Effortless Operation**: Bind multiple rules to a single hotkey, eliminating the need to remember complex key combinations.
2. **Ready to Use**: Comes with a rich set of built-in text types and processing actions, allowing for quick setup with simple configuration.
3. **Highly Extensible**: Supports extending text recognition types via regular expressions or machine learning models, and allows for custom processing logic using scripts or local AI.
4. **Cross-Platform**: Built with Tauri for native support on macOS and Windows.

## 🚀 Use Cases

_With a single hotkey, you can perform all of the following actions:_

- **Format Conversion**: Automatically recognize variable naming formats and convert them to the target style

  ![Format Conversion](screenshots/01.gif)

- **Text Generation**: Automatically recognize business data formats and generate corresponding SQL statements

  ![Text Generation](screenshots/02.gif)

- **Quick Actions**: Automatically recognize URLs or file paths and open them with the default application

  ![Quick Actions](screenshots/03.gif)

- **Text Translation**: Automatically recognize natural language text and translate it using local LLM

  ![Text Translation](screenshots/04.gif)

- **...and More**

## ⬇️ Getting Started

### Installation

Download the installer for your platform from [**GitHub Releases**](https://github.com/C5H12O5/TextGO/releases) and follow the installation instructions.

### FAQ

<details>
<summary>1. macOS shows "App is damaged and can't be opened."</summary>

<br>

_Run the following command in the terminal to resolve:_

```bash
sudo xattr -r -d com.apple.quarantine /Applications/TextGO.app
```

</details>

<details>
<summary>2. macOS shows "Apple can't check app for malicious software."</summary>

<br>

_Follow these steps to resolve:_

1. Open "System Settings" > "Privacy & Security"
2. Find the blocked application in the "Security" section
3. Click the "Open Anyway" button
4. Enter your login password and confirm

</details>

## 🎉 Acknowledgments

This project is built upon many excellent open source projects. We would like to express our sincere gratitude to all the developers and contributors of these projects.

For a complete list of third-party dependencies and their licenses, please see [**LICENSES.md**](LICENSES.md).

## 📄 License

This project is released under the [**GPLv3**](LICENSE) open source license.
