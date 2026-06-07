你的任务是实现 v0.34 Hashline Anchored Edit 的第一步：安装依赖、解决 Bun 兼容问题、建立 Hashline 的文件系统适配层。

## 背景

@oh-my-pi/hashline 是 Bun-only 的包，它的 computeFileHash() 内部调用了 Bun.hash.xxHash32()，NodeFilesystem 用了 Bun.file() 和 Bun.write()。我们的项目跑在 Node.js 上，所以需要 polyfill。

关键：hashline 的 hash 只取 xxHash32 的低 16 位做 4 位 hex tag，不需要密码学安全，任何确定性 hash 都行。

## 步骤

### 1. 安装 @oh-my-pi/hashline

运行：

    npm install @oh-my-pi/hashline

确认 node_modules/@oh-my-pi/hashline/src/ 目录存在。

### 2. 读 hashline 源码确认 Bun 依赖范围

运行：

    grep -rn "Bun\." node_modules/@oh-my-pi/hashline/src/

你会看到只有两个文件用了 Bun API：

- format.ts 的 computeFileHash() 用了 Bun.hash.xxHash32()
- fs.ts 的 NodeFilesystem 用了 Bun.file() 和 Bun.write()

其他文件（patcher.ts, snapshots.ts, recovery.ts 等）全是纯 TS 逻辑，只是 import 了 computeFileHash。

### 3. 创建 src/core/hashline/bun-polyfill.ts

这个文件必须在任何 hashline 代码被 import 之前执行。

实现思路：

- 用 node:crypto 的 createHash 做一个和 xxHash32 签名兼容的替代
- 在 globalThis 上挂载 Bun.hash.xxHash32 和 Bun.hash（如果 globalThis.Bun 不存在）
- 不需要 polyfill Bun.file / Bun.write，因为我们不会用 NodeFilesystem（我们自己实现 Filesystem）

具体实现：globalThis.Bun 不存在时，设置 globalThis.Bun = { hash: { xxHash32: fn } }。fn 接收 (data: string, seed: number) 返回 number。用 crypto createHash('md5') 对 data 做 hash，取 readUInt32LE(0) 返回即可。

注意：不需要和真正的 xxHash32 产生相同的值，只要同一个 input 始终产生相同 output 就行。hashline 内部只做 hash === hash 的等值比较。

### 4. 读 hashline 的类型定义

运行：

    cat node_modules/@oh-my-pi/hashline/src/fs.ts
    cat node_modules/@oh-my-pi/hashline/src/snapshots.ts

找到 Filesystem 抽象类（readText, writeText, exists, canonicalPath）和 InMemorySnapshotStore 的构造参数。

### 5. 创建 src/core/hashline/filesystem-adapter.ts

实现 StudentAgentFilesystem extends Filesystem（从 hashline 的 fs 模块导入 Filesystem）：

- readText(path): 用 node:fs/promises 的 readFile，encoding utf-8，路径 resolve 到 cwd
- writeText(path, content): 用项目现有的 WriteQueue 写入，返回 { text: content }
- canonicalPath(path): 用 node:path 的 resolve(cwd, path)

先读 src/core/write-queue.ts 理解 WriteQueue 的接口，决定 writeText 怎么调用它。如果 WriteQueue 的接口不方便直接用，可以先用 node:fs/promises 的 writeFile 代替，后续再接入。

构造函数接收 cwd: string。

### 6. 创建 src/core/hashline/store.ts

导出工厂函数 createHashlineStore()。

重要：在这个文件顶部，在 import hashline 之前，先 import './bun-polyfill.js' 确保 polyfill 已执行。

然后 import { InMemorySnapshotStore } from '@oh-my-pi/hashline' 并创建实例。用你在第 4 步看到的构造参数，预期配置 maxPaths: 30, maxVersionsPerPath: 4（确认字段名和源码一致）。

### 7. 创建 src/core/hashline/index.ts

重新导出 filesystem-adapter 和 store 的公开接口。在文件最顶部 import './bun-polyfill.js' 确保任何使用方 import hashline 模块时 polyfill 已生效。

### 8. 验证

运行：

    npx tsc --noEmit

确认类型检查通过。

然后写一个快速验证脚本确认 polyfill 工作：

    node -e "require('./src/core/hashline/bun-polyfill.js'); const { computeFileHash } = require('@oh-my-pi/hashline'); console.log(computeFileHash('hello world'));"

如果项目是 ESM，改用对应的方式验证。关键是确认 computeFileHash 不再报 Bun is not defined。

## 约束

- 不要引入 oh-my-pi 的 agent runtime、TUI、provider routing，只用 hashline
- 不要修改 node_modules 里的任何文件
- 不要修改项目中的任何现有文件
- 所有新文件放在 src/core/hashline/ 目录
- polyfill 必须在 hashline 任何代码执行前加载
