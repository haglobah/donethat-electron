const { initializeApp, getApps } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');
const firebaseConfig = require('../firebase-config.js');

let firebaseApp = null;
let functionsClient = null;

function getFirebaseFunctionsClient() {
  if (!firebaseApp) {
    // Reuse existing default app if already initialized elsewhere in this process
    const existing = getApps && typeof getApps === 'function' ? getApps() : [];
    if (existing && existing.length > 0) {
      firebaseApp = existing[0];
    } else {
      firebaseApp = initializeApp(firebaseConfig);
    }
  }

  if (!functionsClient) {
    functionsClient = getFunctions(firebaseApp, 'europe-west1');
  }

  return functionsClient;
}

async function getGoogleSignInUrl({ port, requestCalendar }) {
  const functions = getFirebaseFunctionsClient();
  const googleSignInStart = httpsCallable(functions, 'authGoogleSignInStart');
  const params = { port };
  if (requestCalendar) params.requestCalendar = true;
  const result = await googleSignInStart(params);
  return result && result.data ? result.data : null;
}

async function getGoogleReauthUrl({ port, idToken, requestCalendar }) {
  const params = { port, reauth: true };
  if (requestCalendar) params.requestCalendar = true;
  if (idToken) params.idToken = idToken;
  const functions = getFirebaseFunctionsClient();
  const googleSignInStart = httpsCallable(functions, 'authGoogleSignInStart');
  const result = await googleSignInStart(params);
  return result && result.data ? result.data : null;
}

module.exports = {
  getGoogleSignInUrl,
  getGoogleReauthUrl
};

