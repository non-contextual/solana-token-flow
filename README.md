# Sol Token Flow

> Read this in: English · [简体中文](./README.zh-CN.md)

Crawl and visualize token transfer flows for any Solana SPL token. Uses the [Helius](https://helius.dev) Enhanced Transactions API to fetch on-chain data, then renders an interactive force-directed graph showing how tokens move between addresses.

![Sol Token Flow Dashboard](https://github.com/non-contextual/my-token-flow-panel/raw/main/docs/preview.png)

## Features

- Force-directed graph of token flows between addresses (handles cyclic flows that Sankey can't)
- Node coloring by role: pool-like (indigo), net receiver (teal), net sender (orange)
- Hourly transfer volume timeline
- Top addresses table, sortable by Received / Sent / Net / TXs, with one-click address copy
- Fetch history stored in localStorage, persists across page reloads without a running server
- Real-time fetch progress via Server-Sent Events

## Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js + Express + TypeScript (`tsx`) |
| Frontend | React 18 + Vite + Tailwind CSS |
| Charts | ECharts (echarts-for-react) |
| Data | Helius Enhanced Transactions API + Solana RPC |

## Setup

```bash
# 1. Clone
git clone https://github.com/non-contextual/my-token-flow-panel
cd my-token-flow-panel

# 2. Install all workspaces
npm install

# 3. Configure
cp .env.example .env
# Edit .env and add your Helius API key:
#   HELIUS_API_KEY=your_key_here
# Get a free key at https://helius.dev

# 4. Start backend (port 3001)
npm run serve

# 5. Start frontend (port 5173) in a second terminal
npm run dev:frontend
```

Then open http://localhost:5173, paste any Solana token mint address, and click **Fetch & Analyze**.

## Project Structure

```
sol-token-flow/
├── fetcher/               # Express SSE backend
│   └── src/
│       ├── server.ts      # API routes + SSE stream
│       ├── pipeline.ts    # Fetch → parse → analyze → emit
│       ├── analyzer.ts    # extractTokenFlows, buildEdges, buildTopAddresses
│       ├── helius.ts      # Helius RPC helpers
│       └── types.ts       # Shared types (HeliusTx, FlowData, etc.)
├── frontend/              # React + Vite SPA
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── Dashboard.tsx
│       │   ├── FetchForm.tsx      # SSE client + progress UI
│       │   ├── FlowSankey.tsx     # Force-directed graph (ECharts Graph)
│       │   ├── HistoryPanel.tsx   # localStorage history
│       │   ├── StatsCards.tsx
│       │   ├── TopAddresses.tsx   # Sortable table + copy
│       │   └── VolumeTimeline.tsx
│       └── utils/
│           └── localHistory.ts    # localStorage read/write
├── .env.example
└── package.json           # Workspace root
```

## API

The backend exposes these endpoints (all proxied through Vite at `/api/*`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fetch?mint=&days=&limit=` | SSE stream, emits `log`, `step`, `progress`, `done`, `error` |
| GET | `/api/data` | Latest fetched FlowData JSON |
| GET | `/api/history` | List of saved archive files |
| GET | `/api/history/:id` | Load a specific archive |
| DELETE | `/api/history/:id` | Delete a specific archive |
| GET | `/api/health` | Health check |

## Notes

- `tokenTransfers[].tokenAmount` in the Helius API is already in UI format (pre-divided by decimals). `events.swap[].tokenAmount` is raw integer. This project uses `tokenTransfers` only.
- The Sankey chart type was replaced with ECharts Graph because real token flows form cyclic graphs (pools both send and receive) and Sankey silently renders blank when cycles exist.

## License

MIT
