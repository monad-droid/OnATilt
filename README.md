# OnATilt

A crypto trading dashboard built with Next.js and the [Hyperliquid](https://hyperliquid.xyz) API. Features market-structure analysis (swing points, BOS/CHoCH), order blocks, fair value gaps, SFP detection, and rule-based trade gating.

## Prerequisites

- [Node.js](https://nodejs.org) v18 or higher

Verify with:

```bash
node -v
```

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/monad-droid/OnATilt.git
cd OnATilt

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

No API keys or environment variables are required — the app connects to Hyperliquid's public API.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Create production build |
| `npm start` | Run production server |
| `npm run lint` | Run ESLint |

## Deploy on Vercel

The easiest way to deploy is with the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

See the [Next.js deployment docs](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
