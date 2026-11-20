import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vx.atelier',
  appName: 'Atelier VX',
  webDir: 'www',
  // Nền WebView tối (#0b0b0c) — chỉ lộ ra lúc splash / trước khi trang vẽ xong.
  // Trang tự phủ kín màn hình (xem ios.contentInset + StatusBar bên dưới) nên
  // nền này không còn hiện thành dải đen ở vùng tai thỏ / home indicator nữa.
  backgroundColor: '#0B0B0C',
  ios: {
    // Nội dung web chạy trên capacitor://localhost — KHÔNG phải https://,
    // nên service worker (nếu có) và Web Bluetooth / WebHID của bản web
    // đều không chạy như cũ. Bluetooth đi qua cầu nối native-ble.js +
    // plugin @capacitor-community/bluetooth-le (xem README.md).
    //
    // 'never' (sửa 21/11/2026, lỗi "chỗ đen chỗ màu"): trước đây là 'always'
    // nên WebView bị co lại khỏi vùng an toàn, nền đen #0B0B0C lộ ra thành
    // dải đen trên/dưới trong khi nội dung trang (kem #f3f1ec ở light mode)
    // ở giữa. Trang đã tự chừa đệm bằng env(safe-area-inset-*) nên phải để
    // WebView phủ kín màn hình, nền trang tự lo vùng an toàn.
    contentInset: 'never',
  },
  server: {
    // KHÔNG dùng url ngoài: app chạy offline từ file trong www/,
    // radio chỉ cần mạng để phát stream. Không bật cleartext.
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#0B0B0C',
      showSpinner: false,
    },
    StatusBar: {
      // overlaysWebView: true (sửa 21/11/2026, lỗi "chỗ đen chỗ màu"):
      // trước đây là false + backgroundColor đen nên thanh trạng thái là
      // một dải đen tách khỏi nội dung trang. Giờ thanh trạng thái nổi trên
      // nội dung, trang tự chừa đệm env(safe-area-inset-top).
      // style DARK là giá trị khởi đầu (khớp nền tối mặc định của trang);
      // www/native-ble.js sẽ đổi sang LIGHT khi trang đang ở light mode.
      style: 'DARK',
      overlaysWebView: true,
    },
  },
};

export default config;
