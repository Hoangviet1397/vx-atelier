# BUILD-GUIDE — Atelier VX iOS v1.0 → TestFlight

Gói này chỉ chuẩn bị local. Các bước dưới đây phải làm qua trình duyệt
(Apple Developer + GitHub), **không** làm trong gói này.

## 0. Hiện trạng (20/11/2026)

- Gói local `~/workspace/vx-atelier-ios-v1/` đã xong: test jsdom 96/96,
  `npx cap sync ios` chạy được trên Linux, workflow YAML hợp lệ.
- Chưa có: repo `vx-atelier`, App ID, app App Store Connect, provisioning profile,
  secret trên repo mới, lần build nào.
- Chứng chỉ Distribution + API key App Store Connect **dùng chung với FotoBro
  (đã có sẵn)** — không tạo cert mới, không tạo API key mới.

## 1. Tạo repo mới `Hoangviet1397/vx-atelier`

- Qua trình duyệt (tạo qua API từng bị 403 với repo FotoBro — tạo tay cho chắc):
  GitHub → New repository → tên `vx-atelier`, public, branch `main`,
  README ban đầu. **Đừng dùng repo `vx-mark4`** (đó là repo web, có cả
  `stable/` + `test/` + HANDOFF của Claude) và **đừng đụng repo `fotobro`**.
- Đẩy toàn bộ nội dung thư mục này lên `main` (trừ `node_modules/`, `ios/App/App/public/`
  sẽ được `cap sync` tạo lại trên CI — đẩy hay không đều được, `.gitignore` đã có
  `node_modules/`; `public/` cứ để CI tạo lại cho sạch).
- Kiểm tra sau khi đẩy: không có file `.p12/.p8/.key/.pem` nào trong repo
  (chạy `git ls-files | grep -iE '\.(p12|p8|key|pem)$'` phải ra rỗng).

## 2. Tạo App ID `com.vx.atelier`

- Apple Developer → Certificates, Identifiers & Profiles → Identifiers → App IDs → +.
- Bundle ID Explicit: `com.vx.atelier`, Description: `Atelier VX`.
- Capabilities: **không cần bật gì thêm** (Bluetooth LE không phải capability;
  không cần iCloud/CloudKit, Sign in with Apple, Push, IAP cho v1.0).

## 3. Tạo hồ sơ app trên App Store Connect

- App Store Connect → My Apps → + → New App:
  Name: `Atelier VX`, Bundle ID: `com.vx.atelier`, SKU gợi ý: `vx-atelier-001`,
  Primary Language: Vietnamese (app web song ngữ Việt/Anh), User Access: Full Access.
- Privacy Policy URL: `https://hoangviet1397.github.io/vx-atelier/PRIVACY.html`
- Support URL: `https://hoangviet1397.github.io/vx-atelier/SUPPORT.html`
  (phải là link web, không phải email — xem mục 6).
- App Privacy: khai **không thu thập dữ liệu** (khớp PRIVACY.html +
  `PrivacyInfo.xcprivacy` trong gói).

## 4. Tạo provisioning profile "Atelier VX App Store"

- Apple Developer → Profiles → + → App Store Connect → App ID `com.vx.atelier` →
  chọn certificate iOS Distribution đã có (cùng cert với FotoBro,
  hết hạn 20/11/2027) →
  Profile Name: **`Atelier VX App Store`** → Download (không cần giữ file,
  workflow tải profile qua API key).
- KHÔNG tạo certificate mới trừ khi cert cũ hết hạn/mất khóa riêng.

## 5. Dán 6 secret lên repo `vx-atelier`

Settings → Secrets and variables → Actions → New repository secret.
**Dùng lại đúng giá trị đã dán cho repo FotoBro** (chứng chỉ + API key chung):

| Secret | Giá trị lấy ở đâu |
|---|---|
| `IOS_DIST_CERT_P12_BASE64` | file .p12 của cert Distribution (base64) — như FotoBro |
| `IOS_DIST_CERT_P12_PASSWORD` | mật khẩu file .p12 — như FotoBro |
| `APP_STORE_CONNECT_API_ISSUER_ID` | Issuer ID của API key 'FotoBro CI' — như FotoBro |
| `APP_STORE_CONNECT_API_KEY_ID` | Key ID của API key 'FotoBro CI' — như FotoBro |
| `APP_STORE_CONNECT_API_KEY_BASE64` | file .p8 của API key 'FotoBro CI' (base64) — như FotoBro |
| `APPLE_TEAM_ID` | Team ID FotoBro — như FotoBro |

- Tuỳ chọn: `IOS_PROVISIONING_PROFILE_NAME` = `Atelier VX App Store`
  (workflow mặc định đúng tên này nếu không đặt secret).
- Tuyệt đối không dán giá trị secret vào file, chat hay commit.

## 6. Bật GitHub Pages cho PRIVACY.html / SUPPORT.html

- Repo `vx-atelier` → Settings → Pages → Source: Deploy from a branch →
  Branch `main`, folder `/ (root)` → Save.
- Kiểm tra: `https://hoangviet1397.github.io/vx-atelier/PRIVACY.html` và
  `.../SUPPORT.html` mở được, rồi mới điền 2 URL này vào App Store Connect (mục 3).
- Nếu Pages chưa kịp live, cứ chạy build TestFlight trước, bổ sung URL sau.

## 7. Chạy build → TestFlight

- Repo `vx-atelier` → Actions → "Build Atelier VX iOS" → Run workflow →
  `upload_testflight: true` → Run.
- Workflow: kiểm tra 6 secret → Xcode 26.3 → Node 22 → `npm ci` → test jsdom →
  `cap sync ios` → tăng build number → import cert → tải profile →
  archive → export .ipa → đẩy TestFlight.
- Lỗi thường gặp: thiếu secret (bước kiểm tra sẽ liệt kê tên); Xcode không phải
  26.x; trùng build number (không xảy ra vì dùng `run_number`).
- Sau khi upload xong, TestFlight cần Apple xử lý build vài phút → vào
  App Store Connect → TestFlight → thêm tester (chính Việt trước).

## 8. Kiểm tra trên iPhone thật (bắt buộc trước khi coi là xong)

1. Cài từ TestFlight, mở app: màn hình chính VX Lento hiện, nền tối, không trắng.
2. Bật Bluetooth, bấm **Tìm loa** → hộp chọn hiện loa VX (lọc theo service GAIA).
3. Nối loa → chỉnh Beosonic (góc/khoảng cách), đổi vị trí Free/Wall/Corner → loa đổi tiếng.
4. Tắt loa / đi xa rồi về: app tự reconnect (hoặc bấm nối lại được).
5. **Đo phòng**: cho phép mic khi iPhone hỏi → loa phát sweep, đi 4 điểm → có kết quả
   đáp ứng phòng, không crash, không kẹt.
6. Ghép 2 loa (nếu có cặp): Pair, đổi trái/phải.
7. Radio: mở 1 đài VOV / Radio Paradise → phát được tiếng qua loa (A2DP).
8. Xoay / 3D: loa 3D hiện, xoay được.
9. Tắt app mở lại: chế độ đã lưu còn (localStorage trong app).

Nếu bước 2–3 lỗi mà các bước khác đạt: cầu nối BLE có vấn đề — xem README.md
mục Bluetooth, ghi lại log trong app (tab Nhật ký) + tên lỗi hiện trên màn hình.
