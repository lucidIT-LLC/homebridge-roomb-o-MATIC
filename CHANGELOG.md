# Changelog

## 1.3.1

First npm release since 1.2.1. Source version 1.3.0 (squash-merged in #1) was never published. This package is that work plus two fixes found in real Homebridge use.

### Fixes

- Local password capture keeps the full password, including a leading `:1:` when the robot sends one. A typical reply is 38 bytes: a 7-byte header, then a 30-character password at offset 7. The decoder used to slice at 13, or at 9 after a 2-byte chunk, which dropped `:1:` and the following bytes and stored 24 characters. The robot refuses that secret with MQTT CONNACK "Bad username or password" — the same truncated value older Roomba plugins saved. The decoder now searches the packet for `:1:` and slices from that offset. That candidate wins over offsets 9 and 13. A packet with no `:1:` prefix still uses the previous offset. Trailing NULs are still removed. `cleanCredential` and device sanitizing only strip trailing NULs and trim; they do not remove a leading `:1:`. `roomb-o-matic-getpassword` uses the same decoder. If a saved robot fails local login with "Bad username or password", capture the password again.
- Matter RvcCleanMode tags now include Vacuum (`16385`) on Automatic, Deep Clean, and Quick. Apple Home was hiding Deep Clean (tag `16384` only) and could hide Quick (tag `1` only). Automatic already had Auto (`0`) and Vacuum. Deep Clean is two vacuum passes, not a mop cycle. No Mop tag is advertised.

### Included from 1.3.0 source (not previously published to npm)

- Restored the plugin from the published npm package `homebridge-roomb-o-matic@1.2.1` (`gitHead` `e913f935fc29512cadffc40e0597d97c150cb1d5`). The checked-out fork of `homebridge-plugins/homebridge-roomba` was the wrong baseline.
- Replaced the TypeScript stub that had been published as `config.schema.json` with a real Homebridge config schema.
- Added local password capture that works without a TTY, strips trailing NUL bytes, and writes `blid`, `robotpwd`, and IP into the device config.
- Added a Matter robotic vacuum with Automatic, Deep Clean, and Quick modes, and Service Area rooms from `rooms`, `pmapId`, and `userPmapvId`. The HomeKit Fan path remains. Local MQTT is used for robots saved in `devices`.
- Updated `dorita980` to 4.x. Local `devices` skip cloud login. A failed or empty cloud discovery keeps cached accessories and retries with backoff.

## 1.3.0

Source-only. Not published to npm. The user-facing notes for this work are under 1.3.1, which is the npm release that contains it. The password-slice fix and the Matter Vacuum tags were not in this source version.

- Restored the plugin from the published npm package `homebridge-roomb-o-matic@1.2.1` (`gitHead` `e913f935fc29512cadffc40e0597d97c150cb1d5`). The checked-out fork of `homebridge-plugins/homebridge-roomba` was the wrong baseline.
- Replaced the TypeScript stub that had been published as `config.schema.json` with a real Homebridge config schema.
- Added local password capture that works without a TTY, strips trailing NUL bytes, and writes `blid`, `robotpwd`, and IP into the device config.
- Published a Matter robotic vacuum with Automatic, Deep Clean, and Quick modes, and Service Area rooms from `rooms`, `pmapId`, and `userPmapvId`. The HomeKit Fan path remains.
- Updated `dorita980` to 4.x. Local `devices` skip cloud login. A failed or empty cloud discovery keeps cached accessories and retries with backoff.

## 1.2.1

Recovered from the npm registry tarball. That publish exposed a HomeKit Fan, dock switch, battery, and bin, with hybrid `getRobotState` / `getStatus` polling and local `devices` entries of `name`, `blid`, `robotpwd`, and `ipaddress`.
