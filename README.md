# SMARTFUZE AQUA v2.0.3

Shrimp pond monitoring with **real ESP32 data only**. This is the foundation release: real pH, real water temperature, history, online/offline status, pH calibration, a mobile app (PWA) and an Integration Hub that later versions build on.

```
Sensors -> ESP32 -> Wi-Fi -> MQTT (port 1883) -> AQUA server -> Dashboard (port 3000) -> phone / desktop
```

## What's new in v2.0.3

- **Event bus inside the server** (`lib/bus.js`). Ingest, storage, alerts, notifications, feeding and the live dashboard no longer call each other; each publishes events and subscribes to the ones it needs. A failing module is isolated and counted; the others keep working. Settings > System modules shows every event, who handles it and any errors. Later, modules can move to separate services by swapping the bus for an external broker, without rewriting them.
- **Multi-site MQTT topics**: `aqua/site/<SITE_ID>/pond/<POND_ID>/...`, ready for v3.0 (shop + 1-acre farm). Old topics are still accepted. Device logins created in Settings are tied to a site and pond.

## Two ways to run AQUA (v2.0.2)

| | Cloud (recommended for a shop with only a 4G router) | Local PC |
|---|---|---|
| Where AQUA runs | A small cloud server (DigitalOcean, Singapore) | A Windows PC in the shop (`START_AQUA.bat`) |
| PC needed in the shop | No | Yes, on 24 h |
| Phone access | `https://yourname.duckdns.org`, anywhere | Same Wi-Fi, or Tailscale |
| Shop power cut / 4G down | Detected by the cloud within 5 minutes | PC is down too |
| Security | Dashboard login, encrypted device connections (TLS, port 8883), one login per ESP32 | Trusted local network |
| Setup guide | **`docs/CLOUD_SETUP_ZH.md`** (Chinese, step by step) | This README |

