# Simulasi agent maker ↔ approval — Halokantor Pricing

Dijalankan: 2026-09-18T12:58:41.875Z
Policy dipakai: {"minNetMargin":0.15,"minLineMargin":0,"maxBasketDiscount":0.35,"allowBelowCost":false,"approvalValueThreshold":50000000}

## A1 — PT Agrinesia 
```
[MAKER] PT Agrinesia — Kontrak ATK bulanan standar, S1 cost-plus normal.
  Skenario: S1 Full Margin
  Item: Kertas A4 80gsm x200, Pulpen gel biru x500, Stapler kecil x40
  Estimasi nilai bulanan: Rp 13.414.000, net margin 25.1%, diskon dari RRP 4.2%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A2 — PT Bahtera Adi Jaya 
```
[MAKER] PT Bahtera Adi Jaya — S2 cross-subsidy sehat: leader tipis, profit line menutup.
  Skenario: S2 Cross Subsidise
  Item: Printer laser mono x5, Toner compatible x60, Kertas foto x30
  Estimasi nilai bulanan: Rp 31.560.000, net margin 27.6%, diskon dari RRP 8.0%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A3 — CV Mitra Sejahtera 
```
[MAKER] CV Mitra Sejahtera — S3 diskon RRP moderat 10%, margin floor aman.
  Skenario: S3 RRP Discount
  Item: Tinta printer 4 warna x25, Amplop coklat besar x100
  Estimasi nilai bulanan: Rp 9.270.000, net margin 17.9%, diskon dari RRP 10.0%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A4 — Koperasi Karyawan Salvator 
```
[MAKER] Koperasi Karyawan Salvator — Order kecil, margin tinggi, jelas di bawah ambang persetujuan.
  Skenario: S1 Full Margin
  Item: Buku agenda x60, Spidol whiteboard x80
  Estimasi nilai bulanan: Rp 1.545.000, net margin 30.1%, diskon dari RRP 17.8%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A5 — PT Graha Utama Nusantara 
```
[MAKER] PT Graha Utama Nusantara — Volume besar tapi margin tetap nyaman di atas 15%.
  Skenario: S1 Full Margin
  Item: Kertas A4 80gsm x500, Kertas F4 80gsm x250
  Estimasi nilai bulanan: Rp 40.175.000, net margin 22.0%, diskon dari RRP 4.3%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A6 — PT Cipta Boga Makmur 
```
[MAKER] PT Cipta Boga Makmur — Beberapa item masih pakai COGS estimasi — hanya warning, tidak menghalangi approve.
  Skenario: S1 Full Margin
  Item: Map plastik x300, Binder clip no.5 x150
  Estimasi nilai bulanan: Rp 3.037.500, net margin 25.3%, diskon dari RRP 25.0%.

[APPROVAL] Keputusan: APPROVE.
  Catatan (tidak menghalangi):
    - [MISSING_COGS] 1 item masih memakai COGS estimasi, bukan angka dari inventory.
```

## A7 — PT Delta Logistik Prima 
```
[MAKER] PT Delta Logistik Prima — Multi-region dengan logistik diperhitungkan, margin masih sehat.
  Skenario: S1 Full Margin
  Item: Kertas A4 80gsm x400, Kertas A3 80gsm x100
  Estimasi nilai bulanan: Rp 30.960.000, net margin 23.9%, diskon dari RRP 1.4%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A8 — PT Wahana Edukasi 
```
[MAKER] PT Wahana Edukasi — Kontrak panjang 24 bulan, nilai bulanan tetap kecil jadi aman.
  Skenario: S1 Full Margin
  Item: Buku tulis 38 lembar x200
  Estimasi nilai bulanan: Rp 6.750.000, net margin 20.0%, diskon dari RRP 15.6%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A9 — PT Sentra Niaga Abadi 
```
[MAKER] PT Sentra Niaga Abadi — S2 dengan recovery kuat: leader disubsidi penuh, profit line menutupnya lebih dari cukup.
  Skenario: S2 Cross Subsidise
  Item: Mesin fotokopi entry x2, Toner drum kit x15
  Estimasi nilai bulanan: Rp 37.630.500, net margin 20.4%, diskon dari RRP 11.5%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## A10 — PT Nusa Perkasa 
```
[MAKER] PT Nusa Perkasa — S3 diskon tipis 6%, jauh dari batas 35%, margin floor tidak tersentuh.
  Skenario: S3 RRP Discount
  Item: Kalkulator basic x90, Gunting kantor x120
  Estimasi nilai bulanan: Rp 4.761.000, net margin 30.6%, diskon dari RRP 6.1%.

[APPROVAL] Keputusan: APPROVE.
  Tidak ada breach — semua metrik di dalam kebijakan.
```

## R1 — PT Karya Mandiri Sentosa 
```
[MAKER] PT Karya Mandiri Sentosa — Sales rep terlalu agresif menurunkan target margin ke 8% demi menang tender.
  Skenario: S1 Full Margin
  Item: Kertas A4 80gsm x300
  Estimasi nilai bulanan: Rp 13.395.000, net margin 8.1%, diskon dari RRP 18.8%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin 8,1% di bawah batas kebijakan 15,0%.
```

