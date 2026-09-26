# Pricing Engine Salvator

Mesin harga dan quotation B2B untuk **PT Salvator Inti Pratama**. Satu aplikasi
untuk menyusun penawaran kontrak ATK: menarik harga pokok dari data Accurate,
menghitung tiga skenario harga sekaligus, menahan penawaran yang melanggar
kebijakan margin sampai disetujui manajer, lalu mengeluarkan PDF dan Excel yang
siap dikirim.

---

## Apa yang dikerjakan aplikasi ini

**Tiga skenario harga, dihitung bersamaan untuk setiap item**

| Skenario | Aturan |
|---|---|
| **S1 Full Margin** | Cost-plus di semua item, dibatasi plafon harga klien (RRP). |
| **S2 Cross Subsidise** | Item *leader* (yang dibanding-bandingkan klien) dijual tipis, ditutup item *profit*. |
| **S3 RRP Discount** | Diskon rata dari RRP, ditahan oleh batas margin minimum. |

Rumus intinya:

```
landed cost = COGS x (1 + opex + logistik bila dinyalakan)
target price = landed cost / (1 - target margin)
```

Harga akhir tidak pernah melewati RRP. Harga manual boleh mengunci satu baris,
tetapi tetap dibatasi RRP dan tetap dihitung marginnya.

**Kepatuhan dan persetujuan.** Setiap quotation diuji terhadap kebijakan harga:
net margin minimum, margin minimum per item, batas diskon basket, larangan jual
di bawah modal, dan ambang nilai yang wajib disetujui. Pelanggaran memblokir
persetujuan otomatis dan melempar penawaran ke antrean manajer. Penolakan wajib
disertai alasan. Setiap perubahan status tercatat di jejak audit.

**Data nyata, bukan angka contoh.** Harga pokok diimpor dari laporan *Nilai
Persediaan* Accurate (COGS per unit = nilai barang masuk ÷ kuantitas barang
masuk), harga jual acuan dari *Daftar Barang dan Jasa*. Daftar permintaan klien
bisa diimpor dari Excel atau CSV apa adanya, termasuk yang plafonnya ditulis
per kota.

---

## Menjalankan di komputer sendiri

Butuh **Node.js 22.5 atau lebih baru** (memakai SQLite bawaan Node, tidak ada
kompilasi modul native).

```bash
npm install
cp .env.example .env
#   isi JWT_SECRET:  openssl rand -hex 32
#   isi ANTHROPIC_API_KEY bila ingin asisten AI aktif
npm run dev
```

- Aplikasi: <http://localhost:5173>
- API: <http://localhost:8787/api>

Saat pertama kali dijalankan, satu akun administrator dibuat dan kata sandinya
**dicetak sekali di terminal**. Simpan saat itu juga. Set `ADMIN_EMAIL` dan
`ADMIN_PASSWORD` di `.env` kalau ingin menentukannya sendiri.

## Menjalankan untuk produksi

```bash
npm run build
NODE_ENV=production npm start        # satu proses, satu port
```

Satu proses Node menyajikan API sekaligus aplikasi webnya.

### Docker

```bash
docker build -t pricing-engine-salvator .
docker run -d -p 8787:8787 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v halokantor-data:/app/data \
  pricing-engine-salvator
```

Basis data SQLite ada di `/app/data`. **Volume itu wajib dipasang**, kalau tidak
seluruh quotation hilang saat kontainer dibuat ulang.

---

## Peran pengguna

| Peran | Bisa melakukan |
|---|---|
| **Sales** (`rep`) | Membuat, mengubah, dan mengajukan quotation miliknya sendiri. |
| **Manajer** (`manager`) | Semua di atas untuk quotation siapa pun, plus menyetujui atau menolak, dan mengimpor katalog. |
| **Admin** (`admin`) | Semua di atas, plus mengatur kebijakan harga, identitas perusahaan, dan pengguna. |

Manajer yang mengajukan penawaran yang tidak melanggar apa pun akan disetujui
otomatis atas namanya sendiri; selain itu, semua penawaran masuk antrean.

## Alur status quotation

```
draft ──ajukan──▶ submitted ──setujui──▶ approved ──kirim──▶ sent ──▶ won / lost
  ▲                    │                                                  │
  └──── buka revisi ───┴──────── tolak ───▶ rejected ─────────────────────┘
```

Quotation yang sudah diajukan atau disetujui **terkunci**. Untuk mengubahnya,
buka revisi baru: versi lama tetap utuh di riwayat dan nomor revisi bertambah.

---

## Susunan kode

```
shared/     Engine harga, kebijakan, tipe, format. Dipakai server dan browser
            supaya keduanya menghitung angka yang persis sama.
  engine.ts       Perhitungan harga (murni, tanpa dependensi)
  policy.ts       Evaluasi kebijakan menjadi daftar pelanggaran
  engine.test.ts  27 pengujian yang mengunci perilaku engine

server/     API Express + SQLite bawaan Node
  db.ts           Skema dan migrasi
  auth.ts         bcrypt, JWT di cookie httpOnly, gerbang peran
  quoteService.ts Penomoran, snapshot, mesin status
  routes/         auth, clients, catalog, quotes, approvals, assistant, settings

src/        Aplikasi React
  pages/          Dashboard, QuoteEditor, Approvals, Catalog, Clients, Settings
  components/     Tabel item, dokumen penawaran, asisten, komponen harga
  import/         Pembaca berkas Excel/CSV (dijalankan di browser)
  export/         PDF (jsPDF) dan Excel (SheetJS)
```

Berkas Excel dibaca **di browser**; yang dikirim ke server hanya baris hasilnya,
jadi server tidak pernah menerima berkas biner dari pengguna.

## Pengujian

```bash
npm test          # 36 pengujian
npm run typecheck # klien dan server
```

Pengujian importer berjalan terhadap berkas Accurate asli bila ada di folder
`~/Downloads`, dan dilewati otomatis bila tidak.

---

## Asisten AI

Asisten hanya menjawab dari angka quotation yang sedang dibuka: rincian item,
asumsi, logistik, dan pelanggaran kebijakan. Ia boleh **mengusulkan** perubahan
(misalnya menaikkan margin leader), tetapi usulan itu ditampilkan dulu sebagai
daftar dan baru diterapkan setelah pengguna menekan **Terapkan**. Engine tetap
satu-satunya penentu harga.

Kunci API disimpan di server dan tidak pernah dikirim ke browser. Tanpa
`ANTHROPIC_API_KEY`, seluruh aplikasi tetap berjalan normal dan panel asisten
menampilkan keterangan bahwa fiturnya belum aktif.

Model diatur lewat `ANTHROPIC_MODEL` (bawaan: `claude-opus-5`).

## Catatan keamanan

- Kata sandi di-hash dengan bcrypt (12 putaran); sesi berupa JWT di cookie
  `httpOnly`, `sameSite=lax`, dan `secure` saat produksi.
- Semua badan permintaan divalidasi dengan Zod sebelum menyentuh basis data.
- Semua kueri memakai pernyataan berparameter.
- Header keamanan dipasang Helmet, termasuk CSP saat produksi.
- Percobaan masuk dibatasi 20 kali per 15 menit per alamat IP.
- `JWT_SECRET` wajib diisi di produksi; aplikasi menolak berjalan tanpanya.
