<div align="center">

<img src="TextGO.png" alt="logo" height="150">

<h1>TextGO</h1>

<p><strong>全能文本处理工具</strong></p>

[![GitHub Release](https://img.shields.io/github/v/release/C5H12O5/TextGO?label=Release&color=blue&style=flat)](https://github.com/C5H12O5/TextGO/releases)
[![GitHub Stars](https://img.shields.io/github/stars/C5H12O5/TextGO?logo=github&label=Stars&style=flat&color=yellow)](https://github.com/C5H12O5/TextGO/stargazers)
![GitHub Downloads](https://img.shields.io/github/downloads/C5H12O5/TextGO/total?logo=github&label=Downloads&style=flat&color=green)
[![GPLv3 License](https://img.shields.io/badge/License-GPLv3-BD0000.svg?style=flat)](LICENSE)
[![Tauri Version](https://img.shields.io/badge/Tauri-v2.11.5-24C8D8.svg?style=flat&logo=tauri)](https://tauri.app/)
[![Svelte Version](https://img.shields.io/badge/Svelte-v5.56.8-FF3E00.svg?style=flat&logo=svelte)](https://svelte.dev/)
![macOS](https://img.shields.io/badge/macOS-333333.svg?style=flat&logo=apple)
![Windows](https://img.shields.io/badge/Windows-0078D4.svg?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiB2aWV3Qm94PSIwIDAgMjU2IDI1NiI+Cgk8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTA0IDE0NHY1MS42NGE4IDggMCAwIDEtOCA4YTguNSA4LjUgMCAwIDEtMS40My0uMTNsLTY0LTExLjY0QTggOCAwIDAgMSAyNCAxODR2LTQwYTggOCAwIDAgMSA4LThoNjRhOCA4IDAgMCAxIDggOG0tMi44Ny04OS43OGE4IDggMCAwIDAtNi41Ni0xLjczbC02NCAxMS42NEE4IDggMCAwIDAgMjQgNzJ2NDBhOCA4IDAgMCAwIDggOGg2NGE4IDggMCAwIDAgOC04VjYwLjM2YTggOCAwIDAgMC0yLjg3LTYuMTRNMjA4IDEzNmgtODBhOCA4IDAgMCAwLTggOHY1Ny40NWE4IDggMCAwIDAgNi41NyA3Ljg4bDgwIDE0LjU0YTcuNiA3LjYgMCAwIDAgMS40My4xM2E4IDggMCAwIDAgOC04di03MmE4IDggMCAwIDAtOC04bTUuMTMtMTAyLjE0YTggOCAwIDAgMC02LjU2LTEuNzNsLTgwIDE0LjU1YTggOCAwIDAgMC02LjU3IDcuODdWMTEyYTggOCAwIDAgMCA4IDhoODBhOCA4IDAgMCAwIDgtOFY0MGE4IDggMCAwIDAtMi44Ny02LjE0IiBzdHJva2Utd2lkdGg9IjYuNSIgc3Ryb2tlPSIjZmZmIiAvPgo8L3N2Zz4=)

📖 简体中文 / [English](README.md)

_TextGO 是一款跨平台文本处理工具，可识别文本类型并执行自定义动作。_

</div>

| <img align="center" src="screenshots/toolbar_mode.zh-CN.gif" /> | <img align="center" src="screenshots/quiet_mode.zh-CN.gif" /> |
| --------------------------------------------------------------- | ------------------------------------------------------------- |

## ✨ 核心特性

- **快捷触发**：为键盘快捷键、鼠标双击、Shift+点击和拖拽选中分别配置规则
- **灵活模式**：可在立即执行和工具栏交互两种模式间切换
- **个性图标**：上传自定义 SVG 图标，打造个性化工具栏
- **开箱即用**：内置丰富的文本类型和处理动作，简单配置即可使用
- **自由扩展**：通过正则表达式、机器学习模型、脚本或本地/在线 AI 扩展能力

| <img align="center" src="screenshots/new_rule.zh-CN.png" /> | <img align="center" src="screenshots/model_providers.zh-CN.png" /> | <img align="center" src="screenshots/update_script.zh-CN.png" /> |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |

## ⬇️ 使用说明

### 下载安装

从 [**GitHub Releases**](https://github.com/C5H12O5/TextGO/releases) 下载对应平台的安装包，并按照说明安装。

### 权限设置

TextGO 在 macOS 上需要开启“辅助功能”权限才能正常工作。

**设置步骤**：

1. 打开“系统设置”>“隐私与安全性”>“辅助功能”
2. 找到 TextGO 并勾选
3. 如未出现，点击“+”按钮手动添加 TextGO

> [!TIP]
> 应用首次使用时，系统会自动提示授权。

### 获取扩展

前往官方网站的[**扩展页面**](https://textgo.xylitol.top/zh-CN/extensions)，浏览并安装扩展：

| <img align="center" src="screenshots/scripts.zh-CN.png" /> | <img align="center" src="screenshots/websites.zh-CN.png" /> |
| ---------------------------------------------------------- | ----------------------------------------------------------- |

### 常见问题

<details>
<summary>1. macOS 提示“App 已损坏，无法打开”。</summary>

<br>

_在终端运行以下命令：_

```bash
sudo xattr -r -d com.apple.quarantine /Applications/TextGO.app
```

</details>

<details>
<summary>2. macOS 提示“Apple 无法检查 App 是否包含恶意软件”。</summary>

<br>

_按以下步骤操作：_

1. 打开“系统设置”>“隐私与安全性”
2. 在“安全性”部分找到被阻止的应用
3. 点击“仍要打开”
4. 输入登录密码并确认

</details>

<details>
<summary>3. TextGO 更新后，macOS 辅助功能权限失效。</summary>

<br>

_TextGO 是未签名应用，macOS 会将辅助功能权限与当前二进制文件绑定。应用更新后，二进制文件的身份发生变化，原有权限随之失效，即使系统设置中仍显示为已启用。_

_重新授权：_

1. 打开“系统设置”>“隐私与安全性”>“辅助功能”
2. 选中 TextGO，点击“−”按钮将其移除
3. 点击“+”按钮重新添加 TextGO

</details>

> [!NOTE]
> 详细用法请参阅[用户指南](https://textgo.xylitol.top/zh-CN/guide/getting-started)。

## 🛠️ 开发指南

1. 按照 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/) 安装 Rust 和 Node.js，并使用 [pnpm](https://pnpm.io/) 作为包管理器
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

本项目基于众多优秀的开源项目构建，感谢这些项目的开发者和贡献者。

第三方依赖及其开源协议详见 [LICENSES.md](LICENSES.md)。

## 📄 开源协议

本项目采用 [GPLv3](LICENSE) 开源协议。
