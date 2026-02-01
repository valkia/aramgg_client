# TypeScript 快速参考指南

## 🚀 快速开始

### 1. 运行类型检查
```bash
# 检查一次
npm run type-check

# 实时监视（开发时推荐）
npm run type-check:watch
```

### 2. 编辑文件时的工作流
```bash
# 编辑 src/service/lcu.ts 时
# 1. 在 VS Code 中编辑（会自动显示类型错误）
# 2. 保存文件
# 3. 查看问题面板（Ctrl+Shift+M）
# 4. 修复任何红色波浪线
# 5. 运行 npm run type-check 验证
```

### 3. 添加新 TypeScript 文件
```typescript
// 1. 创建 src/components/MyComponent.ts
import LCUService from './service/lcu.ts'

interface Props {
  lcu: LCUService;
  onPhaseChange: (phase: string) => void;
}

export class MyComponent {
  constructor(props: Props) {
    // 类型安全！
  }
}

// 2. 导入时 IDE 会给出完整的类型提示
```

---

## 📝 常见类型模式

### 模式 1：函数参数和返回值
```typescript
// ❌ 不好：使用 any
function doSomething(param: any): any {
  return param;
}

// ✅ 好：指定具体类型
function doSomething(param: string): number {
  return param.length;
}

// ✅ 很好：使用泛型
function identity<T>(param: T): T {
  return param;
}
```

### 模式 2：可选参数
```typescript
// ❌ 可能是 undefined
function greet(name: string) {
  console.log(`Hello, ${name}`);
}

// ✅ 明确表示可选
function greet(name?: string) {
  console.log(`Hello, ${name || 'Guest'}`);
}

// ✅ 或使用默认值
function greet(name: string = 'Guest') {
  console.log(`Hello, ${name}`);
}
```

### 模式 3：联合类型（多个可能）
```typescript
// 游戏阶段可以是这些值之一
type GamePhase = 'Lobby' | 'ChampSelect' | 'InProgress' | 'EndOfGame';

// IDE 会给出自动完成
const phase: GamePhase = 'Lobby'; // ✅
const invalid: GamePhase = 'Invalid'; // ❌ 类型错误
```

### 模式 4：接口定义数据结构
```typescript
// ❌ 不清晰
function getUserData(): any {
  return { id: 1, name: 'John', email: 'john@example.com' };
}

// ✅ 清晰明确
interface User {
  id: number;
  name: string;
  email: string;
}

function getUserData(): User {
  return { id: 1, name: 'John', email: 'john@example.com' };
}
```

### 模式 5：异步函数
```typescript
// ❌ 不清楚返回什么
async function fetchData() {
  const res = await fetch('/api/data');
  return res.json();
}

// ✅ ���确返回类型
interface ApiResponse {
  success: boolean;
  data: any[];
}

async function fetchData(): Promise<ApiResponse> {
  const res = await fetch('/api/data');
  return res.json() as ApiResponse;
}
```

---

## 🎯 项目中的关键类型

### LCU Service
```typescript
// 导入
import LCUService from './service/lcu.ts'

// 使用（类型完整）
const lcu = new LCUService('/path/to/lol')
await lcu.getAuthToken() // → { token, port, url } | null
const phase = await lcu.getGameflowPhase() // → string | null
```

### Game Flow Monitor
```typescript
// 导入
import GameFlowMonitor from './service/game-flow-monitor.ts'

// 使用（事件回调有类型提示）
const monitor = new GameFlowMonitor(lcu)
monitor.on('game-started', () => {
  // IDE 知道这是 game-started 事件
})
```

### Data Loader
```typescript
// 导入
import {
  getChampionAugmentStats,
  loadAugmentBase
} from '../electron/data-loader.ts'

// 使用（返回类型精确）
const stats = getChampionAugmentStats(1) // → AugmentStats[]
const augments = loadAugmentBase() // → AugmentBase[]
```

---

## ✅ 检查清单

### 编写 TypeScript 时
- [ ] 函数有返回类型注解
- [ ] 接口定义了所有参数
- [ ] 没有使用 `any`（除非必要）
- [ ] 错误处理中使用了正确的类型

### 提交前
- [ ] 运行 `npm run type-check` 无错误
- [ ] IDE 中没有红色波浪线
- [ ] 导入路径正确

### Code Review
- [ ] 类型注解清晰易懂
- [ ] 没有冗余的类型定义
- [ ] 复杂类型有注释说明

---

## 🔧 常见问题解决

### Q1: "Cannot find module 'xxx'"
```
✅ 解决方案：
1. 检查导入路径是否正确
2. 创建 .d.ts 声明文件（如果是 JS 模块）
3. 检查 tsconfig.json 的 paths 映射
```

### Q2: "Property 'xxx' does not exist"
```
✅ 解决方案：
1. 检查类型定义中是否包含该属性
2. 如果是动态添加，使用 Record<string, any>
3. 使用接口扩展（extends）
```

### Q3: "Type 'xxx' is not assignable to type 'yyy'"
```
✅ 解决方案：
1. 检查实际类型是否匹配
2. 使用类型转换（as TypeName）谨慎使用
3. 考虑使用类型守卫（type guards）
```

### Q4: "Generic type expects 2 type arguments"
```
✅ 解决方案：
1. 提供所有必要的泛型参数
2. 或使用类型推导让 TS 自动推断
```

---

## 💡 Pro Tips

### Tip 1: 使用类型推导
```typescript
// 不需要手动指定，TS 会推导
const name = 'John'; // TS 知道这是 string
const age = 25; // TS 知道这是 number
const active = true; // TS 知道这是 boolean
```

### Tip 2: 使用 `const` 断言
```typescript
// 将文字类型锁定为特定值
const phases = ['Lobby', 'ChampSelect', 'InProgress'] as const;
type Phase = typeof phases[number]; // 'Lobby' | 'ChampSelect' | 'InProgress'
```

### Tip 3: 使用类型守卫
```typescript
function processPhase(phase: string | null) {
  if (phase === null) {
    console.log('No phase');
    return;
  }

  // 在这里，TS 知道 phase 是 string
  console.log(phase.toUpperCase());
}
```

### Tip 4: 使用装饰器获取额外功能
```typescript
// 在 tsconfig.json 中启用：
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}

@deprecated
@readonly
class MyClass {
  // ...
}
```

---

## 📚 学习资源

### 官方文档
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [TypeScript 类型系统](https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html)

### 在线练习
- [TypeScript Playground](https://www.typescriptlang.org/play)
- [Type Challenges](https://github.com/type-challenges/type-challenges)

### IDE 支持
- VS Code: 内置完整支持
- WebStorm: 完整支持
- Vim/Neovim: 使用 coc.nvim 插件

---

## 🎯 下一步目标

### 短期（这周）
- [ ] 熟悉 npm run type-check 命令
- [ ] 学习基本的 TypeScript 语法
- [ ] 在新代码中使用类型注解

### 中期（这月）
- [ ] 转换更多 JS 文件为 TS
- [ ] 为 Vue 组件添加类型
- [ ] 参与 code review 时检查类型

### 长期（未来）
- [ ] 成为 TypeScript 专家
- [ ] 贡献 PR 时包含完整的类型定义
- [ ] 帮助团队提高代码质量

---

**记住：TypeScript 是为了让代码更安全、更可靠！** 🛡️

有问题随时查看 `TYPESCRIPT_INTEGRATION.md` 的完整指南。
