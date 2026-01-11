<div align="center">

<img src="app-logo.svg" alt="logo" height="80">

[![GitHub Release](https://img.shields.io/github/v/release/C5H12O5/TextGO?label=Release&color=blue&style=flat)](https://github.com/C5H12O5/TextGO/releases)
[![GitHub Stars](https://img.shields.io/github/stars/C5H12O5/TextGO?logo=github&label=Stars&style=flat&color=yellow)](https://github.com/C5H12O5/TextGO/stargazers)
[![GPLv3 License](https://img.shields.io/badge/License-GPLv3-BD0000.svg?style=flat)](LICENSE)
[![Tauri Version](https://img.shields.io/badge/Tauri-v2.9.5-24C8D8.svg?style=flat&logo=tauri)](https://tauri.app/)
[![Svelte Version](https://img.shields.io/badge/Svelte-v5.46.1-FF3E00.svg?style=flat&logo=svelte)](https://svelte.dev/)
![macOS](https://img.shields.io/badge/macOS-333333.svg?style=flat&logo=apple)
![Windows](https://img.shields.io/badge/Windows-0078D4.svg?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+Cgk8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTA0IDE0NHY1MS42NGE4IDggMCAwIDEtOCA4YTguNSA4LjUgMCAwIDEtMS40My0uMTNsLTY0LTExLjY0QTggOCAwIDAgMSAyNCAxODR2LTQwYTggOCAwIDAgMSA4LThoNjRhOCA4IDAgMCAxIDggOG0tMi44Ny04OS43OGE4IDggMCAwIDAtNi41Ni0xLjczbC02NCAxMS42NEE4IDggMCAwIDAgMjQgNzJ2NDBhOCA4IDAgMCAwIDggOGg2NGE4IDggMCAwIDAgOC04VjYwLjM2YTggOCAwIDAgMC0yLjg3LTYuMTRNMjA4IDEzNmgtODBhOCA4IDAgMCAwLTggOHY1Ny40NWE4IDggMCAwIDAgNi41NyA3Ljg4bDgwIDE0LjU0YTcuNiA3LjYgMCAwIDAgMS40My4xM2E4IDggMCAwIDAgOC04di03MmE4IDggMCAwIDAtOC04bTUuMTMtMTAyLjE0YTggOCAwIDAgMC02LjU2LTEuNzNsLTgwIDE0LjU1YTggOCAwIDAgMC02LjU3IDcuODdWMTEyYTggOCAwIDAgMCA4IDhoODBhOCA4IDAgMCAwIDgtOFY0MGE4IDggMCAwIDAtMi44Ny02LjE0IiBzdHJva2Utd2lkdGg9IjYuNSIgc3Ryb2tlPSIjZmZmIiAvPgo8L3N2Zz4=)

📖 简体中文 / [English](README.md)

_TextGO 是一个跨平台的文本处理工具，能够识别文本类型并执行自定义动作_

</div>

| <img align="center" src="screenshots/01.zh-CN.gif" /> | <img align="center" src="screenshots/02.zh-CN.gif" /> |
| ----------------------------------------------------- | ----------------------------------------------------- |

## ✨ 核心特性

- **快捷触发**：可通过键盘快捷键、鼠标双击或拖拽选中触发，每种方式独立配置规则
- **灵活模式**：支持立即执行或工具栏交互两大模式，自由切换应对不同场景
- **个性图标**：工具栏图标支持上传自定义的 SVG 图片，打造专属风格
- **开箱即用**：内置丰富的文本类型和处理动作，简单配置即可使用
- **灵活扩展**：支持通过正则、机器学习模型、脚本或接入本地 AI 等方式扩展能力

| <img align="center" src="screenshots/03.zh-CN.png" /> | <img align="center" src="screenshots/04.zh-CN.png" /> |
| ----------------------------------------------------- | ----------------------------------------------------- |

## ⬇️ 使用说明

### 下载安装

从 [**GitHub Releases**](https://github.com/C5H12O5/TextGO/releases) 下载对应平台的安装包，按照安装说明进行安装后即可使用。

### 权限设置

在 macOS 平台，需要以下权限才能正常工作：

1. **辅助功能权限**：用于模拟键盘操作
2. **输入监控权限**：用于监听鼠标事件

应用使用期间，系统会自动提示授予这些权限。你也可以手动在"系统设置" > "隐私与安全性"中进行配置。

### 获取扩展

访问官方网站的[**扩展页面**](https://textgo.xylitol.top/zh-CN/extensions.html)，可浏览并安装各种扩展来增强应用功能：

| <img align="center" src="screenshots/05.zh-CN.png" /> | <img align="center" src="screenshots/06.zh-CN.png" /> |
| ----------------------------------------------------- | ----------------------------------------------------- |

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

> [!TIP]
> 更详细的使用说明，请参考[用户指南](https://textgo.xylitol.top/zh-CN/guide/getting-started.html)

## 🛠️ 开发指南

1. 参考 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/) 安装 Rust 和 Node.js（包管理器使用 [pnpm](https://pnpm.io/)）
2. 克隆项目并安装依赖：
   ```bash
   git clone https://github.com/C5H12O5/TextGO.git
   cd TextGO
   pnpm install
   ```
3. 运行开发环境：

   ```bash
   pnpm tauri dev

   # 类 Unix 系统下启用调试日志
   RUST_LOG=debug pnpm tauri dev

   # Windows PowerShell 下启用调试日志
   $env:RUST_LOG="debug"; pnpm tauri dev
   ```

4. 构建安装包：
   ```bash
   pnpm tauri build
   ```

## 🎉 特别鸣谢

本项目基于众多优秀的开源项目构建而成，在此向所有这些项目的开发者和贡献者表示衷心的感谢。

完整的第三方依赖列表及其开源协议请查看 [LICENSES.md](LICENSES.md) 文件。

## 📄 开源协议

本项目基于 [GPLv3](LICENSE) 开源协议发布。