## R2 — PT Fajar Sentosa Abadi 
```
[MAKER] PT Fajar Sentosa Abadi — Satu item di-override manual di bawah landed cost demi cocok dengan budget klien.
  Skenario: S1 Full Margin
  Item: Printer inkjet x8, Tinta refill x40
  Estimasi nilai bulanan: Rp 9.792.000, net margin -25.7%, diskon dari RRP 40.3%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin -25,7% di bawah batas kebijakan 15,0%.
    - [BELOW_COST] 1 item dijual di bawah landed cost.
    - [BASKET_DISCOUNT] Diskon total 40,3% melewati batas 35,0% dari RRP.
```

## R3 — PT Cahaya Timur Raya 
```
[MAKER] PT Cahaya Timur Raya — S3 diskon dipaksa 45% off RRP demi menyaingi kompetitor.
  Skenario: S3 RRP Discount
  Item: Kertas A4 80gsm x500
  Estimasi nilai bulanan: Rp 20.950.000, net margin 2.1%, diskon dari RRP 30.2%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin 2,1% di bawah batas kebijakan 15,0%.
```

## R4 — PT Menara Global Industri 
```
[MAKER] PT Menara Global Industri — Order korporat sangat besar, margin sehat tapi nilai bulanan melewati ambang persetujuan.
  Skenario: S1 Full Margin
  Item: Kertas A4 80gsm x12000
  Estimasi nilai bulanan: Rp 657.000.000, net margin 25.0%, diskon dari RRP 8.8%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [VALUE_THRESHOLD] Nilai Rp 657.000.000 per bulan melewati ambang persetujuan Rp 50.000.000.
```

## R5 — PT Rimba Sejahtera 
```
[MAKER] PT Rimba Sejahtera — Margin rendah (10%) ditambah satu item dijual di bawah cost — dua breach sekaligus.
  Skenario: S1 Full Margin
  Item: Kertas A4 80gsm x200, Printer laser mono x4
  Estimasi nilai bulanan: Rp 15.120.000, net margin -5.7%, diskon dari RRP 19.6%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin -5,7% di bawah batas kebijakan 15,0%.
    - [BELOW_COST] 1 item dijual di bawah landed cost.
```

## R6 — PT Anugerah Bersama 
```
[MAKER] PT Anugerah Bersama — Deal besar sekaligus diskon dalam — basket discount dan value threshold jebol bareng.
  Skenario: S3 RRP Discount
  Item: Kertas A4 80gsm x15000
  Estimasi nilai bulanan: Rp 635.250.000, net margin 3.1%, diskon dari RRP 31.7%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin 3,1% di bawah batas kebijakan 15,0%.
    - [VALUE_THRESHOLD] Nilai Rp 635.250.000 per bulan melewati ambang persetujuan Rp 50.000.000.
```

## R7 — PT Sumber Rejeki Abadi 
```
[MAKER] PT Sumber Rejeki Abadi — S2 salah kalibrasi: leader margin negatif efektif, tidak tertutup profit line, net margin ambruk.
  Skenario: S2 Cross Subsidise
  Item: Mesin fotokopi entry x4, Toner drum kit x10
  Estimasi nilai bulanan: Rp 47.880.000, net margin 4.1%, diskon dari RRP 9.7%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin 4,1% di bawah batas kebijakan 15,0%.
```

## R8 — PT Bumi Cendekia 
```
[MAKER] PT Bumi Cendekia — Manual override di dua item sekaligus jatuh di bawah landed cost karena salah input harga nego.
  Skenario: S1 Full Margin
  Item: Laptop entry office x6, Mouse wireless x30
  Estimasi nilai bulanan: Rp 24.600.000, net margin -17.9%, diskon dari RRP 34.4%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin -17,9% di bawah batas kebijakan 15,0%.
    - [BELOW_COST] 2 item dijual di bawah landed cost.
```

## R9 — PT Kencana Wibawa 
```
[MAKER] PT Kencana Wibawa — Tender korporat borderline di atas ambang nilai bulanan meski margin standar.
  Skenario: S1 Full Margin
  Item: Printer laser mono x25, Toner compatible x400
  Estimasi nilai bulanan: Rp 168.480.000, net margin 25.0%, diskon dari RRP 12.7%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [VALUE_THRESHOLD] Nilai Rp 168.480.000 per bulan melewati ambang persetujuan Rp 50.000.000.
```

## R10 — PT Prima Global Trading 
```
[MAKER] PT Prima Global Trading — Perang harga habis-habisan: target margin ditekan sampai 3% biar 'pasti menang'.
  Skenario: S1 Full Margin
  Item: Kertas A4 80gsm x250, Pulpen gel biru x600
  Estimasi nilai bulanan: Rp 12.057.500, net margin 3.1%, diskon dari RRP 21.1%.

[APPROVAL] Keputusan: REJECT.
  Alasan tolak:
    - [NET_MARGIN] Net margin 3,1% di bawah batas kebijakan 15,0%.
```

## Ringkasan
- Total skenario: 20
- Approved: 10
- Rejected: 10
- Meleset dari desain awal: 0