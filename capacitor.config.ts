import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native app is a thin shell around the deployed Next.js site (the API routes need a server).
 * Set the origin when syncing:   CAP_SERVER_URL=https://your-domain.com npx cap sync
 * It must also be listed in APP_ORIGINS on the server, and be https (camera + getUserMedia).
 * For a debug build against your laptop dev server over the LAN, use an https tunnel
 * (e.g. `npm run dev:https` + the LAN URL, or a cloudflared/ngrok URL).
 */
const url = process.env.CAP_SERVER_URL;
if (url && !/^https:\/\//.test(url)) throw new Error("CAP_SERVER_URL must start with https://");

const config: CapacitorConfig = {
  appId: "app.tryanything.mobile",
  appName: "Tryanything",
  webDir: "native-shell/www",
  server: url ? { url, cleartext: false, androidScheme: "https" } : { androidScheme: "https" },
  ios: { contentInset: "always" },
  android: { allowMixedContent: false },
};

export default config;
