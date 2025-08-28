const { initializeApp } = require("firebase/app");
const { getAuth, setPersistence, browserLocalPersistence } = require("firebase/auth");
const { getFunctions } = require("firebase/functions");
const { initializeAppCheck, getToken, ReCaptchaEnterpriseProvider } = require("firebase/app-check");
const firebaseConfig = require("../firebase-config.js");

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

// Configure persistence to ensure auth state persists across app restarts
setPersistence(auth, browserLocalPersistence);

const functions = getFunctions(firebaseApp, "europe-west1");

// Initialize Firebase App Check with reCAPTCHA Enterprise
let appCheck = null;
try {
  if (firebaseConfig && firebaseConfig.recaptchaEnterpriseSiteKey) {
    appCheck = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(firebaseConfig.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    // Warm up by fetching a token once to ensure availability for early requests
    // Errors are intentionally swallowed; Firebase will retry automatically
    getToken(appCheck).catch(() => {});
  }
} catch (_) {
  // In case App Check is misconfigured or unsupported in this environment, continue without blocking app startup
}

async function getAppCheckToken(options = { forceRefresh: false }) {
  try {
    if (!appCheck) return null;
    const token = await getToken(appCheck, options.forceRefresh);
    return token && typeof token.token === 'string' ? token.token : (typeof token === 'string' ? token : null);
  } catch (_) {
    return null;
  }
}

module.exports = { auth, firebaseApp, functions, appCheck, getAppCheckToken };

// Expose App Check getter globally for main process to call via executeJavaScript
try { if (typeof window !== 'undefined') { window.getAppCheckToken = () => getAppCheckToken(); } } catch (_) {}