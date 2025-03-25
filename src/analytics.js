const { getAnalytics, logEvent, setUserProperty } = require("firebase/analytics");
const { firebaseApp } = require('./firebase.js');
const { app } = require('electron');
const os = require('os');

// Initialize Firebase Analytics
const analytics = getAnalytics(firebaseApp);

// Track page views
function trackPageView(pageName) {
  logEvent(analytics, 'page_view', {
    page_name: pageName,
    app_version: app.getVersion(),
    platform: process.platform,
    os_version: os.release()
  });
}

// Track user actions
function trackUserAction(actionName, actionParams = {}) {
  logEvent(analytics, 'user_action', {
    action_name: actionName,
    ...actionParams,
    app_version: app.getVersion(),
    platform: process.platform,
    os_version: os.release()
  });
}

// Track errors
function trackError(errorType, errorMessage, errorDetails = {}) {
  logEvent(analytics, 'error', {
    error_type: errorType,
    error_message: errorMessage,
    ...errorDetails,
    app_version: app.getVersion(),
    platform: process.platform,
    os_version: os.release()
  });
}

// Set user properties
function setUserProperties(properties) {
  Object.entries(properties).forEach(([key, value]) => {
    setUserProperty(analytics, key, value);
  });
}

module.exports = {
  trackPageView,
  trackUserAction,
  trackError,
  setUserProperties
}; 