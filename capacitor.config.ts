// Capacitor configuration — ready for the eventual App Store build.
// The web PWA ships first (research §5.6); when a Mac is available:
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
