import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vx.atelier',
  appName: 'Atelier VX',
  webDir: 'www',
  // App VX mặc định nền tối (#0b0b0c trong www/index.html, --bg).
  // Đừng để trắng như FotoBro: màn splash / nền WebView phải tối.
  backgroundColor: '#0B0B0C',
  ios: {
    // Nội dung web chạy trên capacitor://localhost — KHÔNG phải https://,
    // nên service worker (nếu có) và Web Bluetooth / WebHID của bản web
    // đều không chạy như cũ. Bluetooth đi qua cầu nối native-ble.js +
    // plugin @capacitor-community/bluetooth-le (xem README.md).
    contentInset: 'always',
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
      style: 'DARK',
      backgroundColor: '#0B0B0C',
      overlaysWebView: false,
    },
  },
};

export default config;
