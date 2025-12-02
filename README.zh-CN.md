![TextGO](https://socialify.git.ci/C5H12O5/TextGO/image?font=Raleway&forks=1&issues=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2FC5H12O5%2FTextGO%2Frefs%2Fheads%2Fmain%2Fapp-icon.png&name=1&owner=1&pattern=Plus&pulls=1&stargazers=1&theme=Auto)

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/C5H12O5/TextGO?label=Release&color=blue&style=flat-square)](https://github.com/C5H12O5/TextGO/releases)
[![GPLv3 License](https://img.shields.io/badge/License-GPLv3-BD0000.svg?style=flat-square)](LICENSE)
[![Tauri Version](https://img.shields.io/badge/Tauri-v2.9.4-24C8D8.svg?style=flat-square&logo=tauri)](https://tauri.app/)
[![Svelte Version](https://img.shields.io/badge/Svelte-v5.45.4-FF3E00.svg?style=flat-square&logo=svelte)](https://svelte.dev/)
![macOS](https://img.shields.io/badge/macOS-333333.svg?style=flat-square&logo=apple)
![Windows](https://img.shields.io/badge/Windows-0078D4.svg?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+Cgk8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTA0IDE0NHY1MS42NGE4IDggMCAwIDEtOCA4YTguNSA4LjUgMCAwIDEtMS40My0uMTNsLTY0LTExLjY0QTggOCAwIDAgMSAyNCAxODR2LTQwYTggOCAwIDAgMSA4LThoNjRhOCA4IDAgMCAxIDggOG0tMi44Ny04OS43OGE4IDggMCAwIDAtNi41Ni0xLjczbC02NCAxMS42NEE4IDggMCAwIDAgMjQgNzJ2NDBhOCA4IDAgMCAwIDggOGg2NGE4IDggMCAwIDAgOC04VjYwLjM2YTggOCAwIDAgMC0yLjg3LTYuMTRNMjA4IDEzNmgtODBhOCA4IDAgMCAwLTggOHY1Ny40NWE4IDggMCAwIDAgNi41NyA3Ljg4bDgwIDE0LjU0YTcuNiA3LjYgMCAwIDAgMS40My4xM2E4IDggMCAwIDAgOC04di03MmE4IDggMCAwIDAtOC04bTUuMTMtMTAyLjE0YTggOCAwIDAgMC02LjU2LTEuNzNsLTgwIDE0LjU1YTggOCAwIDAgMC02LjU3IDcuODdWMTEyYTggOCAwIDAgMCA4IDhoODBhOCA4IDAgMCAwIDgtOFY0MGE4IDggMCAwIDAtMi44Ny02LjE0IiBzdHJva2Utd2lkdGg9IjYuNSIgc3Ryb2tlPSIjZmZmIiAvPgo8L3N2Zz4=)

📖 [English](README.md) / 简体中文

</div>

> TextGO 是一个跨平台的文本处理工具，通过全局快捷键选中文本后，自动识别文本类型并执行对应的自定义操作。

## ✨ 核心特性

1. **零记忆负担**：同一快捷键可以绑定多个规则，无需记忆复杂的按键组合
2. **开箱即用**：内置丰富的文本类型和处理动作，通过简单配置即可快速上手
3. **灵活扩展**：支持通过正则表达式或机器学习模型扩展文本识别类型，并可利用脚本或本地 AI 实现自定义处理逻辑
4. **跨平台支持**：基于 Tauri 构建，原生支持 macOS 和 Windows 平台

## 🚀 应用场景

_使用同一个快捷键，即可实现以下所有功能：_

- **格式转换**：自动识别变量名格式，一键转换为目标命名风格

  ![格式转换](screenshots/01.gif)

- **文本生成**：自动识别业务数据格式，一键生成对应的 SQL 语句

  ![文本生成](screenshots/02.gif)

- **快捷操作**：自动识别网址或文件路径，一键使用默认应用打开

  ![快捷操作](screenshots/03.gif)

- **划词翻译**：自动识别自然语言文本，一键调用本地 LLM 进行翻译

  ![划词翻译](screenshots/04.gif)

- **...以及更多**

## ⬇️ 使用说明

### 下载安装

从 [**GitHub Releases**](https://github.com/C5H12O5/TextGO/releases) 下载对应平台的安装包，按照安装说明进行安装后即可使用。

### 常见问题

<details>
<summary>1. macOS 安装后打开提示"App 已损坏，无法打开。"</summary>

<br>

_可以在终端运行以下命令解决：_

```bash
sudo xattr -r -d com.apple.quarantine /Applications/TextGO.app
```

</details>

<details>
<summary>2. macOS 安装后打开提示"Apple 无法检查 App 是否包含恶意软件。"</summary>

<br>

_可以按照以下步骤解决：_

1. 打开"系统设置" > "隐私与安全性"
2. 在"安全性"部分找到被阻止的应用
3. 点击"仍要打开"按钮
4. 输入你的登录密码后点击确认

</details>

## 🎉 特别鸣谢

本项目基于众多优秀的开源项目构建而成，在此向所有这些项目的开发者和贡献者表示衷心的感谢。

完整的第三方依赖列表及其开源协议请查看 [**LICENSES.md**](LICENSES.md) 文件。

## 📄 开源协议

本项目基于 [**GPLv3**](LICENSE) 开源协议发布。
