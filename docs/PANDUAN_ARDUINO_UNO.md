# Panduan Menghubungkan Sensor Ketinggian Air ke Website UkurAir

Panduan ini menjelaskan cara menghubungkan sensor ketinggian air (seperti **HC-SR04** atau **JSN-SR04T Tahan Air**) ke mikrokontroler (**Arduino Uno** / **ESP32** / **ESP8266**) dan mengirimkan datanya secara *real-time* ke Firebase Realtime Database agar langsung tampil di web Anda.

---

## 1. Alur Kerja Sistem (Bagaimana Web Mendapat Data)

```text
[ Sensor Air (Ultrasonik) ]
         │
         ▼ (Mendeteksi jarak permukaan air dalam cm)
[ Mikrokontroler (ESP32 / Arduino + WiFi) ]
         │
         ▼ (Kirim data via Internet HTTP / REST API)
[ Firebase Realtime Database ]
         │
         ▼ (Realtime sync ke Browser)
[ Website UkurAir Anda ]
```

---

## 2. Pilihan Mikrokontroler yang Digunakan

> [!IMPORTANT]
> **Catatan Penting Arduino Uno:**
> Board **Arduino Uno standar TIDAK memiliki modul WiFi internal**. 
> - Jika memakai **Arduino Uno**, Anda memerlukan modul tambahan seperti **ESP8266 ESP-01**, **Ethernet Shield**, atau menghubungkan kabel USB ke laptop/PC dengan skrip perantara (Python/Node.js).
> - **Sangat Direkomendasikan:** Menggunakan **ESP32** atau **ESP8266 (NodeMCU)** karena harganya murah (~Rp 30.000 - Rp 60.000), sudah ada WiFi bawaan, dan kodenya jauh lebih ringkas.

---

## 3. Rangkaian Perkabelan (Wiring Sensor HC-SR04 / JSN-SR04T)

### A. Jika Menggunakan ESP32 (Paling Direkomendasikan)
| Kaki Sensor HC-SR04 | Pin ESP32 | Keterangan |
| :--- | :--- | :--- |
| **VCC** | **VIN / 5V** | Daya sensor (5 Volt) |
| **GND** | **GND** | Ground |
| **Trig** | **GPIO 5** | Pin pemicu pulsa ultrasonik |
| **Echo** | **GPIO 18** | Pin penerima pantulan pulsa |

---

### B. Jika Menggunakan Arduino Uno
| Kaki Sensor HC-SR04 | Pin Arduino Uno | Keterangan |
| :--- | :--- | :--- |
| **VCC** | **5V** | Daya 5 Volt |
| **GND** | **GND** | Ground |
| **Trig** | **Pin D9** | Pin Trigger |
| **Echo** | **Pin D10** | Pin Echo |

---

## 4. Logika Perhitungan Ketinggian Air

Sensor ultrasonik mengukur **jarak sensor ke permukaan air** ($D_{sensor}$). 
Untuk mendapatkan **ketinggian air aktual** ($H_{air}$):

$$\text{Ketinggian Air (cm)} = \text{Tinggi Wadah/Penyangga (cm)} - \text{Jarak Pantulan Sensor (cm)}$$

*Contoh:*
- Jarak sensor ke dasar wadah/sungai saat kosong = `100 cm`.
- Sensor membaca jarak pantulan air = `60 cm`.
- Maka ketinggian air saat ini = `100 - 60 = 40 cm`.

---

## 5. Contoh Kode Program Siap Pakai (ESP32 / ESP8266)

Gunakan **Arduino IDE** untuk memprogram board Anda:

```cpp
#include <WiFi.h>           // Gunakan <ESP8266WiFi.h> jika memakai NodeMCU
#include <HTTPClient.h>     // Gunakan <ESP8266HTTPClient.h> jika memakai NodeMCU
#include <time.h>           // Untuk waktu NTP (timestamp yang valid)

// 1. Konfigurasi WiFi Anda
const char* ssid = "NAMA_WIFI_ANDA";
const char* password = "PASSWORD_WIFI_ANDA";

// 2. Konfigurasi Firebase Project Anda
const String FIREBASE_HOST = "https://monitoring-ketinggian-air-1-default-rtdb.firebaseio.com";
const String DEVICE_ID = "ID_ALAT_ANDA"; // Salin ID alat dari tabel Admin / Firebase
const String API_KEY = "API_KEY_ALAT_ANDA"; // Salin dari Admin Panel > tabel alat > Salin

// 3. Pin Sensor Ultrasonik
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// 4. Pengaturan Wadah / Penyangga Sensor (dalam cm)
const float TINGGI_MAKSIMAL_WADAH = 100.0; // Tinggi sensor dari dasar wadah/sungai

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // Hubungkan ke WiFi
  Serial.print("Menghubungkan ke WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Terhubung!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Sinkronkan jam via NTP agar created_at valid
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Sinkronisasi waktu");
  time_t now = time(nullptr);
  while (now < 1700000000) { // tunggu sampai jam terisi
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println("\nWaktu tersinkron!");
}

// Epoch milidetik (UTC) untuk field created_at
long long epochMillis() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (long long)tv.tv_sec * 1000LL + tv.tv_usec / 1000;
}

float bacaJarakUltrasonik() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // Timeout 30ms (~5 meter)
  if (duration == 0) return -1; // Gagal baca

  // Kecepatan suara = 0.0343 cm/microdetik (dibagi 2 bolak-balik)
  float distance = (duration * 0.0343) / 2.0;
  return distance;
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    float jarak = bacaJarakUltrasonik();

    if (jarak >= 0) {
      // Hitung tinggi air:
      float tinggiAir = TINGGI_MAKSIMAL_WADAH - jarak;
      if (tinggiAir < 0) tinggiAir = 0;
      if (tinggiAir > 100) tinggiAir = 100;

      Serial.print("Jarak Sensor: ");
      Serial.print(jarak);
      Serial.print(" cm | Tinggi Air: ");
      Serial.print(tinggiAir);
      Serial.println(" cm");

      // Tentukan status Siaga
      String status = "AMAN";
      if (tinggiAir >= 75) status = "SIAGA 4";
      else if (tinggiAir >= 50) status = "SIAGA 3";
      else if (tinggiAir >= 25) status = "SIAGA 2";
      else if (tinggiAir >= 10) status = "SIAGA 1";

      // 1. Update data Realtime di /dashboard/{DEVICE_ID}
      HTTPClient http;
      String urlDashboard = FIREBASE_HOST + "/dashboard/" + DEVICE_ID + ".json";
      http.begin(urlDashboard);
      http.addHeader("Content-Type", "application/json");

      // Dapatkan IP lokal dan Physical MAC Address ESP32
      String ipAddress = WiFi.localIP().toString();
      String macAddress = WiFi.macAddress();

      String payloadDashboard = "{\"water_level\":" + String(tinggiAir, 1) + 
                                ",\"status\":\"" + status + "\"" +
                                ",\"api_key\":\"" + API_KEY + "\"" +
                                ",\"ip\":\"" + ipAddress + "\"" +
                                ",\"mac\":\"" + macAddress + "\"" +
                                ",\"created_at\":" + String(epochMillis()) + "}";

      int httpCode = http.PATCH(payloadDashboard);
      http.end();

      // 2. Catat ke Riwayat Pengukuran di /measurements/{DEVICE_ID}
      String urlHistory = FIREBASE_HOST + "/measurements/" + DEVICE_ID + ".json";
      http.begin(urlHistory);
      http.addHeader("Content-Type", "application/json");

      String payloadHistory = "{\"water_level\":" + String(tinggiAir, 1) + 
                              ",\"status\":\"" + status + "\"" +
                              ",\"api_key\":\"" + API_KEY + "\"" +
                              ",\"created_at\":" + String(epochMillis()) + "}";

      http.POST(payloadHistory);
      http.end();
    }
  }

  // Pilihan Interval Pengiriman Data Sensor:
  // - Mode Standar / Hemat Daya (10 Menit Sekali):
  //   delay(10 * 60 * 1000); // 600.000 ms (Web memberi toleransi hingga 15 menit)
  // - Mode Pengujian Cepat:
  //   delay(5000); // 5 detik
  delay(10 * 60 * 1000); 
}
```

---

## 6. Pengaturan API Key per Sensor

Setiap sensor/alat memiliki **API Key sendiri**. Key ini bukan untuk login web, melainkan identitas perangkat agar data yang masuk bisa diverifikasi berasal dari alat yang sah.

### A. Mengatur API Key di Web

1. Login sebagai admin, buka **Admin Panel**.
2. Pada tabel alat, kolom **API Key** menampilkan key dalam bentuk tersamar (contoh `AB••••9Z`).
3. Klik **Atur Key** untuk:
   - Melihat key lengkap (**LIHAT**),
   - Mengubah manual (huruf/angka, minimal 6 karakter),
   - Membuat key acak baru (**Acak**),
   - Menyalin key (**Salin Key**).
4. Klik **Simpan API Key**. Key tersimpan di Firebase pada path:

   ```text
   devices/<ID_ALAT>/secret_key
   ```

5. Tombol **Salin** pada tabel juga bisa dipakai untuk menyalin key tanpa membuka dialog.

> [!WARNING]
> Setelah key diubah, sketch ESP32 **wajib** diperbarui. Selama firmware masih memakai key lama, data akan ditolak (jika Security Rules sudah dipasang) atau dianggap tidak valid.

