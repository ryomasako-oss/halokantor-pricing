# Halokantor Pricing Agent

Service terpisah dari aplikasi utama `pricing.salvator.co.id`. Bertugas membaca data kutipan dari API halokantor (read-only), menyimpannya di knowledge store SQLite lokal, mendeteksi industri dari item mix, dan merekomendasikan penawaran mirip berdasarkan pola historis.

## Kenapa terpisah?

Agent ini **bukan** bagian dari app utama. Alasannya:
- **LLM provider berbeda**: app utama pakai Anthropic (Claude), agent pakai Gemini (lebih murah untuk workload analitik).
- **Tidak ada sisi write**: agent hanya baca data dari API, tidak modify database utama.
- **Lifecycle berbeda**: agent bisa dijadwalkan (sync periodik, rekomendasi harian) tanpa mempengaruhi uptime app utama.

## Fitur

### 1. Knowledge Store
SQLite lokal yang menyimpan:
- **captured_quotes** — kutipan dari API (status, scenario, items, assumptions)
- **captured_clients** — klien
- **captured_catalog** — katalog item dengan COGS
- **industry_profiles** — hasil deteksi industri per kutipan
- **recommendations** — rekomendasi yang sudah digenerate

### 2. Industry Detection
Deteksi industri berdasarkan item mix dalam kutipan, bukan field formal (yang tidak ada di DB). Pakai keyword matching pada nama item dan kode:

| Tag | Contoh Item |
|-----|-------------|
| Percetakan & Fotokopi | Mesin fotokopi, printer, toner, kertas foto |
| ATK Umum | Kertas A4, pulpen, stapler, amplop, binder |
| Elektronik Kantor | Laptop, monitor, kalkulator |
| Facility & Cleaning | Karpet, AC, cleaning agent, papan nama |
| F&B / Catering | Mie, kopi, air mineral, peralatan makan |
| Konstruksi & Bangunan | Semen, cat, pipa, asbes |
| Logistik & Gudang | Box, pallet, bubblewrap, label |
| Otomotif | Oli, aki, ban, velg |

### 3. Recommendation Engine
Cari kutipan "mirip" berdasarkan:
- **Industri sama** — overlap tag ≥ 1 tag dominan
- **Status won/approved** — kontrak berhasil
- **Scenario cocok** — preferensi scenario sama atau kompatibel
- **Margin sehat** — di kisaran 15-35%

Output: clientName, similarQuote, reasons, similarScenario, similarMargin, confidence.

### 4. Gemini Integration
LLM untuk task yang butuh NLP (mis. generate narasi rekomendasi, analisis qualitative). Pakai `gemini-2.0-flash` (cepat, murah). App utama tertinggal di Anthropic.

### 5. Gmail Trigger (opsional)
Kirim notifikasi email via Gmail API dengan service account Google Workspace + JWT Bearer flow.

## Instalasi

```bash
cd agent-service
npm install
cp .env.example .env
# Isi .env dengan nilai yang sesuai
```

## Environment Variables

| Variabel | Wajib? | Keterangan |
|----------|--------|------------|
| `HALOKANTOR_API_BASE` | Tidak | Base URL API (default: https://pricing.salvator.co.id) |
| `HALOKANTOR_API_KEY` | **Ya** untuk sync | API key read-only |
| `GEMINI_API_KEY` | Tidak | Gemini API key |
| `AGENT_DB_PATH` | Tidak | Path SQLite (default: ./data/agent-knowledge.db) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Tidak | Service account email untuk Gmail |
| `GOOGLE_PRIVATE_KEY` | Tidak | Private key PEM |
| `GOOGLE_SEND_AS_EMAIL` | Tidak | Email yang diimpersonasi |
| `AGENT_PORT` | Tidak | Port HTTP server (default: 8888) |

## Penggunaan

### Jalankan server

```bash
npm start
# atau
npx tsx src/index.ts
```

Server listen di `http://localhost:8888` (atau `$AGENT_PORT`).

### CLI commands

```bash
# Sync data dari halokantor API
npm run sync

# Deteksi industri untuk klien
npm run detect-industry "PT Agrinesia"

# Generate rekomendasi
npm run recommend "PT Agrinesia"
```

### HTTP API

| Method | Path | Keterangan |
|--------|------|------------|
| GET | /health | Health check |
| GET | /status | Status agent (Gemini, Gmail, knowledge store counts) |
| POST | /sync | Jalankan full sync dari halokantor API |
| GET | /quotes/similar?client=NamaKlien&scenario=S&limit=N | Cari kutipan mirip |
| POST | /recommend | Generate rekomendasi (body: { client, industryTags?, preferredScenario? }) |
| GET | /industries/:clientId | Deteksi industri untuk klien |
| POST | /webhook/gmail | Webhook incoming Gmail push notification |

## Struktur

```
agent-service/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── src/
    ├── index.ts        # HTTP server
    ├── cli.ts          # CLI entry point
    ├── types.ts        # Tipe data
    ├── knowledge-store.ts  # SQLite knowledge store
    ├── sync.ts         # Sync dari halokantor API
    ├── industry.ts     # Industry detection
    ├── recommend.ts    # Recommendation engine
    ├── gemini.ts       # Gemini LLM client
    ├── gmail.ts        # Gmail auth helpers
    └── email.ts        # Gmail client (Kirim email)
```

## Alur Kerja

1. **Sync** — `POST /sync` atau `npm run sync` → fetch klien, katalog, kutipan dari halokantor API → simpan di knowledge store
2. **Deteksi industri** — setiap kutipan yang di-capture otomatis punya industry profile (bisa di-trigger setelah sync)
3. **Rekomendasi** — `POST /recommend` atau `npm run recommend` → cari kutipan mirip berdasarkan industri + scenario → generate alasan dan confidence

## Roadmap

- [ ] WhatsApp trigger (Twilio) — tertunda
- [ ] Scheduler periodik (sync otomatis setiap N jam)
- [ ] Gemini-powered recommendation narrative (bandingkan manual vs LLM-generated)
- [ ] Dashboard sederhana (web UI) untuk melihat rekomendasi

## Catatan Teknis

- Pakai `node:sqlite` (built-in Node 22+) sebagai pengganti `better-sqlite3` yang butuh compile native
- Pakai `googleapis` untuk Gmail API (optional)
- Gemini client pakai fetch langsung, tidak pakai SDK (lebih ringan)
- Semua route stateless — knowledge store adalah state agent