**v2.0.2 adds:** cloud mode with one-line installer (`cloud/install.sh`: Node.js, Caddy HTTPS, firewall, auto-start, hourly certificate sync, daily backups, `aqua-update`, `aqua-reset-password`); dashboard sign-in (90-day sessions, lockout after 10 wrong passwords, CSRF protection); per-device MQTT logins limited to their own pond; ESP32 firmware with TLS (Let's Encrypt roots built in), internet time and a 6-hour offline buffer that is uploaded with real timestamps after a 4G outage, without ever replacing the live value.

## What's new in v2.0.1 (shrimp RAS safety release)

Built for **Pacific white shrimp in a low-salinity recirculating system (RAS)**. Hardware shopping list and wiring in Chinese: **`docs/HARDWARE_ZH.md`**, diagram: **`docs/wiring.svg`**.

- **Life support monitoring**: circulation pump (flow sensor), air pump (current clamp), sump water level (two float switches), dissolved oxygen (field ready; driver once you choose a sensor). Sensors that are not installed show "Not installed", never zero. Pump, air and level changes are sent immediately, not just every 60 s.
- **Phone alerts that wake you up**: Pushover on iPhone and Android. Critical alerts repeat every 30 s until someone acknowledges. Messages are in Chinese. Failed sends retry after 1, 2 and 3 minutes. Set up in **Settings**.
- **Watchdog**: AQUA pings healthchecks.io every minute. If the PC loses power or internet, healthchecks.io alerts you, because AQUA cannot.
- **Shrimp alert defaults**: temperature 26–32 °C (critical below 24 / above 34), pH 7.5–8.5 (critical below 7.0 / above 9.0), pH daily swing (warning above 0.5, critical above 0.8, from 10-minute averages over 24 h), oxygen below 4 / 3 mg/L, pump stopped, air stopped, level low / high, sensor not reporting, device offline. All editable.
- **After a restart** (for example a power cut), a pond that never reports again still raises "Device offline".
- **Feeding safety interlock**: feeding pauses when the monitor is offline, a critical alert is active, or inside an optional pause window. Scheduled feeds are skipped and logged as "Skipped". Feed now asks for an in-person check to override.
- **pH temperature compensation**: enter the buffer temperature on the Calibration page to turn it on.
- **Water quality log**: total ammonia, nitrite, nitrate, alkalinity, salinity from test kits. AQUA calculates toxic un-ionised ammonia (NH3-N) from the pH and temperature at test time, flags results against limits (stricter nitrite limits for low salinity), raises alerts, and suggests a sodium bicarbonate dose from the system volume.
- **Crop cycle**: stocking, weight samples, feed in kg, mortality, harvest. Shows day of culture, estimated survival, average weight, growth per week, biomass, density and FCR, clearly marked as estimates until harvest.
- **Upgrade from v2.0.0**: copy your old `data` folder into the new folder. It is upgraded automatically on first start; the old file is kept as `data/state.json.v2.0.0-backup`. Alert rules are replaced with the shrimp RAS defaults.

---

## 1. What you need

| Item | Version / detail |
|---|---|
| Windows laptop or Mini PC | Windows 10 or 11 |
| Node.js | **18 or newer** (install the **LTS** version from https://nodejs.org) |
| Arduino IDE | 2.x, with the **esp32 by Espressif Systems** board package (3.x recommended) |
| ESP32 | ESP32 Dev Module |
| Sensors | DS18B20 waterproof probe, PH-4502C-type pH module |

No Docker and no database are needed.

---

## 2. Arduino libraries

In Arduino IDE: **Tools → Manage Libraries…**, install:

| Library | Author |
|---|---|
| PubSubClient | Nick O'Leary |
| OneWire | Paul Stoffregen |
| DallasTemperature | Miles Burton |

`WiFi` is already included with the ESP32 board package.

Board settings: **Tools → Board → esp32 → ESP32 Dev Module**, Upload speed 921600 (or 115200 if uploads fail).

---

## 3. ESP32 wiring

### DS18B20 temperature probe

| Probe wire | ESP32 |
|---|---|
| Red (VCC) | 3.3V |
| Black (GND) | GND |
| Yellow (DATA) | **GPIO4** |
| Pull-up resistor (4.7 kΩ) | between DATA and 3.3V |

### pH module (PH-4502C type)

| pH module pin | Connect to |
|---|---|
| V+ | ESP32 **5V** (VIN) |
| G / GND | ESP32 GND |
| PO (analog out) | **through the voltage divider below**, never directly |

---

## 4. pH voltage divider

The pH module can output close to 5 V. The ESP32 input must stay below 3.3 V, so PO goes through a divider:

```
pH PO
  |
 20 kΩ   (top)
  |
  +------ GPIO34   (ESP32 analog input)
  |
 10 kΩ   (bottom)
  |
 GND
```

Voltage at GPIO34 = PO × 10k / (20k + 10k) = **PO ÷ 3**.

The dashboard shows both: "Voltage at GPIO34" and the reconstructed "Module PO voltage".

---

## 5. pH calibration values

Your real buffer readings (probe **PH-01**) are already stored, both in the firmware and on the **Calibration** page:

| Buffer | RAW |
|---|---|
| pH 4.01 | 1725 |
| pH 6.86 | 1500 |
| pH 9.18 | 1340 |

pH is calculated by **piecewise linear interpolation**: one straight line between 4.01 and 6.86, another between 6.86 and 9.18. Outside that range the nearest line is extended, then clamped to 0–14.

**How calibration is applied:** the ESP32 sends its averaged RAW value. The AQUA server recalculates pH from RAW using the **active calibration for that pond**. So:

- When you replace or re-calibrate a probe, open **Calibration → New calibration**, enter the new probe ID and RAW values, and make it active. No firmware change needed.
- The firmware's own copy of the values is only a fallback and for the Serial Monitor.

**Re-calibrating, step by step**

1. Open **Calibration**. The "Live probe reading" panel shows the current RAW.
2. Rinse the probe with clean water, put it in the pH 4.01 buffer.
3. Wait until RAW stops moving across 2–3 readings (one reading per minute; the Serial Monitor shows one every 5 seconds).
4. Click **New calibration**, press **Use live** next to pH 4.01.
5. Rinse, repeat with 6.86 and 9.18.
6. Enter the Probe ID (for example `PH-02`) and today's date, then **Save calibration**.

Tip: also fill in the real calibration date for PH-01; it is stored as "Not recorded" because the original date was not supplied.

---

## 6. Start AQUA (double-click)

1. Unzip `SMARTFUZE-AQUA-v2.0.3.zip` to a simple folder, for example `C:\SMARTFUZE-AQUA`.
2. Double-click **`START_AQUA.bat`**.

It will:

1. check Node.js,
2. install dependencies if they are missing (they are already included in the ZIP, so normally no internet is needed),
3. start the MQTT broker, backend and dashboard,
4. open your browser at **http://localhost:3000**.

**Keep the black window open.** Closing it stops AQUA.

The first time, **Windows Firewall** may ask about Node.js. Tick **Private networks** and click **Allow**. Without this, the ESP32 and your phone cannot connect.

To start AQUA automatically when the PC turns on: press `Win + R`, type `shell:startup`, and put a shortcut to `START_AQUA.bat` in that folder. Also set the PC to never sleep (Settings → System → Power).

---

## 7. MQTT port

**1883** (plain MQTT, local network only).

| Topic | Direction | Content |
|---|---|---|
| `aqua/site/<SITE_ID>/pond/<POND_ID>/telemetry` | ESP32 → AQUA | JSON, every 60 s and right after connecting |
| `aqua/site/<SITE_ID>/pond/<POND_ID>/status` | ESP32 → AQUA | `online`, or `offline` (Last Will) |
| `aqua/site/<SITE_ID>/pond/<POND_ID>/command/#` | AQUA → device | commands (feeding now, relays in v2.2.0) |
| `aqua/site/<SITE_ID>/pond/<POND_ID>/ack` | device → AQUA | acknowledgements |

`SITE_ID` groups ponds by location (default `SITE-01`, shown in Settings). `POND_ID` must be unique across all sites. Firmware older than 2.0.3 uses `aqua/pond/<POND_ID>/...`; AQUA still accepts it and sends that pond's commands in the same format, so old devices keep working until they are re-flashed.

Telemetry example:

```json
{
  "deviceId": "AQUA-POND-A-01",
  "pondId": "POND-A",
  "pondName": "Pond A",
  "temperatureC": 28.94,
  "ph": 6.86,
  "phRaw": 1500,
  "phVoltage": 1.209,
  "rssi": -62,
  "uptimeSec": 12345,
  "firmwareVersion": "2.0.0"
}
```

---

## 8. Dashboard port

**3000** → http://localhost:3000 on the AQUA PC.

To change ports, set environment variables before starting: `AQUA_HTTP_PORT`, `AQUA_MQTT_PORT`.

---

## 9. Find the Windows LAN IP

The ESP32 and your phone need the AQUA PC's address on the local network.

Easiest: the black AQUA window prints it at start-up, for example:

```
Phone/LAN:  http://192.168.1.100:3000
MQTT:       1883   (ESP32 MQTT_HOST = 192.168.1.100)
```

It is also shown on the **Settings** page.

Manual way: press `Win + R`, type `cmd`, press Enter, type `ipconfig`, and look for **IPv4 Address** under your Wi-Fi or Ethernet adapter.

**Important:** give the AQUA PC a fixed address so it does not change. In your 4G router's admin page, look for "DHCP reservation" / "Static lease" and reserve the IP for the PC.

### Configure and flash the ESP32

Open `firmware/SMARTFUZE_AQUA_ESP32/SMARTFUZE_AQUA_ESP32.ino` and edit the top:

```cpp
const char* WIFI_SSID      = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST      = "192.168.1.100";     // the AQUA PC's LAN IP
const uint16_t MQTT_PORT   = 1883;
const char* POND_ID        = "POND-A";            // letters, numbers, - and _
const char* POND_NAME      = "Pond A";
const char* DEVICE_ID      = "AQUA-POND-A-01";    // must be unique per ESP32
```

Upload, then open **Tools → Serial Monitor** at **115200** baud. You should see:

```
[WiFi] connecting to "..."
[MQTT] connecting to 192.168.1.100:1883 as AQUA-POND-A-01 ... connected
[PUBLISHED] T=28.94 C | pH=6.86 | RAW=1500 | Vpin=1.209 V | ...
```

Within seconds the pond appears on the dashboard. **For a second pond**, flash another ESP32 with `POND_ID "POND-B"`, `POND_NAME "Pond B"` and `DEVICE_ID "AQUA-POND-B-01"`. It appears automatically.

ESP32 Wi-Fi must be **2.4 GHz** (the ESP32 cannot use 5 GHz).

---

## 10. Phone on the same network

1. Connect the phone to the **same Wi-Fi** as the AQUA PC.
2. Open `http://<AQUA-PC-IP>:3000` in Chrome (Android) or Safari (iPhone).
3. Add it to the home screen:
   - **iPhone:** Share button → **Add to Home Screen**.
   - **Android:** Chrome menu (⋮) → **Add to Home screen**.

It then opens full screen like an app.

Good to know: on plain `http://` over the LAN, browsers limit PWAs. iPhone home-screen mode works; Android adds a shortcut, and the offline app shell is not used. Over **HTTPS** (Cloudflare Tunnel or Tailscale, below) you get a full installable app on both.

The app never shows an old reading as live: if the server is unreachable, it shows a "Lost connection" banner.

---

## 11. Remote access from outside the farm

The farm uses a **4G SIM router**. Mobile carriers almost always use **CGNAT**, which blocks incoming connections, so normal port forwarding will not work. Use a secure tunnel that the AQUA PC opens **outward**:

```
ESP32 --Wi-Fi--> 4G router --> AQUA PC (local MQTT 1883, dashboard 3000)
                                   |
                                   +--outbound tunnel--> Cloudflare / Tailscale <-- your phone anywhere
```

**Never forward or expose port 1883 to the internet.** MQTT stays local. Only the dashboard goes through the tunnel.

### Option A: Tailscale (simplest, private)

1. Install Tailscale on the AQUA PC and on your phone (https://tailscale.com), sign in to the same account on both.
2. On the phone, open `http://<AQUA-PC-tailscale-name>:3000`, for example `http://aqua-pc:3000`.
3. For HTTPS (full PWA install), on the AQUA PC run once in a terminal:
   `tailscale serve --bg 3000`
   then open the `https://aqua-pc.<your-tailnet>.ts.net` address it prints.

Only devices signed into your Tailscale account can reach AQUA.

### Option B: Cloudflare Tunnel (web address, needs a domain)

1. Add a domain to a free Cloudflare account.
2. Install `cloudflared` on the AQUA PC and create a tunnel to `http://localhost:3000` (Cloudflare dashboard → Zero Trust → Networks → Tunnels).
3. **Protect it with Cloudflare Access** (Zero Trust → Access → Applications) so only your email can log in. AQUA v2.0.0 has no user login of its own, so do not publish it without Access.

### Data use

ESP32 telemetry is tiny (well under 1 MB per day per pond). Opening the dashboard remotely uses a few MB. Future cameras (v2.3.0) will record to microSD / NVR locally and only use mobile data while you watch live.

---

## 12. How integrations work (Apps & Integrations)

AQUA is not tied to one brand. Every device you add is an **integration** with:

`id, name, provider, category, mode, pondId, launchUrl, apiBaseUrl, mqttCommandTopic, notes, enabled, status`

**Providers:** ESP32, Tuya / Smart Life, Tapo, VSON Smart, MQTT Device, ONVIF / RTSP Camera, Custom REST API, External App, Custom App.

**Modes:**

| Mode | What AQUA does in v2.0.0 |
|---|---|
| `external` | Shows an **Open app** button using the Launch URL. Control happens in the maker's app. |
| `mqtt` | Publishes commands to the topic you set. Shows "Confirmed" only if the device acknowledges. |
| `rest` | Stores the API address; calls come in a later version. |
| `onvif` | Stores the RTSP/ONVIF address; camera preview comes in v2.3.0. |
| `native` | Reserved for built-in drivers in later versions. |

**Status is never invented.** It shows External App, Configured, Not configured, Disabled, or (for ESP32 only, because AQUA can verify it) Online / Offline.

**Example: Tapo camera or VSON Smart**

1. Apps & Integrations → **Add integration** → Tapo (or VSON Smart).
2. Mode `external`, pond `POND-A`, Launch URL: the app's web or store link.
3. Save. The card shows **External App** with **Open app**; the Overview **Camera** button opens it.

When an API or MQTT option appears later, edit the same integration and change its mode. Nothing else has to be rebuilt.

**Example: the Wi-Fi feeder**

Its protocol is not confirmed, so add it as Tuya / Smart Life, category `feeder`, mode `external`. "Feed now" then opens the feeder app and records **External App Opened**.

If a feeder ever speaks MQTT, set mode `mqtt` and a topic. AQUA sends:

```json
{ "cmd": "feed", "commandId": "cmd-...", "pondId": "POND-A", "durationSec": 10, "ackTopic": "aqua/site/SITE-01/pond/POND-A/ack" }
```

and only marks it **Confirmed** when the device replies on `aqua/site/SITE-01/pond/POND-A/ack` with:

```json
{ "commandId": "cmd-...", "status": "confirmed" }
```

### Feeding status meanings

| Status | Meaning |
|---|---|
| Command Sent | AQUA sent the command. **Not** confirmed that food was dispensed. |
| External App Opened | The feeder app was opened. Check the result there. |
| Confirmed | The feeder acknowledged the command. |
| Failed | Sending failed or the feeder reported an error. |

AQUA never shows "Completed" without an acknowledgement, because a false feeding confirmation is dangerous for the stock.

**Schedules** (for example 08:00, 13:00, 18:00, 22:00) are sent by AQUA for MQTT feeders. For external-app feeders, set the same times in the feeder's app; AQUA keeps them as reference.

### Controls

CH1 Aerator, CH2 Water pump, CH3 Feeder, CH4 Spare are reserved and **disabled** in v2.0.0. Relay control arrives in v2.2.0. Any mains (230 V) wiring must be done by a licensed electrician.

### Alerts

Rules: pH low, pH high, temperature low, temperature high, device offline. Thresholds are editable on the **Alerts** page (defaults: pH 7.0–9.0, temperature 24–33 °C; adjust them to your species and farm).

- A value must stay outside the threshold **continuously for 5 minutes** (editable) before an alert is raised. One bad sample never alerts.
- Device offline: no telemetry for 5 minutes.
- Alerts show in the app and, once Pushover is set up in Settings, ring on phones. WhatsApp and Email are planned.

---

## 13. The no-demo-data rule

This system never invents values:

- No sample ponds, temperatures, pH values, history or camera status.
- A pond exists only after a real ESP32 sends telemetry.
- With no hardware, screens show **—**, "Waiting for real ESP32 telemetry" or "Not configured".
- `-127 °C` and `85 °C` (DS18B20 fault and power-on values) are rejected and never stored.
- An unplugged or saturated pH input is reported as missing, not as a number.
- An offline device's last values are labelled "Last known value".

The only values shipped in `data/state.json` are your real PH-01 calibration and the editable alert thresholds.

---

## 14. Backup and restore

All data lives in the **`data`** folder:

```
data/
  state.json                         settings, ponds, calibrations, integrations, schedules, alerts
  readings/POND-A/2026-10-27.ndjson  one line per stored reading, one file per pond per day (UTC)
```

At one reading per minute that is about 1,440 lines per day and about 43,200 per month per pond (roughly 8 MB/month per pond).

**Backup:** double-click **`BACKUP_DATA.bat`**. It copies `data` to `backups\data-YYYYMMDD-HHMM`. Copy that to a USB drive or cloud folder regularly.

Also in the dashboard (Settings): download a configuration backup (JSON) or a 30-day CSV per pond for Excel.

**Restore:**

1. Close the AQUA window.
2. Rename the current `data` folder (for example `data-old`).
3. Copy the backup folder in its place and rename it to `data`.
4. Double-click `START_AQUA.bat`.

**Moving to a new PC:** copy the whole AQUA folder (including `data`), install Node.js, start. Then update `MQTT_HOST` in the ESP32 firmware if the IP changed.

---

## Troubleshooting

| Problem | Check |
|---|---|
| "Node.js is not installed" | Install the LTS from nodejs.org, then restart the PC. |
| "port 1883 is already in use" | Another MQTT broker (for example Mosquitto) is running. Stop it, or set `AQUA_MQTT_PORT`. |
| ESP32 shows `MQTT ... failed (state -2)` | Wrong `MQTT_HOST`, PC firewall blocking Node.js, or the ESP32 is on a different network. |
| Phone cannot open the dashboard | Same Wi-Fi? Firewall allowed on Private networks? Is the network set to "Private" in Windows? |
| Temperature shows "—" | Check DS18B20 wiring and the 4.7 kΩ pull-up. Serial Monitor shows "INVALID". |
| pH stuck near 0 or 14, RAW 0 or 4095 | Check the divider and PO wire; never connect PO directly to GPIO34. |
| pH drifts | Clean the probe, keep it wet, re-calibrate every 2–4 weeks. |

---

## Project layout

```
SMARTFUZE-AQUA-v2.0.0/
  START_AQUA.bat        double-click start
  BACKUP_DATA.bat       copy data/ to backups/
  package.json          Node dependencies: aedes, express, ws
  server.js             MQTT broker + API + WebSocket + scheduler
  lib/store.js          file storage
  lib/ph.js             pH calibration math
  lib/alerts.js         sustained-duration alert engine
  public/               dashboard PWA (index.html, styles.css, app.js, manifest, sw.js, icons)
  firmware/SMARTFUZE_AQUA_ESP32/SMARTFUZE_AQUA_ESP32.ino
  docs/HARDWARE_ZH.md   hardware shopping list, wiring, tests (Chinese)
  docs/CLOUD_SETUP_ZH.md  cloud setup for beginners (Chinese)
  cloud/                install.sh, aqua-update, aqua-reset-password
  tools/admin.js        set password / add device login (used by the installer)
  docs/wiring.svg       wiring diagram
  lib/aquaculture.js    NH3, dosing, pH compensation, crop-cycle maths
  lib/notify.js         Pushover + watchdog
  lib/bus.js            in-process event bus
  data/                 your data (state.json, readings/)
  node_modules/         dependencies, pre-installed
```

## Roadmap

| Version | Adds |
|---|---|
| v2.0.0 | Foundation: pH, temperature, PWA, history, online/offline, calibration, Integration Hub |
| v2.0.1 | Shrimp RAS safety: life-support sensors, Pushover alerts, watchdog, feeding interlock, water log, crop cycle |
| v2.0.2 | Cloud mode: login, encrypted device connections, one-line installer, offline buffer |
| v2.0.3 | Internal event bus; multi-site MQTT topics |
| v2.0.4 | Dissolved oxygen sensor driver (once the model is chosen), Chinese interface |
| v2.1.0 | Feeding with a real feeder driver, integration improvements |
| v2.2.0 | Relays: aerator, water pump, actuator automation (with state feedback) |
| v2.3.0 | CCTV: Tapo, ONVIF / RTSP preview, snapshots, NVR |
| v3.0.0 | Many ponds and multiple farms / sites, commercial platform |

The data model already carries `pondId` on every record and a `site` in `state.json`, so these versions extend v2.0.0 instead of replacing it.
