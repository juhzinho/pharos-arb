# Pharos Arb

Live page: https://pharos-arb.vercel.app

Compares the FaroSwap 0.01% and 0.30% WPROS/USDC pools in one Pacific block. The net is the spread after the pool fees, the in-tick slippage and the gas from the latest swap receipt on each pool. Two unsigned swaps are prepared only when that net is above the minimum. Nothing is signed or broadcast.

```bash
npm test
npm run web
```

Open http://localhost:3040. The example buttons fill the amount and the minimum. Scan runs only from the Scan button.
