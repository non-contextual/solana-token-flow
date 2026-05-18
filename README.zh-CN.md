# Solana Token Flow

> 其他语言：[English](./README.md) · 简体中文

抓取并可视化任意 Solana SPL 代币的转账流向。用 [Helius](https://helius.dev) Enhanced Transactions API 拉链上数据，然后渲染一张可交互的力图，展示代币在地址之间的流动。

![Sol Token Flow Dashboard](https://github.com/non-contextual/my-token-flow-panel/raw/main/docs/preview.png)

## 功能

- 地址间代币流动的力图（能处理 Sankey 处理不了的循环流）
- 节点按角色着色：类池子（indigo）、净接收（teal）、净发送（orange）
- 每小时转账量时间线
- Top 地址表格：按接收 / 发送 / 净流 / 交易数排序，一键复制地址
- 抓取历史存在 localStorage，不依赖后端运行也能跨刷新保留
- 实时抓取进度走 Server-Sent Events

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express + TypeScript (`tsx`) |
| 前端 | React 18 + Vite + Tailwind CSS |
| 图表 | ECharts (echarts-for-react) |
| 数据 | Helius Enhanced Transactions API + Solana RPC |

## 安装

```bash
# 1. Clone
git clone https://github.com/non-contextual/my-token-flow-panel
cd my-token-flow-panel

# 2. 安装所有 workspace
npm install

# 3. 配置
cp .env.example .env
# 编辑 .env 添加 Helius API key:
#   HELIUS_API_KEY=your_key_here
# 在 https://helius.dev 申请免费 key

# 4. 启动后端（端口 3001）
npm run serve

# 5. 启动前端（端口 5173），新开一个终端
npm run dev:frontend
```

然后打开 http://localhost:5173，粘贴任意 Solana 代币 mint 地址，点 **Fetch & Analyze**。

## 项目结构

```
sol-token-flow/
├── fetcher/               # Express SSE 后端
│   └── src/
│       ├── server.ts      # API 路由 + SSE 流
│       ├── pipeline.ts    # 抓取 → 解析 → 分析 → 推送
│       ├── analyzer.ts    # extractTokenFlows, buildEdges, buildTopAddresses
│       ├── helius.ts      # Helius RPC 辅助函数
│       └── types.ts       # 共享类型 (HeliusTx, FlowData 等)
├── frontend/              # React + Vite SPA
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── Dashboard.tsx
│       │   ├── FetchForm.tsx      # SSE 客户端 + 进度 UI
│       │   ├── FlowSankey.tsx     # 力图（ECharts Graph）
│       │   ├── HistoryPanel.tsx   # localStorage 历史
│       │   ├── StatsCards.tsx
│       │   ├── TopAddresses.tsx   # 可排序表格 + 复制
│       │   └── VolumeTimeline.tsx
│       └── utils/
│           └── localHistory.ts    # localStorage 读写
├── .env.example
└── package.json           # Workspace 根
```

## API

后端暴露以下端点（都通过 Vite 在 `/api/*` 转发）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/fetch?mint=&days=&limit=` | SSE 流，发出 `log`、`step`、`progress`、`done`、`error` |
| GET | `/api/data` | 最近一次抓取的 FlowData JSON |
| GET | `/api/history` | 已保存的归档文件列表 |
| GET | `/api/history/:id` | 加载指定归档 |
| DELETE | `/api/history/:id` | 删除指定归档 |
| GET | `/api/health` | 健康检查 |

## 注记

- Helius API 里的 `tokenTransfers[].tokenAmount` 已是 UI 格式（已按 decimals 除过）。`events.swap[].tokenAmount` 是原始整数。本项目只用 `tokenTransfers`。
- Sankey 图类型被换成 ECharts Graph 是因为真实代币流是循环图（池子同时发收），Sankey 遇到环就静默渲染空白。

## 许可

MIT
