/*
  ================================================================
  SMARTFUZE AQUA  -  ESP32 pond node  -  firmware 2.0.3 (cloud + multi-site ready)
  ================================================================
  Board:     ESP32 Dev Module
  Always:    DS18B20 water temperature -> GPIO4
             PH-4502C pH module PO -> 20k/10k divider -> GPIO34
  Optional (enable below only when the part is really installed):
             Flow sensor -> GPIO27 | Float switches -> GPIO25/26 | SCT-013-005 -> GPIO35
  Wiring: docs/wiring.svg    Cloud setup: docs/CLOUD_SETUP_ZH.md

  Libraries: PubSubClient (Nick O'Leary), OneWire, DallasTemperature
  (WiFi, WiFiClientSecure and time are part of the ESP32 board package)

  TOPICS (2.0.3): aqua/site/<SITE_ID>/pond/<POND_ID>/telemetry | status | ack | command/#
     SITE_ID groups ponds by location (shop, farm). POND_ID must be unique across all sites.

  CLOUD (USE_TLS 1): encrypted MQTT on port 8883 with this device's own login.
     The clock is set from the internet first (TLS needs the correct date).
  4G OUTAGE: readings keep being taken every minute and are stored here
     (up to 6 hours). They are uploaded with their real time after reconnecting,
     so the history has no gap. The live value on the dashboard is never faked.
  ================================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>
#include "esp_timer.h"

// ======================= CONFIG - EDIT THESE =======================
const char* WIFI_SSID      = "YOUR_4G_ROUTER_WIFI";   // 2.4 GHz network
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";

#define USE_TLS 1                                   // 1 = cloud server, 0 = PC on the same network
const char* MQTT_HOST      = "yourname.duckdns.org"; // cloud: your DuckDNS address | local: PC LAN IP
const uint16_t MQTT_PORT   = 8883;                   // cloud: 8883 | local: 1883
const char* MQTT_USER      = "dev-pond-a";           // from the installer summary / Settings > Device logins
const char* MQTT_PASS      = "PASTE_DEVICE_PASSWORD";

const char* SITE_ID        = "SITE-01";              // AQUA Settings shows this site ID
const char* POND_ID        = "POND-A";               // unique across all sites; must match the device login
const char* POND_NAME      = "Pond A";
const char* DEVICE_ID      = "AQUA-POND-A-01";

// ---- Optional sensors: set to 1 ONLY when the part is installed and wired ----
#define ENABLE_FLOW_SENSOR    0
#define ENABLE_LEVEL_SWITCHES 0
#define ENABLE_AIRPUMP_CT     0
const float FLOW_PULSES_PER_LITRE = 450.0;   // YF-S201 = 450; check your sensor's datasheet
const float FLOW_MIN_LPM          = 2.0;     // below this the circulation pump counts as STOPPED
const bool LEVEL_LOW_TRIGGERED_WHEN_CLOSED  = true;
const bool LEVEL_HIGH_TRIGGERED_WHEN_CLOSED = true;
const float CT_AMPS_PER_VOLT = 5.0;          // SCT-013-005
const float AIRPUMP_ON_AMPS  = 0.15;         // set between the OFF and ON readings
// ===================================================================

const char* FIRMWARE_VERSION = "2.0.3";

// Let's Encrypt root certificates (ISRG Root X1 + X2). Valid until 2035 / 2040.
static const char ROOT_CA[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
)PEM";

const uint8_t PIN_DS18B20 = 4, PIN_PH = 34, PIN_CT = 35, PIN_FLOW = 27, PIN_LEVEL_LOW = 25, PIN_LEVEL_HIGH = 26;

const unsigned long TELEMETRY_INTERVAL_MS = 60000;
const unsigned long SERIAL_PREVIEW_MS     = 5000;
const unsigned long FAST_SENSOR_MS        = 2000;
const unsigned long LEVEL_DEBOUNCE_MS     = 3000;
const unsigned long WIFI_RETRY_MS         = 15000;
const unsigned long MQTT_RETRY_MS         = 10000;
const unsigned long RESTART_IF_OFFLINE_MS = 10UL * 60UL * 1000UL;
const unsigned long MIN_EVENT_GAP_MS      = 5000;
const unsigned long FLUSH_GAP_MS          = 300;   // pace buffered uploads

const int PH_SAMPLES = 40, PH_TRIM = 6, PH_SAMPLE_DELAY_MS = 8;
const int   CAL_COUNT = 3;
const float CAL_PH[CAL_COUNT]  = { 4.01, 6.86, 9.18 };
const float CAL_RAW[CAL_COUNT] = { 1725, 1500, 1340 };
const float ADC_MAX = 4095.0, ADC_VREF = 3.3;

OneWire oneWire(PIN_DS18B20);
DallasTemperature tempSensors(&oneWire);
#if USE_TLS
WiFiClientSecure netClient;
#else
WiFiClient netClient;
#endif
PubSubClient mqtt(netClient);

char topicTelemetry[128], topicStatus[128], topicCommand[128];
unsigned long lastTelemetryMs = 0, lastPreviewMs = 0, lastWifiTryMs = 0, lastMqttTryMs = 0;
unsigned long wifiLostSinceMs = 0, lastFastMs = 0, lastEventMs = 0, lastFlushMs = 0;
bool publishNow = false, timeRequested = false;
const char* publishReason = "interval";

volatile uint32_t flowPulses = 0;
float flowLpm = 0; bool pumpRunning = false; bool flowValid = false;
float airAmps = 0; bool airRunning = false; bool airValid = false;
const char* waterLevel = "ok";
int lowRaw = -1, highRaw = -1; unsigned long lowSince = 0, highSince = 0; bool lowStable = false, highStable = false;

struct Reading { bool tempValid; float temperatureC; bool phValid; float ph; int phRaw; float phVoltage; };

// One minute of data, compact enough to keep 6 hours in RAM.
const int16_t NIL = INT16_MIN;
struct Snap { uint32_t ts; int16_t t100; int16_t ph100; uint16_t raw; uint16_t mv; int16_t flow10; int16_t airmA; int8_t pump; int8_t air; int8_t level; };
const int BUF_MAX = 360;
Snap buf[BUF_MAX];
int bufHead = 0, bufCount = 0;

uint32_t uptimeSec() { return (uint32_t)(esp_timer_get_time() / 1000000ULL); }
bool timeValid() { return time(nullptr) > 1700000000; }

// ------------------------------------------------------------------ core sensors
bool readTemperature(float &out) {
  if (tempSensors.getDeviceCount() == 0) {
    tempSensors.begin();
    if (tempSensors.getDeviceCount() == 0) return false;
    tempSensors.setResolution(12);
  }
  for (int attempt = 0; attempt < 3; attempt++) {
    tempSensors.requestTemperatures();
    float t = tempSensors.getTempCByIndex(0);
    if (t != DEVICE_DISCONNECTED_C && t > -55.0 && t < 125.0 && t != 85.0) { out = t; return true; }
    delay(100);
  }
  return false;
}

int readPhRaw() {
  int s[PH_SAMPLES];
  for (int i = 0; i < PH_SAMPLES; i++) { s[i] = analogRead(PIN_PH); delay(PH_SAMPLE_DELAY_MS); }
  for (int i = 1; i < PH_SAMPLES; i++) { int k = s[i], j = i - 1; while (j >= 0 && s[j] > k) { s[j + 1] = s[j]; j--; } s[j + 1] = k; }
  long sum = 0;
  for (int i = PH_TRIM; i < PH_SAMPLES - PH_TRIM; i++) sum += s[i];
  return (int)lround((double)sum / (PH_SAMPLES - 2 * PH_TRIM));
}

float rawToPh(int raw) {
  int a = 0, b = 1;
  if (raw >= CAL_RAW[0]) { a = 0; b = 1; }
  else if (raw <= CAL_RAW[CAL_COUNT - 1]) { a = CAL_COUNT - 2; b = CAL_COUNT - 1; }
  else for (int i = 0; i < CAL_COUNT - 1; i++) if (raw <= CAL_RAW[i] && raw >= CAL_RAW[i + 1]) { a = i; b = i + 1; break; }
  float p = CAL_PH[a] + (raw - CAL_RAW[a]) * (CAL_PH[b] - CAL_PH[a]) / (CAL_RAW[b] - CAL_RAW[a]);
  return p < 0 ? 0 : (p > 14 ? 14 : p);
}

Reading takeReading() {
  Reading r;
  r.tempValid = readTemperature(r.temperatureC);
  r.phRaw = readPhRaw();
  r.phVoltage = (r.phRaw / ADC_MAX) * ADC_VREF;
  r.phValid = (r.phRaw > 10) && (r.phRaw < 4090);
  r.ph = r.phValid ? rawToPh(r.phRaw) : 0;
  return r;
}

// ------------------------------------------------------------------ optional sensors
void IRAM_ATTR onFlowPulse() { flowPulses++; }

float readCtAmps() {
  // RMS over ~200 ms (10 mains cycles at 50 Hz). Mean removed, so the bias point does not matter.
  const int N = 1000;
  static uint16_t mv[N];
  long sum = 0;
  for (int i = 0; i < N; i++) { mv[i] = analogReadMilliVolts(PIN_CT); sum += mv[i]; delayMicroseconds(150); }
  float mean = (float)sum / N, acc = 0;
  for (int i = 0; i < N; i++) { float d = mv[i] - mean; acc += d * d; }
  float vrms = sqrt(acc / N) / 1000.0;
  return vrms * CT_AMPS_PER_VOLT;
}

bool levelTriggered(uint8_t pin, bool whenClosed) {
  bool closed = digitalRead(pin) == LOW;  // closed switch pulls to GND
  return whenClosed ? closed : !closed;
}

void updateFastSensors() {
  unsigned long now = millis();
  if (now - lastFastMs < FAST_SENSOR_MS) return;
  unsigned long dt = now - lastFastMs;
  (void)dt;
  lastFastMs = now;
  bool changed = false;

#if ENABLE_FLOW_SENSOR
  noInterrupts(); uint32_t p = flowPulses; flowPulses = 0; interrupts();
  flowLpm = (p / FLOW_PULSES_PER_LITRE) / (dt / 60000.0);
  bool run = flowLpm >= FLOW_MIN_LPM;
  if (flowValid && run != pumpRunning) { changed = true; publishReason = run ? "pump-started" : "pump-stopped"; }
  pumpRunning = run; flowValid = true;
#endif

#if ENABLE_AIRPUMP_CT
  airAmps = readCtAmps();
  bool on = airAmps >= AIRPUMP_ON_AMPS;
  if (airValid && on != airRunning) { changed = true; publishReason = on ? "air-started" : "air-stopped"; }
  airRunning = on; airValid = true;
#endif

#if ENABLE_LEVEL_SWITCHES
  int lo = levelTriggered(PIN_LEVEL_LOW, LEVEL_LOW_TRIGGERED_WHEN_CLOSED) ? 1 : 0;
  int hi = levelTriggered(PIN_LEVEL_HIGH, LEVEL_HIGH_TRIGGERED_WHEN_CLOSED) ? 1 : 0;
  if (lo != lowRaw) { lowRaw = lo; lowSince = now; }
  if (hi != highRaw) { highRaw = hi; highSince = now; }
  if (now - lowSince >= LEVEL_DEBOUNCE_MS) lowStable = lowRaw == 1;
  if (now - highSince >= LEVEL_DEBOUNCE_MS) highStable = highRaw == 1;
  const char* lvl = lowStable ? "low" : (highStable ? "high" : "ok");
  if (strcmp(lvl, waterLevel) != 0) { changed = true; publishReason = "level-changed"; }
  waterLevel = lvl;
#endif

  if (changed && now - lastEventMs >= MIN_EVENT_GAP_MS) { publishNow = true; lastEventMs = now; }
}

void printReading(const Reading &r, const char* tag) {
  Serial.printf("[%s] T=", tag);
  if (r.tempValid) Serial.printf("%.2f C", r.temperatureC); else Serial.print("INVALID");
  Serial.print(" | pH=");
  if (r.phValid) Serial.printf("%.2f", r.ph); else Serial.print("INVALID");
  Serial.printf(" | RAW=%d | Vpin=%.3f V", r.phRaw, r.phVoltage);
#if ENABLE_FLOW_SENSOR
  Serial.printf(" | flow=%.1f L/min (%s)", flowLpm, pumpRunning ? "pump RUNNING" : "pump STOPPED");
#endif
#if ENABLE_AIRPUMP_CT
  Serial.printf(" | air=%.3f A (%s)", airAmps, airRunning ? "ON" : "OFF");
#endif
#if ENABLE_LEVEL_SWITCHES
  Serial.printf(" | level=%s (lowSw=%d highSw=%d)", waterLevel, lowRaw, highRaw);
#endif
  Serial.printf(" | WiFi=%s RSSI=%d | MQTT=%s | up=%lus\n",
    WiFi.status() == WL_CONNECTED ? "OK" : "--", WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0,
    mqtt.connected() ? "OK" : "--", (unsigned long)uptimeSec());
}

// ------------------------------------------------------------------ snapshots + offline buffer
Snap takeSnap(const char* tag) {
  Reading r = takeReading();
  printReading(r, tag);
  Snap s;
  s.ts = timeValid() ? (uint32_t)time(nullptr) : 0;
  s.t100 = r.tempValid ? (int16_t)lroundf(r.temperatureC * 100) : NIL;
  s.ph100 = r.phValid ? (int16_t)lroundf(r.ph * 100) : NIL;
  s.raw = (uint16_t)r.phRaw;
  s.mv = (uint16_t)lroundf(r.phVoltage * 1000);
  s.flow10 = NIL; s.airmA = NIL; s.pump = -1; s.air = -1; s.level = -1;
#if ENABLE_FLOW_SENSOR
  if (flowValid) { long f = lroundf(flowLpm * 10); s.flow10 = (int16_t)(f > 32000 ? 32000 : f); s.pump = pumpRunning ? 1 : 0; }
#endif
#if ENABLE_AIRPUMP_CT
  if (airValid) { long a = lroundf(airAmps * 1000); s.airmA = (int16_t)(a > 32000 ? 32000 : a); s.air = airRunning ? 1 : 0; }
#endif
#if ENABLE_LEVEL_SWITCHES
  s.level = strcmp(waterLevel, "low") == 0 ? 1 : (strcmp(waterLevel, "high") == 0 ? 2 : 0);
#endif
  return s;
}

void fmtFixed(char* out, size_t n, int16_t v, int dec) {
  if (v == NIL) { strcpy(out, "null"); return; }
  if (dec == 1) snprintf(out, n, "%.1f", v / 10.0);
  else if (dec == 2) snprintf(out, n, "%.2f", v / 100.0);
  else snprintf(out, n, "%.3f", v / 1000.0);
}

bool publishSnap(const Snap& s, const char* reason, bool backfill) {
  char t[12], p[12], tsPart[32] = "", extra[200] = "";
  fmtFixed(t, sizeof(t), s.t100, 2);
  fmtFixed(p, sizeof(p), s.ph100, 2);
  if (s.ts) snprintf(tsPart, sizeof(tsPart), ",\"ts\":%lu", (unsigned long)s.ts);
  size_t n = 0; (void)n;
#if ENABLE_FLOW_SENSOR
  { char f[12]; fmtFixed(f, sizeof(f), s.flow10, 1);
    n += snprintf(extra + n, sizeof(extra) - n, ",\"flowLpm\":%s,\"pumpRunning\":%s", f, s.pump < 0 ? "null" : (s.pump ? "true" : "false")); }
#endif
#if ENABLE_AIRPUMP_CT
  { char a[12]; fmtFixed(a, sizeof(a), s.airmA, 3);
    n += snprintf(extra + n, sizeof(extra) - n, ",\"airPumpCurrentA\":%s,\"airPumpRunning\":%s", a, s.air < 0 ? "null" : (s.air ? "true" : "false")); }
#endif
#if ENABLE_LEVEL_SWITCHES
  n += snprintf(extra + n, sizeof(extra) - n, ",\"waterLevel\":\"%s\"", s.level == 1 ? "low" : (s.level == 2 ? "high" : "ok"));
#endif
  char json[700];
  int len = snprintf(json, sizeof(json),
    "{\"deviceId\":\"%s\",\"siteId\":\"%s\",\"pondId\":\"%s\",\"pondName\":\"%s\",\"temperatureC\":%s,\"ph\":%s,\"phRaw\":%u,\"phVoltage\":%.3f,"
    "\"rssi\":%d,\"uptimeSec\":%lu,\"firmwareVersion\":\"%s\",\"event\":\"%s\"%s%s%s}",
    DEVICE_ID, SITE_ID, POND_ID, POND_NAME, t, p, (unsigned)s.raw, s.mv / 1000.0, WiFi.RSSI(), (unsigned long)uptimeSec(),
    FIRMWARE_VERSION, reason, tsPart, backfill ? ",\"backfill\":true" : "", extra);
  if (len <= 0 || len >= (int)sizeof(json)) { Serial.println("[MQTT] telemetry JSON too long"); return false; }
  return mqtt.publish(topicTelemetry, json);
}

void bufferSnap(const Snap& s) {
  if (!s.ts) { Serial.println("[BUFFER] clock not set yet - reading cannot be dated, not stored"); return; }
  int idx = (bufHead + bufCount) % BUF_MAX;
  if (bufCount == BUF_MAX) { bufHead = (bufHead + 1) % BUF_MAX; idx = (bufHead + bufCount - 1) % BUF_MAX; } // drop oldest
  else bufCount++;
  buf[idx] = s;
  Serial.printf("[BUFFER] stored offline reading (%d waiting, max %d = 6 h)\n", bufCount, BUF_MAX);
}

void flushBuffer() {
  if (!bufCount || !mqtt.connected() || millis() - lastFlushMs < FLUSH_GAP_MS) return;
  lastFlushMs = millis();
  if (publishSnap(buf[bufHead], "buffered", true)) {
    bufHead = (bufHead + 1) % BUF_MAX; bufCount--;
    if (!bufCount) Serial.println("[BUFFER] all offline readings uploaded");
  }
}

// ------------------------------------------------------------------ MQTT / Wi-Fi / time
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  Serial.printf("[CMD] %s : ", topic);
  for (unsigned int i = 0; i < length && i < 200; i++) Serial.print((char)payload[i]);
  Serial.println("  (ignored in firmware 2.0.x - no acknowledgement sent)");
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  if (lastMqttTryMs != 0 && millis() - lastMqttTryMs < MQTT_RETRY_MS) return;
  lastMqttTryMs = millis();
#if USE_TLS
  if (!timeValid()) { Serial.println("[TIME] waiting for internet time before the encrypted connection..."); return; }
#endif
  Serial.printf("[MQTT] connecting to %s:%u as %s ... ", MQTT_HOST, MQTT_PORT, MQTT_USER);
  if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS, topicStatus, 1, true, "offline")) {
    Serial.println("connected");
    mqtt.publish(topicStatus, "online", true);
    mqtt.subscribe(topicCommand, 1);
    publishNow = true; publishReason = "connected";
  } else {
    int st = mqtt.state();
    Serial.printf("failed (state %d)%s\n", st,
      st == 5 ? " - login refused: check MQTT_USER / MQTT_PASS / POND_ID" :
      st == -2 ? " - cannot reach server: check MQTT_HOST, port, internet" : "");
  }
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiLostSinceMs = 0;
    if (!timeRequested) { configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com"); timeRequested = true; }
    return;
  }
  if (wifiLostSinceMs == 0) wifiLostSinceMs = millis();
  if (lastWifiTryMs == 0 || millis() - lastWifiTryMs >= WIFI_RETRY_MS) {
    lastWifiTryMs = millis();
    Serial.printf("[WiFi] connecting to \"%s\" ...\n", WIFI_SSID);
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  if (millis() - wifiLostSinceMs > RESTART_IF_OFFLINE_MS && bufCount == 0) {
    // Only restart when nothing is waiting in the buffer (a restart would erase it).
    Serial.println("[WiFi] offline for 10 minutes - restarting to recover");
    delay(200);
    ESP.restart();
  }
}

// ------------------------------------------------------------------ setup / loop
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n==============================================");
  Serial.printf(" SMARTFUZE AQUA ESP32  fw %s  (%s)\n", FIRMWARE_VERSION, USE_TLS ? "cloud, encrypted" : "local");
  Serial.printf(" Site %s  Pond %s (%s)  Device %s\n", SITE_ID, POND_ID, POND_NAME, DEVICE_ID);
  Serial.printf(" Flow: %s | Level switches: %s | Air pump clamp: %s\n",
    ENABLE_FLOW_SENSOR ? "ON" : "off", ENABLE_LEVEL_SWITCHES ? "ON" : "off", ENABLE_AIRPUMP_CT ? "ON" : "off");
  Serial.println("==============================================");

  snprintf(topicTelemetry, sizeof(topicTelemetry), "aqua/site/%s/pond/%s/telemetry", SITE_ID, POND_ID);
  snprintf(topicStatus, sizeof(topicStatus), "aqua/site/%s/pond/%s/status", SITE_ID, POND_ID);
  snprintf(topicCommand, sizeof(topicCommand), "aqua/site/%s/pond/%s/command/#", SITE_ID, POND_ID);

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_PH, ADC_11db);
#if ENABLE_AIRPUMP_CT
  analogSetPinAttenuation(PIN_CT, ADC_11db);
#endif
#if ENABLE_FLOW_SENSOR
  pinMode(PIN_FLOW, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlowPulse, FALLING);
#endif
#if ENABLE_LEVEL_SWITCHES
  pinMode(PIN_LEVEL_LOW, INPUT_PULLUP);
  pinMode(PIN_LEVEL_HIGH, INPUT_PULLUP);
#endif
  lastFastMs = millis();

  tempSensors.begin();
  tempSensors.setResolution(12);
  tempSensors.setWaitForConversion(true);
  Serial.printf("[DS18B20] devices found: %d\n", tempSensors.getDeviceCount());

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(DEVICE_ID);

#if USE_TLS
  netClient.setCACert(ROOT_CA);
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(768);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(10);
  maintainWifi();
}

void loop() {
  maintainWifi();
  if (WiFi.status() == WL_CONNECTED) { connectMqtt(); mqtt.loop(); }
  updateFastSensors();

  unsigned long now = millis();
  if (publishNow && mqtt.connected()) {
    const char* reason = publishReason;
    publishNow = false; publishReason = "interval";
    lastTelemetryMs = now;
    Snap s = takeSnap("PUBLISH");
    if (!publishSnap(s, reason, false)) bufferSnap(s);
  } else if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    if (mqtt.connected()) {
      Snap s = takeSnap("PUBLISH");
      if (!publishSnap(s, "interval", false)) bufferSnap(s);
    } else {
      bufferSnap(takeSnap("OFFLINE"));
    }
  } else if (now - lastPreviewMs >= SERIAL_PREVIEW_MS) {
    lastPreviewMs = now;
    Reading r = takeReading();
    printReading(r, mqtt.connected() ? "preview" : "LOCAL ONLY - not connected");
  }
  flushBuffer();
  delay(10);
}
