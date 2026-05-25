# TypeScript 命令速查表

## 🎯 最常用的命令

### 类型检查（每次提交前必做！）
```bash
npm run type-check
```
✅ 无输出 = 成功
❌ 有错误信息 = 需要修复

---

## 📊 开发工作流

### 开发时（推荐）
```bash
# 在 terminal 中运行，实时监听文件变化
npm run type-check:watch
```
- 保存文件后自动检查
- 立即看到错误提示
- 不需要手动运行

### 提交前（必做）
```bash
# 运行一次完整检查
npm run type-check

# 通过后再提交
git add .
git commit -m "..."
```

### CI/CD 中
```bash
# 在 GitHub Actions 中添加
- run: npm run type-check
```

---

## 🔍 调试类型错误

### 查看所有错误
```bash
npm run type-check
# 输出所有类型错误，逐个修复
```

### 获取详细信息
```bash
npx tsc --noEmit --pretty false
# 可读性更强的错误格式
```

### 生成类型定义文件
```bash
npx tsc
# 生成 .d.ts 文件（用于库）
# 注意：需要在 tsconfig.json 中配置输出
```

---

## 📦 依赖管理

### 更新 TypeScript
```bash
npm update typescript
# 或
npm install typescript@latest
```

### 检查版本
```bash
npx tsc --version
# 输出当前 TypeScript 版本
```

---

## 🎓 快速学习

### 查看类型定义
```bash
# VS Code 中：
Ctrl+Click 点击任何类型名
# 或
Ctrl+Space 在类型定义处查看

# 或命令行：
npx tsc --listFiles | grep types
```

### 生成声明文件
```bash
npx tsc --declaration --emitDeclarationOnly
# 从 .ts 生成 .d.ts
```

---

## 🛠️ 高级用法

### 严格模式检查
```bash
npx tsc --strict --noEmit
# 启用所有严格检查选项
```

### 只检查特定文件
```bash
npx tsc --noEmit src/service/lcu.ts
# 只检查这个文件
```

### 跳过某些检查
```bash
npx tsc --noImplicitAny false --noEmit
# 临时禁用某些规则
```

---

## 📋 tsconfig.json 常见改动

### 启用装饰器
```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

### 显示详细信息
```json
{
  "compilerOptions": {
    "pretty": true,
    "diagnostics": true
  }
}
```

### 生成声明文件
```json
{
  "compilerOptions": {
    "declaration": true,
    "outDir": "./dist"
  }
}
```

---

## ✅ 检查清单

### 每天编码前
- [ ] `npm run type-check:watch` 后台运行

### 提交前
- [ ] `npm run type-check` 无错误
- [ ] IDE 中没有红色波浪线
- [ ] 所有导入路径正确

### Code Review 时
- [ ] 检查是否有 `any` 类型
- [ ] 确认接口定义清晰
- [ ] 验证泛型使用正确

---

## 🚨 常见错误快速修复

| 错误 | 原因 | 修复 |
|------|------|------|
| `TS7016` | 找不到模块 | 创建 `.d.ts` 或检查导入 |
| `TS2339` | 属性不存在 | 检查接口定义 |
| `TS2322` | 类型不匹配 | 使用正确的类型或转换 |
| `TS2707` | 缺少参数 | 添加所有必需参数 |
| `TS1005` | 语法错误 | 检查 TypeScript 语法 |

---

## 🎯 快速开始（2 分钟）

```bash
# 1. 验证安装
npm run type-check
# 预期：无输出（成功）

# 2. 启动监视模式
npm run type-check:watch
# 预期：显示 "Found 0 errors"

# 3. 修改一个文件
# 编辑 src/service/lcu.ts
# 改变某个参数的类型

# 4. 查看实时反馈
# terminal 中立即显示错误

# 5. 完成！
# 现在你已经可以使用 TypeScript 了！
```

---

## 📞 获取帮助

### 查看完整文档
```bash
# 打开完整指南
cat docs/TYPESCRIPT_INTEGRATION.md

# 打开快速参考
cat docs/TYPESCRIPT_QUICK_REFERENCE.md

# 打开设置说明
cat docs/TYPESCRIPT_SETUP_COMPLETE.md
```

### 官方资源
- TypeScript 官网：https://www.typescriptlang.org
- Playground：https://www.typescriptlang.org/play
- Handbook：https://www.typescriptlang.org/docs/handbook/

---

**记住：** 类型检查是你的好朋友，在开发时捕获 bug！ 🛡️
