# LCU 连接问题排查指南

## 问题描述
应用提示 "LCU 未激活，游戏客户端可能未运行"，但游戏已经打开。

## 快速诊断

### 步骤 1：运行诊断脚本

打开命令行，进入项目目录，运行：

```bash
node electron/lcu-debug.js "C:\Riot Games\League of Legends"
```

**注意：** 请将 `"C:\Riot Games\League of Legends"` 替换为你的实际游戏安装路径

### 步骤 2：检查诊断输出

诊断脚本会输出类似下面的信息：

```
========== LCU 诊断报告 ==========

📁 游戏目录: C:\Riot Games\League of Legends
✓ 目录存在: true

🔍 检查 LeagueClient 目录:
   路径: C:\Riot Games\League of Legends\LeagueClient
   存在: true

📄 目录中的文件数: 45
   前10个文件:
   - LeagueClientUx.log
   - ...

🔎 查找日志文件:
   找到 LeagueClientUx.log 文件: 1
   - LeagueClientUx.log

📖 读取最新日志文件:
   文件: LeagueClientUx.log
   文件大小: 524288 bytes

🔗 查找 LCU URL:
   ✅ 找到 LCU URL!
   Token: ab12cd34ef...56gh78ij
   Port: 2999
```

## 问题排查

### ❌ "LeagueClient 目录不存在"

**原因：** 游戏目录配置错误

**解决方案：**
1. 检查游戏的实际安装路径
2. 常见路径：
   - `C:\Riot Games\League of Legends`
   - `D:\Games\League of Legends`
   - 自定义安装目录

3. 在应用设置中重新配置游戏目录

### ❌ "未找到 LeagueClientUx.log 文件"

**原因：** 游戏客户端未完全启动，或未生成日志文件

**解决方案：**
1. 完全关闭 League of Legends 客户端
2. 等待 30 秒
3. 重新启动游戏客户端
4. 等待游戏客户端完全加载（看到主菜单）
5. 再运行诊断脚本

### ❌ "未找到 LCU URL"

**原因：** 日志文件格式不匹配（可能是游戏版本更新导致）

**解决方案：**

#### 方案 A：检查日志内容
```bash
# Windows PowerShell
$content = Get-Content "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Raw
$content -match "https://" | Select-Object -First 5
```

查看日志中关于 HTTPS URL 的行，格式应该类似：
```
https://riot:YOUR_TOKEN@127.0.0.1:PORT/
```

#### 方案 B：检查游戏版本
确保你运行的是最新版本的 League of Legends
- 检查客户端右下角的版本号
- 如果有新版本可用，请更新

#### 方案 C：重置日志
1. 关闭游戏客户端
2. 删除所有日志文件：
   ```bash
   Remove-Item "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Force
   ```
3. 重新启动游戏客户端
4. 再次运行诊断脚本

## 常见错误码

| 错误信息 | 原因 | 解决方案 |
|---------|------|--------|
| 目录不存在 | 游戏路径错误 | 检查并重新配置游戏目录 |
| LeagueClientUx.log 未找到 | 游戏未启动或未完全加载 | 重启游戏客户端，等待完全加载 |
| LCU URL 未找到 | 日志格式变更或游戏版本过旧 | 更新游戏版本，或检查日志内容 |

## 高级调试

### 查看完整日志
```bash
# Windows PowerShell
Get-Content "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Tail 100
```

### 查找所有包含 "https://" 的行
```bash
# Windows PowerShell
Select-String -Path "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log" -Pattern "https://"
```

### 查看最新的日志文件创建时间
```bash
# Windows PowerShell
(Get-Item "C:\Riot Games\League of Legends\LeagueClient\LeagueClientUx.log").LastWriteTime
```

## 需要帮助？

如果以上步骤都不能解决问题，请：

1. 运行诊断脚本，**完整复制输出结果**
2. 收集以下文件：
   - LeagueClientUx.log（最后 100 行）
   - 应用的崩溃日志（如果有）
3. 报告问题时附加这些信息

## 相关文件

- **诊断脚本：** `electron/lcu-debug.js`
- **LCU 工具：** `electron/lcu-utils.js`
- **主进程配置：** `electron/modules/app-config.js`
- **日志目录：** `C:\Riot Games\League of Legends\LeagueClient\`
