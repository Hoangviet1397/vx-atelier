/* Test Atelier VX iOS v1.0 — chạy bằng jsdom, không cần trình duyệt hay iPhone.
   Từ repo root: npm install --no-save jsdom && node test-vx-atelier-v1.js
   (trên CI workflow làm đúng 2 bước này rồi mới `npx cap sync ios`).
   Lưu ý jsdom:
   - jsdom KHÔNG có matchMedia / ResizeObserver / WebGL / Web Bluetooth
     (trình duyệt thật và WKWebView đều có, trừ Web Bluetooth — xem README).
     Test stub 2 cái đầu để app khởi động được như trên trình duyệt thật.
   - jsdom mặc định KHÔNG tải script src ngoài, nên native-ble.js và vx3d.js
     được eval tay từ file để kiểm tra chúng định nghĩa đúng API.
   - App web đặt interval (poll loa) nên Node không tự thoát: cuối file
     gọi process.exit() rõ ràng với mã 0 (xanh) / 1 (có FAIL). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const exists = p => fs.existsSync(path.join(ROOT, p));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

let pass = 0, fail = 0;
const fails = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; fails.push(name); console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 200) : '')); }
}
function eq(name, got, want) { t(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

const html = read('www/index.html');
const bleJs = read('www/native-ble.js');
const vx3dJs = read('www/vx3d.js');

(async () => {
  console.log('[1] Trang web tải được trong jsdom (stub matchMedia/ResizeObserver như trình duyệt thật)');
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(String((e && e.message) || e)));
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = w.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.ResizeObserver = w.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    },
  });
  await new Promise(r => dom.window.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 300));
  const { win, doc } = { win: dom.window, doc: dom.window.document };
  t('trang tải không lỗi jsdom', errors.length === 0, errors.slice(0, 3).join(' | '));
  eq('title là VX Lento', doc.title, 'VX Lento');
  t('có nút Tìm loa', !!doc.getElementById('findBtn'));
  t('có nút xem tất cả loa', !!doc.getElementById('btAllBtn'));
  t('có nút nối USB', !!doc.getElementById('usbBtn'));
  t('đủ nhiều phần tử có id (>20)', doc.querySelectorAll('[id]').length > 20, doc.querySelectorAll('[id]').length);
  t('chữ Atelier VX có trong trang', html.includes('Atelier VX'));
  // Script ngoài không tự chạy trong jsdom: eval tay để kiểm tra API.
  win.eval(bleJs);
  t('native-ble.js eval không lỗi khi không có Capacitor', true);
  t('không có Capacitor thì navigator.bluetooth vẫn chưa có (đúng: bridge chỉ chạy trong app native)', !('bluetooth' in win.navigator));
  win.eval(vx3dJs);
  t('vx3d.js định nghĩa window.VX3D', !!win.VX3D);
  t('VX3D.load là hàm', win.VX3D && typeof win.VX3D.load === 'function');
  t('VX3D.View là hàm', win.VX3D && typeof win.VX3D.View === 'function');
  const lento = fs.readFileSync(path.join(ROOT, 'www/img/lento.bin'));
  t('img/lento.bin có magic VX3D', lento.slice(0, 4).toString() === 'VX3D');

  console.log('\n[2] Nội dung web: GAIA/BLE + tài nguyên local + URL ngoài');
  t('có service GAIA 00001100-d102-11e1-9b23-00025b00a5a5', html.includes('00001100-d102-11e1-9b23-00025b00a5a5'));
  t('có characteristic GAIA command/response', html.includes('00001101-d102-11e1-9b23-00025b00a5a5') && html.includes('00001102-d102-11e1-9b23-00025b00a5a5'));
  t('có script native-ble.js?v=2', html.includes('native-ble.js?v=2'));
  t('có script vx3d.js?v=3', html.includes('vx3d.js?v=3'));
  t('có load img/lento.bin', html.includes("img/lento.bin"));
  t('có ảnh img/speaker-front.png', html.includes('img/speaker-front.png'));
  t('không có link tuyệt đối github.io', !html.includes('github.io'));
  t('không còn tên FotoBro / tro-ly-xeo trong web', !/fotobro|tro-ly-xeo|troLyXeo/i.test(html));
  t('đo phòng dùng AudioContext + mic', html.includes('AudioContext') && /getUserMedia|mic/i.test(html));
  t('hls.js có bản local lib/hls.min.js', exists('www/lib/hls.min.js'));
  t('CDN hls chỉ là fallback khi local lỗi', html.includes("addScript('lib/hls.min.js')"));
  const hosts = [...new Set([...html.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  const allowed = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com',
    'de1.api.radio-browser.info', 'audio-lss.vov.vn', 'play.vovgiaothong.vn',
    'ha-noi-community-radio.radiocult.fm', 'icecast.radiofrance.fr', 'kexp.streamguys1.com',
    'rfienvietnamien64k.ice.infomaniak.ch', 'stream.radioparadise.com'];
  const extra = hosts.filter(h => !allowed.includes(h));
  t('URL ngoài chỉ gồm font Google + CDN hls fallback + stream radio + radio-browser', extra.length === 0, 'lạ: ' + extra.join(',') + ' | hosts: ' + hosts.join(','));
  // Mọi tài nguyên local được trỏ tới đều có file thật.
  const localRefs = [...new Set([...html.matchAll(/(?:src|href)="((?:img|lib|sounds|vx3d\.js|native-ble\.js)[^"]*)"/g)].map(m => m[1].split('?')[0]))];
  const missing = localRefs.filter(r => !exists('www/' + r));
  t('mọi tài nguyên local trong index.html đều có file', missing.length === 0, 'thiếu: ' + missing.join(','));
  t('www/sounds có đủ 24 file wav', fs.readdirSync(path.join(ROOT, 'www/sounds')).filter(f => f.endsWith('.wav')).length === 24);
  t('bt.html (trang chẩn đoán Bluetooth) còn đó', exists('www/bt.html') && read('www/bt.html').includes('Web Bluetooth'));

  console.log('\n[3] Cầu nối native-ble.js khớp API plugin bluetooth-le 8.x');
  const defs = read('node_modules/@capacitor-community/bluetooth-le/dist/esm/definitions.d.ts');
  for (const m of ['initialize', 'requestDevice', 'getDevices', 'connect', 'disconnect', 'write', 'startNotifications', 'addListener']) {
    t(`native-ble dùng Ble.${m} — có trong definitions 8.4.0`, bleJs.includes('Ble.' + m) && defs.includes(m + '('));
  }
  t('bridge chỉ chạy khi window.Capacitor là native', bleJs.includes('window.Capacitor') && bleJs.includes('isNativePlatform'));
  t('bridge đọc plugin qua C.Plugins.BluetoothLe', bleJs.includes('C.Plugins') && bleJs.includes('BluetoothLe'));
  t('write gửi hex string (đúng dạng native của plugin 8.x)', bleJs.includes('dataViewToHexString') || bleJs.includes("hex(toDV(v))"));
  t('notification dùng key notification|device|service|char', bleJs.includes('notification|${this.dev.id}|${this.service}|${this.uuid}'));
  t('disconnect dùng key disconnected|deviceId', bleJs.includes('disconnected|${this.dev.id}'));
  t('connect có timeout 12000', bleJs.includes('timeout: 12000'));
  t('getDevices trả về r.devices', bleJs.includes('r.devices'));
  t('www/index.html đúng 240411 bytes như vx-mark4 ee17df1', fs.statSync(path.join(ROOT, 'www/index.html')).size === 240411);
  t('www/native-ble.js đúng 9063 bytes (bản vx-atelier có thêm Native UI fixes 21/11/2026)', fs.statSync(path.join(ROOT, 'www/native-ble.js')).size === 9063);
  t('www/vx3d.js đúng 18372 bytes như vx-mark4 ee17df1', fs.statSync(path.join(ROOT, 'www/vx3d.js')).size === 18372);
  t('native-ble.js khóa zoom (viewport maximum-scale=1, user-scalable=no)', bleJs.includes('maximum-scale=1') && bleJs.includes('user-scalable=no'));
  t('native-ble.js chặn cuộn ngang + chạm đúp zoom', bleJs.includes('overflow-x:clip') && bleJs.includes('touch-action:manipulation'));
  t('native-ble.js đồng bộ StatusBar theo theme', bleJs.includes('StatusBar') && bleJs.includes('setStyle') && bleJs.includes('prefers-color-scheme: dark'));
  t('native-ble.js cắt tên đài Radio tràn mép (sửa 21/11/2026)', bleJs.includes('.station .st-main span{overflow:hidden}') && bleJs.includes('.station .st-main span b,.station .st-main span small{max-width:100%}'));
  t('native-ble.js ẩn tab bar khi bàn phím mở (sửa 21/11/2026)', bleJs.includes('body.kb-open nav.tabs{display:none}') && bleJs.includes('focusin') && bleJs.includes('kb-open'));

  console.log('\n[4] Config: package / Capacitor / Xcode / Info.plist / Privacy / Package.swift');
  const pkg = JSON.parse(read('package.json'));
  eq('package.json version 1.0.0', pkg.version, '1.0.0');
  t('bluetooth-le ^8.4.0', (pkg.dependencies['@capacitor-community/bluetooth-le'] || '').includes('8.4.0'));
  t('@capacitor/core ^8', (pkg.dependencies['@capacitor/core'] || '').startsWith('^8'));
  t('@capacitor/ios ^8', (pkg.dependencies['@capacitor/ios'] || '').startsWith('^8'));
  t('@capacitor/cli ^8 (dev)', (pkg.devDependencies['@capacitor/cli'] || '').startsWith('^8'));
  t('không mang plugin Calendar/Camera/Browser/Preferences của FotoBro sang', !['@capacitor/calendar', '@capacitor/camera', '@capacitor/browser', '@capacitor/preferences', '@capacitor/local-notifications', '@capacitor/haptics', '@capacitor/share'].some(k => pkg.dependencies[k]));
  const capTs = read('capacitor.config.ts');
  t('capacitor.config.ts appId com.vx.atelier', capTs.includes("appId: 'com.vx.atelier'"));
  t('capacitor.config.ts appName Atelier VX', capTs.includes("appName: 'Atelier VX'"));
  t('capacitor.config.ts nền tối #0B0B0C', capTs.includes('#0B0B0C'));
  t('StatusBar DARK (giá trị khởi đầu; bridge đổi theo theme lúc chạy)', capTs.includes("style: 'DARK'"));
  t('WebView phủ kín màn hình (contentInset never — sửa lỗi dải đen 21/11/2026)', capTs.includes("contentInset: 'never'"));
  t('StatusBar nổi trên nội dung (overlaysWebView true — sửa lỗi dải đen 21/11/2026)', capTs.includes('overlaysWebView: true'));
  const capJson = JSON.parse(read('ios/App/App/capacitor.config.json'));
  eq('ios capacitor.config.json appId', capJson.appId, 'com.vx.atelier');
  eq('ios capacitor.config.json appName', capJson.appName, 'Atelier VX');
  t('packageClassList có BluetoothLe (class Swift thật của plugin)', capJson.packageClassList.includes('BluetoothLe'));
  t('packageClassList không có Calendar/Camera/Browser', !capJson.packageClassList.some(c => /Calendar|Camera|Browser/.test(c)));
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  t('pbxproj bundle id com.vx.atelier (2 chỗ)', (pbx.match(/com\.vx\.atelier/g) || []).length === 2);
  t('pbxproj profile "Atelier VX App Store"', pbx.includes('PROVISIONING_PROFILE_SPECIFIER = "Atelier VX App Store"'));
  t('pbxproj CODE_SIGN_STYLE Manual', pbx.includes('CODE_SIGN_STYLE = Manual'));
  t('pbxproj Release dùng iPhone Distribution', pbx.includes('CODE_SIGN_IDENTITY = "iPhone Distribution"'));
  t('pbxproj MARKETING_VERSION 1.0.0', pbx.includes('MARKETING_VERSION = 1.0.0;'));
  t('pbxproj CURRENT_PROJECT_VERSION 1', pbx.includes('CURRENT_PROJECT_VERSION = 1;'));
  t('pbxproj không còn com.fotobro.app', !pbx.includes('com.fotobro.app'));
  const plist = read('ios/App/App/Info.plist');
  t('Info.plist tên hiển thị Atelier VX', plist.includes('<string>Atelier VX</string>'));
  t('Info.plist có NSBluetoothAlwaysUsageDescription', plist.includes('NSBluetoothAlwaysUsageDescription'));
  t('Info.plist có NSBluetoothPeripheralUsageDescription', plist.includes('NSBluetoothPeripheralUsageDescription'));
  t('Info.plist có NSMicrophoneUsageDescription', plist.includes('NSMicrophoneUsageDescription'));
  t('Info.plist KHÔNG còn camera/photo/calendar/Face ID/Google scheme của FotoBro', !/NSCamera|NSPhotoLibrary|NSCalendars|NSFaceID|googleusercontent|fotobro/i.test(plist));
  const priv = read('ios/App/App/PrivacyInfo.xcprivacy');
  t('PrivacyInfo không tracking, không thu thập dữ liệu', priv.includes('<key>NSPrivacyTracking</key>\n\t<false/>') && priv.includes('<key>NSPrivacyCollectedDataTypes</key>\n\t<array/>'));
  const swift = read('ios/App/CapApp-SPM/Package.swift');
  t('Package.swift có CapacitorCommunityBluetoothLe', swift.includes('CapacitorCommunityBluetoothLe'));
  t('Package.swift không có plugin FotoBro (Calendar/Camera/Browser/…)', !/CapacitorCalendar|CapacitorCamera|CapacitorBrowser|CapacitorHaptics|CapacitorLocalNotifications|CapacitorShare|CapacitorPreferences/.test(swift));
  const lock = JSON.parse(read('package-lock.json'));
  t('package-lock có bluetooth-le 8.4.0', lock.packages && lock.packages['node_modules/@capacitor-community/bluetooth-le'] && lock.packages['node_modules/@capacitor-community/bluetooth-le'].version === '8.4.0');

  console.log('\n[5] Workflow GitHub Actions');
  const wf = read('.github/workflows/ios-build.yml');
  t('workflow chạy macos-15', wf.includes('runs-on: macos-15'));
  t('workflow chọn Xcode 26.3 trực tiếp (không dùng action maximedenes đã chết)', wf.includes('Xcode_26.3.app') && !wf.includes('uses: maximedenes') && !wf.includes('uses: maximedenes/'));
  t('workflow Node 22 + npm ci', wf.includes("node-version: '22'") && wf.includes('npm ci'));
  t('workflow chạy test jsdom này', wf.includes('test-vx-atelier-v1.js'));
  t('workflow cap sync ios', wf.includes('npx cap sync ios'));
  t('workflow tăng build number bằng run_number', wf.includes('agvtool new-version -all ${{ github.run_number }}'));
  t('workflow tải profile cho bundle-id com.vx.atelier', wf.includes('bundle-id: com.vx.atelier'));
  t('workflow đẩy TestFlight', wf.includes('upload-testflight-build'));
  t('workflow dùng đủ 6 secret (tên, không giá trị thật)', ['IOS_DIST_CERT_P12_BASE64', 'IOS_DIST_CERT_P12_PASSWORD', 'APP_STORE_CONNECT_API_ISSUER_ID', 'APP_STORE_CONNECT_API_KEY_ID', 'APP_STORE_CONNECT_API_KEY_BASE64', 'APPLE_TEAM_ID'].every(s => wf.includes('secrets.' + s)));
  t('workflow không chứa giá trị secret thật (không có dòng BEGIN key)', !wf.includes('BEGIN'));

  console.log('\n[6] Icon + splash + public sau cap sync');
  const iconBuf = fs.readFileSync(path.join(ROOT, 'AppIcon-1024.png'));
  t('AppIcon-1024.png rộng 1024', iconBuf.readUInt32BE(16) === 1024);
  t('AppIcon-1024.png cao 1024', iconBuf.readUInt32BE(20) === 1024);
  t('AppIcon-1024.png RGB không alpha (color type 2)', iconBuf[25] === 2);
  t('AppIcon-1024.png bit depth 8', iconBuf[24] === 8);
  t('appiconset dùng đúng file AppIcon-512@2x.png 1024x1024', sha('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png') === sha('AppIcon-1024.png'));
  t('appiconset Contents.json trỏ AppIcon-512@2x.png', read('ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json').includes('AppIcon-512@2x.png'));
  const splashBuf = fs.readFileSync(path.join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset/Default@1x~universal~anyany.png'));
  t('splash 2732x2732 RGB', splashBuf.readUInt32BE(16) === 2732 && splashBuf[25] === 2);
  t('public/index.html sau cap sync giống hệt www/index.html', sha('ios/App/App/public/index.html') === sha('www/index.html'));
  t('public có đủ native-ble.js, vx3d.js, img, sounds, lib', ['ios/App/App/public/native-ble.js', 'ios/App/App/public/vx3d.js', 'ios/App/App/public/img/lento.bin', 'ios/App/App/public/lib/hls.min.js'].every(exists));
  t('không có file secret/cert/key trong gói', !fs.readdirSync(ROOT).some(f => /\.(p12|p8|key|pem|mobileprovision)$/.test(f)) && (!exists('certs') || read('.gitignore').includes('certs/')));

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail) console.log('FAIL: ' + fails.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
