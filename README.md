# Homebridge Roomb-O-Matic

Homebridge plugin for iRobot Roomba vacuums on the local network. It keeps the HomeKit Fan, dock switch, battery, and bin from 1.2.1, and on Homebridge 2.5 it also publishes a Matter robotic vacuum.

The published npm package `homebridge-roomb-o-matic@1.2.1` did not include TypeScript source. This repository is that package, reconstructed, with the roadmap items filled in. It is not the `homebridge-plugins/homebridge-roomba` plugin.

## Install

This release is not published to npm. Install it from GitHub:

```bash
npm install -g lucidIT-LLC/homebridge-roomb-o-MATIC#cursor/roomb-o-matic-1.3-74d4
```

Homebridge 1.9 through 2.x is supported, including 2.5. Node.js 20, 22, or 24.

## Configure

Use the Roomb-O-Matic page in Homebridge Config UI, or edit `config.json`:

```json
{
  "platform": "Roomb-O-Matic",
  "name": "Roomb-O-Matic",
  "disableDiscovery": true,
  "enableMatter": "auto",
  "devices": [
    {
      "name": "Downstairs Roomba",
      "blid": "YOUR_BLID",
      "robotpwd": "YOUR_ROBOT_PASSWORD",
      "ipaddress": "192.0.2.10",
      "cleanMode": "automatic",
      "pmapId": "YOUR_PMAP_ID",
      "userPmapvId": "YOUR_USER_PMAPV_ID",
      "rooms": [
        { "id": "1", "name": "Kitchen" },
        { "id": "2", "name": "Hall", "selected": true }
      ]
    }
  ]
}
```

`platform` must stay `Roomb-O-Matic`. `disableDiscovery: true` skips the iRobot cloud. A saved `devices` list always skips cloud login, even if an email and password are also present. If cloud discovery is used and it fails or comes back empty, accessories already cached by Homebridge stay registered and discovery retries with backoff.

`enableMatter` accepts `auto` (default), `on`, or `off`. `auto` publishes Matter when that Homebridge bridge has Matter available. The HomeKit Fan path stays in place either way.

## Password capture

Close the iRobot app first. The robot accepts one local connection at a time.

On an i-series robot such as the i5+, press and hold the **Home** button (the dock / house icon) for about two seconds, until it plays tones. Do not hold both buttons; that gesture is for 900-series robots.

The plugin then connects to port 8883 and reads the password. It retries while it waits for the button. Trailing NUL bytes are removed, because leaving one on the password makes MQTT report "Bad username or password".

In Config UI, open Roomb-O-Matic, enter the robot IP, and choose **Capture password**. The page does not print the password or BLID in the status line. Saving the form writes them into `devices` and turns cloud login off.

From a shell, including `docker exec` without a TTY:

```bash
roomb-o-matic-getpassword --ip 192.0.2.10 --config /var/lib/homebridge/config.json --name "Downstairs Roomba"
```

Add `--blid YOUR_BLID` when the robot does not answer the local announcement. The command does not use `process.stdin.setRawMode`, and it does not print the password or BLID.

## Rooms

Apple Home room selection uses Matter Service Areas. Put each room's region id and name in `rooms`, plus `pmapId` and `userPmapvId`. A selected room starts a `cleanRoom` mission with `pmap_id`, `user_pmapv_id`, and `regions`.

List those ids from a robot that is already on the network. Close the iRobot app first. If Homebridge is already connected to that robot, stop the plugin for a moment so the robot can accept this connection.

```bash
roomb-o-matic-list-rooms --ip 192.0.2.10 --blid YOUR_BLID --password YOUR_ROBOT_PASSWORD
```

The command prints map and room ids only.

## Matter pairing

A Roomba is published as its own Matter vacuum, the same way a Roborock is. Apple Home pairs that vacuum with its own code. The Homebridge bridge QR code does not add the robot.

1. In Homebridge, open Settings and turn Matter on for the bridge that runs this plugin. Restart Homebridge.
2. Save the robot in the Roomb-O-Matic settings page.
3. Open that page again and use the code under **Matter pairing**. In the Apple Home app, add an accessory and enter the code, or scan the QR code.

The HomeKit Fan, dock switch, battery, and bin stay available when Matter is off.

## Clean modes

Matter advertises three RvcCleanMode values. One mode is not enough: Homebridge 2.5 / Matter.js 0.18 reject a list shorter than 2, and Apple Home then reports the accessory as not found.

| Mode | Passes |
| --- | --- |
| Automatic | Robot default (`noAutoPasses: false`, `twoPass: false`) |
| Deep Clean | Two passes (`noAutoPasses: true`, `twoPass: true`) |
| Quick | One pass (`noAutoPasses: true`, `twoPass: false`) |

The HomeKit Fan still starts and stops a clean. Its clean mode and selected rooms come from the device config until a Matter controller changes them.

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

Do not put real BLIDs, passwords, Matter pairing codes, or personal addresses in this repository.
