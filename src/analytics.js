// Analytics is intentionally disabled for now.
// Placeholder: wire a future client-safe analytics provider or backend proxy here.

class Analytics {
  constructor() {
    this.currentView = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    if (typeof window !== 'undefined') {
      window.trackPageView = (viewName) => {
        this.trackPageView(viewName);
      };
    }

    this.initialized = true;
  }

  trackPageView(viewName) {
    this.currentView = viewName || null;
    return false;
  }

  async logEvent() {
    return false;
  }

  async setUserProperties() {
    return false;
  }
}

const analytics = new Analytics();

analytics.initialize().catch((error) => {
  console.error('Failed to initialize analytics placeholder:', error);
});

module.exports = {
  initializeAnalytics: () => analytics.initialize(),
  logAnalyticsEvent: (eventName, params) => analytics.logEvent(eventName, params),
  setAnalyticsUserProperties: (properties) => analytics.setUserProperties(properties),
  trackPageView: (viewName) => analytics.trackPageView(viewName),
  trackError: (errorType, errorMessage, errorDetails = {}) => analytics.logEvent('app_error', {
    error_type: errorType,
    error_message: errorMessage,
    ...errorDetails
  }),
  trackUserAction: (actionName, actionDetails = {}) => analytics.logEvent('user_action', {
    action_name: actionName,
    ...actionDetails
  }),
  trackFeatureUsage: (featureName, actionDetails = {}) => analytics.logEvent('feature_used', {
    feature_name: featureName,
    ...actionDetails
  }),
  trackPerformance: (operationName, durationMs, details = {}) => analytics.logEvent('performance', {
    operation: operationName,
    duration_ms: durationMs,
    ...details
  })
};
