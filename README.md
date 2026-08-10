# Monitoring Ping Dashboard

Dashboard pemantauan Access Point (Cisco & Unifi) berbasis Next.js. Setiap AP dipantau secara berkala via ping, hasilnya disimpan sebagai histori di SQLite, dan ditampilkan secara real-time dalam dashboard yang dikelompokkan per controller/WLC.

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Tech Stack](#tech-stack)
- [Struktur Project](#struktur-project)
- [Instalasi](#instalasi)
- [Menjalankan Aplikasi](#menjalankan-aplikasi)
- [Import Data AP via CSV](#import-data-ap-via-csv)
- [Cara Kerja Monitoring](#cara-kerja-monitoring)
- [Riwayat & Pencarian Log](#riwayat--pencarian-log)
- [Catatan Teknis](#catatan-teknis)

## Fitur Utama

- **Monitoring real-time** — setiap AP di-ping secara berkala oleh worker terpisah dari server dashboard.
- **Pengelompokan per controller (WLC)** — daftar AP dikelompokkan dan bisa di-expand/collapse per controller, lengkap dengan ringkasan jumlah AP online, offline, dan disabled di setiap grup.
- **Ringkasan status** — kartu statistik di bagian atas menampilkan total AP, jumlah online, offline, unknown, dan disabled.
- **Riwayat ping (History)** — pencarian log berdasarkan rentang tanggal, controller, nama AP, alamat IP, dan status (All/Online/Offline), dengan paginasi dan lompat ke halaman tertentu.
- **Manajemen AP dari UI** — tambah, edit, aktifkan/nonaktifkan, dan hapus AP langsung dari dashboard.
- **Import CSV** — impor massal daftar AP dari file CSV.
- **Kontrol monitoring** — pause/resume worker, jalankan pengecekan manual (Run now), dan hapus seluruh data (Delete all).

## Tech Stack

- **Framework:** Next.js (App Router) + React
- **Bahasa:** TypeScript
- **Database:** SQLite (better-sqlite3 atau setara)
- **Styling:** CSS custom (tema dark, tanpa framework UI eksternal)

## Instalasi

```bash
npm install
```

## Menjalankan Aplikasi

```bash
npm run dev
```

Dashboard akan berjalan di `http://localhost:3000` (sesuaikan port bila dikonfigurasi berbeda). Worker monitoring perlu dijalankan agar data ping benar-benar masuk — cek skrip yang tersedia di `package.json` (mis. `npm run worker`) untuk menjalankannya secara terpisah, sesuai kebutuhan environment produksi.

## Import Data AP via CSV

1. Siapkan file CSV dengan kolom: `controller`, `nama ap`, `model ap`, `mac`, `ipaddress`.
2. Pemisah kolom bisa berupa koma (`,`) atau titik koma (`;`).
3. Di dashboard, buka bagian **Import CSV**, pilih file, lalu import.
4. Baris dengan `mac` atau `ipaddress` yang sudah ada akan diperbarui (update), bukan diduplikasi.
5. Contoh template tersedia di `samples/ap-import-template.csv`.

## Cara Kerja Monitoring

- Worker menjalankan siklus ping ke seluruh AP yang berstatus **enabled** secara berkala (interval default: setiap 5 detik).
- AP yang **disabled** dilewati sepenuhnya — tidak di-ping dan status terakhirnya tidak diperbarui.
- Dashboard menarik data terbaru dari server setiap beberapa detik agar status di layar selalu segar (real-time).
- Penulisan histori ke database dibedakan berdasarkan status untuk menjaga ukuran database tetap wajar:
  - **AP online** — log baru dicatat maksimal setiap 5 menit.
  - **AP offline** — log dicatat di setiap siklus ping (± 5 detik), agar durasi dan pola downtime tercatat detail.

## Riwayat & Pencarian Log

Bagian **History** di dashboard bersifat *search-first* — tabel riwayat baru menampilkan data setelah pengguna melakukan pencarian atau memilih filter status, agar tampilan tetap ringkas secara default. Filter yang tersedia:

- Rentang tanggal (dari–sampai)
- Controller
- Nama AP
- Alamat IP
- Status (All / Online / Offline)

Hasil pencarian ditampilkan dengan paginasi (20 baris per halaman) beserta navigasi Prev/Next dan lompat langsung ke nomor halaman tertentu.

## Catatan Teknis

- Database tersimpan di `data/monitoring.db` (SQLite).
- Seluruh timestamp ditampilkan dalam zona waktu `Asia/Jakarta`.
- Tombol **Pause/Resume** menghentikan atau melanjutkan siklus ping tanpa menghapus data yang sudah ada.
- Tombol **Run now** memicu satu siklus pengecekan manual di luar jadwal otomatis.
- Tombol **Delete all** menghapus seluruh data AP dan histori log secara permanen — gunakan dengan hati-hati.