### B. Memakai API Key dan Telemetri Perangkat (IP & MAC) di Perangkat

Data dikirim bersama `api_key`, serta opsional `ip` dan `mac` (otomatis tampil di tabel Admin dan Detail):

```json
{
  "water_level": 42.5,
  "status": "SIAGA 2",
  "api_key": "API_KEY_ALAT_ANDA",
  "ip": "192.168.137.157",
  "mac": "4C:C3:82:EC:B9:E0",
  "created_at": 1700000000000
}
```

Di sketch, cukup isi satu variabel:

```cpp
const String API_KEY = "API_KEY_ALAT_ANDA";
```

lalu sisipkan `"api_key":"..."` pada payload seperti pada contoh kode di bagian 5.

> [!NOTE]
> **Nama field ketinggian air yang diterima web:** `water_level` (utama), `tinggi_air`, `ketinggian_air`, `level_air`, atau `level`. Jadi firmware yang sudah memakai `tinggi_air` tidak perlu diubah.
>
> **`created_at` opsional:** jika tidak dikirim, web memakai waktu push key Firebase. Namun untuk riwayat yang akurat (dan agar jam tetap benar setelah perangkat mati/nyala), tetap disarankan mengirim epoch milidetik dari NTP seperti contoh di bagian 5.
>
> Path penulisan yang dibaca web:
> - `PATCH /dashboard/<ID_ALAT>.json` → nilai terkini di peta/sidebar
> - `POST /measurements/<ID_ALAT>.json` → riwayat grafik dan tabel
>
> Field tambahan seperti `jarak_sensor` aman disimpan, tetapi belum ditampilkan di web.

### C. Membuat Key Benar-benar Menolak Perangkat Asing (Security Rules)

Secara default, API Key hanya **label identitas** — siapa pun yang tahu URL database masih bisa menulis. Agar key benar-benar divalidasi, pasang **Firebase Realtime Database Rules** berikut di Firebase Console → **Realtime Database → Rules**:

```json
{
  "rules": {
    "devices": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "dashboard": {
      ".read": true,
      "$deviceId": {
        ".write": "auth != null || newData.child('api_key').val() === root.child('devices').child($deviceId).child('secret_key').val()"
      }
    },
    "measurements": {
      "$deviceId": {
        ".read": true,
        "$entry": {
          ".write": "auth != null || newData.child('api_key').val() === root.child('devices').child($deviceId).child('secret_key').val()"
        }
      }
    }
  }
}
```

Cara kerja: setiap penulisan harus menyertakan `api_key` yang sama dengan `devices/<ID_ALAT>/secret_key`. Jika kosong atau berbeda, Firebase menolak dengan `Permission denied`.

> [!IMPORTANT]
> Konsekuensi aturan di atas:
> - Field `api_key` ikut tersimpan di data. Karena `/dashboard` dan `/measurements` dapat dibaca publik, key tersebut bisa terlihat oleh pengunjung yang membuka URL Firebase langsung.
> - Untuk keamanan tingkat produksi, gunakan **Firebase Authentication** (custom token per perangkat) atau **Cloud Function** sebagai perantara, sehingga key tidak perlu ditulis ke data.
> - Jika Anda belum siap dengan konsekuensi tersebut, cukup gunakan API Key sebagai penanda identitas alat (tanpa Rules), dan **jangan** menganggapnya sebagai proteksi penuh.

### D. Kapan Key Sebaiknya Diubah?

- Key pernah terlihat orang lain / tertulis di laporan.
- Perangkat dipindah atau dipegang pihak lain.
- Rutin setiap 3–6 bulan.

---

## 7. Alternatif Jika Memakai Arduino Uno (Menggunakan Komputer/Laptop via USB)

Jika Anda sudah terlanjur memiliki board **Arduino Uno**:
1. Pasang sensor ke Arduino Uno.
2. Program Arduino untuk membaca sensor dan mengirim angka ketinggian via Serial (`Serial.println(tinggiAir)`).
3. Buat skrip perantara kecil di laptop (menggunakan Python atau Node.js) yang membaca port COM Arduino dan meneruskannya ke Firebase Database web Anda.

---

## 8. Format Telemetri Lengkap (Catu Daya Aki 12V, Panel Surya, IP & MAC)

Web UkurAir sudah mendukung deteksi otomatis telemetri catu daya dan jaringan. Saat Anda mengembangkan sensor lebih lanjut (misal pembacaan tegangan aki via pin analog ADC dengan voltage divider), cukup sertakan field berikut dalam payload JSON HTTP POST/PATCH ke Firebase:

