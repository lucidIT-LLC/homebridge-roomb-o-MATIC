# Changelog

## 1.3.0

- Restored the plugin from the published npm package `homebridge-roomb-o-matic@1.2.1` (`gitHead` `e913f935fc29512cadffc40e0597d97c150cb1d5`). The checked-out fork of `homebridge-plugins/homebridge-roomba` was the wrong baseline.
- Replaced the TypeScript stub that had been published as `config.schema.json` with a real Homebridge config schema.
- Added local password capture that works without a TTY, strips trailing NUL bytes, and writes `blid`, `robotpwd`, and IP into the device config.
- Published a Matter robotic vacuum with Automatic, Deep Clean, and Quick modes, and Service Area rooms from `rooms`, `pmapId`, and `userPmapvId`. The HomeKit Fan path remains.
- Updated `dorita980` to 4.x. Local `devices` skip cloud login. A failed or empty cloud discovery keeps cached accessories and retries with backoff.

## 1.2.1

Recovered from the npm registry tarball. That publish exposed a HomeKit Fan, dock switch, battery, and bin, with hybrid `getRobotState` / `getStatus` polling and local `devices` entries of `name`, `blid`, `robotpwd`, and `ipaddress`.
