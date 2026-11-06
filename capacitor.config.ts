// Capacitor configuration — kept so a native App Store build stays an OPTION.
// The web PWA is the product. If a native build is ever wanted, on any Mac:
//   npm i -D @capacitor/cli @capacitor/core @capacitor/ios
//   npx cap add ios && npx cap sync && npx cap open ios
// then Archive → TestFlight from Xcode. No code changes needed.
const config = {
  appId: 'com.watchlight.game',
  appName: 'Watchlight',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    scrollEnabled: false,
    backgroundColor: '#0b1020',
  },
};

export default config;