```json
{
  "api_key": "CAQK2451CLIPJZ97",
  "water_level": 41.8,
  "status": "Siaga 2",
  "ip": "192.168.1.45",
  "mac": "24:6F:28:AB:CD:EF",
  "battery_volt": 12.6,
  "battery_pct": 92,
  "solar_charging": true,
  "created_at": { ".sv": "timestamp" }
}
```

| Field JSON | Tipe Data | Deskripsi | Tampil di Web |
| :--- | :--- | :--- | :--- |
| `water_level` | Float / Number | Ketinggian air dalam cm | Grafik & Tabung |
| `status` | String | Status siaga (`Aman`, `Siaga 1`, `Siaga 2`, dst.) | Badge Status |
| `ip` | String | IP lokal ESP32 (`WiFi.localIP().toString()`) | Admin & Detail |
| `mac` | String | MAC address hardware (`WiFi.macAddress()`) | Admin & Detail |
| `battery_volt` | Float | Tegangan aki dalam Volt (mis. `12.6`) | Admin Panel |
| `battery_pct` | Integer | Persentase aki `0 - 100%` | Admin Panel |
| `solar_charging` | Boolean | `true` = Mengisi Daya, `false` = Mode Aki | Admin Panel |

---

## 9. Sistem Deteksi Sensor Terputus (Watchdog Heartbeat & Indikator 0 cm)

### A. Mengapa Data Sensor Sebelumnya Bisa Macet / "Stuck"?
Firebase Realtime Database bekerja dengan menyimpan snapshot nilai terakhir yang dikirim. Jika ESP32 tiba-tiba mati lampu, kehabisan baterai aki, atau terputus dari Wi-Fi, tidak ada instruksi penghapusan yang dikirim oleh ESP32. Akibatnya, nilai terakhir (misal `41.8 cm`) akan terus tersimpan dan terbaca oleh web seolah-olah sensor masih mengukur air setinggi itu.

### B. Solusi Watchdog Otomatis di Web UkurAir
Web UkurAir dilengkapi dengan sistem **Watchdog Heartbeat Cerdas**:
1. **Disesuaikan dengan Siklus Sensor 10 Menit:**
   - Jika sensor Anda mengukur setiap **10 menit sekali**, web memberikan jendela toleransi hingga **15 Menit** (10 menit siklus + 5 menit toleransi jaringan).
   - Selama 10 menit setelah pengiriman, nilai ketinggian air tetap terbaca aktif dan berstatus **🟢 Terhubung**.
2. **Kondisi Sensor Terputus (> 15 Menit):**
   - Jika setelah 15 menit sensor tidak kunjung mengirimkan data baru (karena ESP32 mati, kehabisan baterai aki, atau Wi-Fi putus):
     - Status koneksi otomatis berubah menjadi **🔴 Terputus** (badge merah menyala).
     - Indikator ketinggian air otomatis diset ke **`0 cm (OFF)`** (sistem dinonaktifkan).
     - Di kartu Titik Pantau dan Tabung Air, status berubah menjadi **`Terputus (OFF)`** dan volume tabung air turun ke dasar (0 cm).
     - Kotak Diagnostik AI memberikan notifikasi peringatan bahwa ESP32 offline.
3. **Kondisi Sensor Menyala Kembali:**
   - Begitu ESP32 mengirim paket data berikutnya, status seketika kembali menjadi **🟢 Terhubung** dan menampilkan ketinggian air riil.

### C. Pengaturan Interval Sensor di Admin Control Panel
Admin dapat menyesuaikan ambang batas toleransi watchdog melalui **Admin Control Panel** pada kartu **Interval Pengiriman Sensor & Toleransi Watchdog**:
- **10 Menit Sekali (Batas Toleransi: 15 Menit)** -> *Rekomendasi Default untuk sensor Anda*
- **5 Menit Sekali (Batas Toleransi: 8 Menit)**
- **15 Menit Sekali (Batas Toleransi: 20 Menit)**
- **30 Menit Sekali (Batas Toleransi: 40 Menit)**
- **1 Jam Sekali (Batas Toleransi: 90 Menit)**
- **1 Menit Sekali (Batas Toleransi: 2 Menit)**
- **Mode Uji Coba Cepat (Batas Toleransi: 30 Detik)**

### D. Tampilan Indikator di Panel Anggota & Panel Admin
- **🟢 Terhubung (Hijau)**: Sensor aktif mengirimkan telemetri dalam batas waktu toleransi yang ditentukan.
- **🔴 Terputus (Merah)**: Sensor offline / kehilangan daya / koneksi terputus (> batas toleransi), sistem OFF dan level air `0 cm`.
- Di **Admin Control Panel**, admin juga dapat menggunakan tombol simulasi **`⚡ Hubungkan`** dan **`🔌 Putus`** pada kolom Aksi untuk menguji respon tampilan sistem tanpa harus mematikan perangkat keras secara fisik.

