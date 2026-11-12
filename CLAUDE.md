# Roomb-O-Matic

This repository is `homebridge-roomb-o-matic`, restored from npm `1.2.1`. Source `1.3.0` was not published. `1.3.1` is the npm release: that 1.3.0 work, plus the local-password slice fix and Matter Vacuum tags. It is not `homebridge-plugins/homebridge-roomba`.

- `npm test` — vitest
- `npm run lint` — ESLint, zero warnings
- `npm run build` — `tsc` into `dist/`
- Platform name is exactly `Roomb-O-Matic` (`src/settings.ts`)
- Package type is ESM. Relative imports use `.js`
- Do not log a robot password or BLID
- Do not publish to npm from this checkout
