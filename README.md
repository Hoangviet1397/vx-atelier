# Atelier VX — app iOS (Capacitor 8)

App iOS điều khiển loa **V&X mark 4** (Beosonic wheel, vị trí đặt loa, đo phòng, radio).
Bản web gốc: repo public [Hoangviet1397/vx-mark4](https://github.com/Hoangviet1397/vx-mark4),
branch `main`, commit `ee17df1` (16/11/2026; code mới nhất 14/11 `d3343a13`).
Web app là **VX Lento, phong cách Atelier** — file `www/index.html` 240.411 bytes được
copy nguyên, không sửa.

- **Tên app:** Atelier VX
- **Bundle ID:** `com.vx.atelier`
- **Version:** 1.0.0, build 1 (build number tự tăng bằng `run_number` mỗi lần chạy workflow)
- **Repo đích (CHƯA tạo):** `Hoangviet1397/vx-atelier` — xem [BUILD-GUIDE.md](BUILD-GUIDE.md)
- **Trạng thái:** gói local đã chuẩn bị xong, test jsdom **96/96 đạt**,
  `npx cap sync ios` chạy được trên Linux. **Chưa build .ipa, chưa lên TestFlight,
  chưa test Bluetooth trên iPhone thật.**

## Cấu trúc

```
vx-atelier-ios-v1/
  www/                  web app vx-mark4 root: index.html, vx3d.js, native-ble.js,
                        bt.html, lib/hls.min.js, img/, sounds/ (24 file wav)
                        — KHÔNG lấy stable/ (app cũ) và test/ (mirror test web)
  package.json          Capacitor 8 + @capacitor-community/bluetooth-le ^8.4.0
  capacitor.config.ts   appId com.vx.atelier, nền tối #0B0B0C
  test-vx-atelier-v1.js test jsdom (96 kiểm tra) — chạy: node test-vx-atelier-v1.js
  ios/                  project Xcode (Capacitor 8): App, CapApp-SPM, debug.xcconfig
    App/App/Info.plist         Bluetooth + mic, không camera/lịch/Face ID
    App/App/PrivacyInfo.xcprivacy  không tracking, không thu thập dữ liệu
    App/CapApp-SPM/Package.swift   App + SplashScreen + StatusBar + BluetoothLe
    App/App/App.xcodeproj      Manual signing, iPhone Distribution (Release),
                               profile "Atelier VX App Store", MARKETING_VERSION 1.0.0
  .github/workflows/ios-build.yml  macos-15, Xcode 26.3, Node 22, build + TestFlight
  AppIcon-1024.png      icon chữ VX serif trên nền tối (không dùng ảnh loa)
  PRIVACY.html / SUPPORT.html   trang web cho App Store Connect (Privacy/Support URL)
  README.md / BUILD-GUIDE.md
```

## Bluetooth — cầu nối native-ble.js (đã kiểm chứng API, chưa test trên loa thật)

iOS WKWebView **không có Web Bluetooth**, nên app native không dùng
`navigator.bluetooth` của trình duyệt. File `www/native-ble.js` (đã có sẵn trong
vx-mark4, ghi chú *"Not run on a phone yet"*) thay `navigator.bluetooth` bằng
plugin `@capacitor-community/bluetooth-le` khi chạy trong app Capacitor.

Đã kiểm chứng ngày 20/11/2026 với **@capacitor-community/bluetooth-le 8.4.0**
(tải tarball từ npm, đọc `dist/esm/definitions.d.ts`, `bleClient.js` và
`ios/Sources/BluetoothLe/Plugin.swift`): mọi hàm `native-ble.js` dùng đều khớp
API raw plugin 8.x — `initialize`, `requestDevice`, `getDevices`, `connect`
(`{deviceId, timeout}`), `disconnect`, `write` (giá trị **hex string** trên
native, đúng như code đang gửi), `startNotifications`, `addListener` với key
`notification|<device>|<service>|<char>` và `disconnected|<deviceId>`.
UUID GAIA của loa là 128-bit đầy đủ (`00001100-d102-11e1-9b23-00025b00a5a5`),
nên không vướng chuyển đổi UUID ngắn. **Không cần sửa `native-ble.js`.**

Khác biệt nhỏ đã biết (không chặn build, ghi để test trên loa thật):
- `native-ble.js` chỉ dùng `filters[0]` của `VX_CHOOSER` (2 filter: tên `VX` và
  `V&X`), nên hộp chọn native chỉ lọc theo service GAIA, không lọc theo tên.
  Trang web vẫn tự kiểm tra có phải loa VX không sau khi nối.
- `addListener` trả về handle nhưng code không bao giờ gỡ listener (rò rỉ nhỏ).
- USB HID (`navigator.hid`, cáp QCC3034) **không có trong app iOS** — chỉ dùng Bluetooth.
- Trong app native, hướng dẫn cũ "iPhone: mở bằng Bluefy" không còn đúng nữa;
  app native nối thẳng qua plugin. (Chữ Bluefy vẫn còn trong `www/index.html`
  vì file web copy nguyên — không sửa web trong gói này.)

## URL ngoài (app cần mạng cho các mục này, còn lại chạy offline từ file local)

| Dùng cho | URL / host | Ghi chú |
|---|---|---|
| Font Cormorant Garamond | `fonts.googleapis.com`, `fonts.gstatic.com` | Cần mạng lần đầu; không có mạng thì dùng serif hệ thống |
| Radio | `audio-lss.vov.vn`, `play.vovgiaothong.vn`, `stream.radioparadise.com`, `icecast.radiofrance.fr`, `kexp.streamguys1.com`, `ha-noi-community-radio.radiocult.fm`, `rfienvietnamien64k.ice.infomaniak.ch` | Stream trực tiếp từ đài; iOS phát HLS native |
| Tìm đài | `de1.api.radio-browser.info` | API tìm đài theo tên |
| Fallback hls.js | `cdnjs.cloudflare.com` | Chỉ dùng khi `lib/hls.min.js` local lỗi |

## Kiểm chứng local (máy Linux, 20/11/2026)

- `npm install` — OK, 104 packages; `@capacitor-community/bluetooth-le` **8.4.0**.
- `npx cap sync ios` — **chạy được trên Linux**, exit 0: copy `www` → `ios/App/App/public`,
  nhận đủ 4 plugin (bluetooth-le, app, splash-screen, status-bar), viết lại
  `Package.swift` + `capacitor.config.json` đúng.
- `node test-vx-atelier-v1.js` — **96 PASS, 0 FAIL** (lần đầu 94/96, 2 FAIL là lỗi
  của chính test — đã sửa test, chạy lại xanh). Test stub `matchMedia` /
  `ResizeObserver` vì jsdom không có (trình duyệt thật có); eval tay
  `native-ble.js` + `vx3d.js` vì jsdom không tải script ngoài.
- Icon: `AppIcon-1024.png` 1024×1024 RGB không alpha (kiểm bằng `file` + đọc header PNG).
  Ảnh `img/speaker-front.png` (364×568, ảnh sản phẩm) **không** dùng làm icon — icon vẽ
  chữ VX serif (Noto Serif Display, thay cho Cormorant Garamond) trên nền tối + viền đồng.
- Workflow YAML hợp lệ (16 bước), không chứa secret thật; chỉ có tên 6 secret.

## Chưa kiểm được — cần Mac / iPhone thật

- **Build .ipa trên GitHub Actions** (Xcode 26.3, signing Manual) — workflow chưa từng chạy.
- **Bluetooth với loa V&X mark 4 thật**: nối, tự reconnect, Beosonic, đo phòng 4 điểm,
  ghép 2 loa. Đây là rủi ro lớn nhất của cả gói.
- Mic đo phòng (quyền `NSMicrophoneUsageDescription`), WebGL 3D (`vx3d.js` + `lento.bin`),
  radio HLS trên iPhone thật.
- App Store review: app điều khiển loa qua Bluetooth LE, cần giải thích quyền
  Bluetooth trong App Store Connect.

## Rủi ro

1. **BLE chưa từng test trên iPhone thật** — nếu cầu nối lỗi, app mở được, nghe
   radio / xem 3D được, nhưng không nối được loa. TestFlight chính là để test việc này.
2. `native-ble.js` viết cho plugin 7.x (ghi trong comment) nhưng API đã kiểm chứng
   khớp 8.4.0 — nếu plugin lên 9.x thì kiểm tra lại trước khi nâng.
3. Web app đang ở commit 14/11; nếu vx-mark4 có commit mới (đo phòng / reconnect),
   copy lại `www/` từ root và chạy lại test + `cap sync`.
4. Từ 28/04/2026 App Store Connect từ chối app build bằng Xcode dưới 26 —
   workflow đã ép Xcode 26.3, đừng đổi.
