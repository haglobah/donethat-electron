// Application state management
const state = {
  // Authentication state
  isAuthenticated: false,
  userIdToken: null,

  // Permission state
  hasScreenCapturePermission: false,

  // Subscription state
  hasValidAccess: false,
  subscriptionStatus: null,
  hasActiveTeam: false,

  // Settings state
  isPublic: false,
  storeScreenshots: false,
  lastSummary: null,

  // Navigation state
  currentView: null,

  // Paused and user creation date
  isPaused: false,
  userDateCreated: null
};

// Getters
function getState() {
  return { ...state }; // Return a copy to prevent direct mutation
}

function isAuthenticated() {
  return state.isAuthenticated;
}

function hasScreenCapturePermission() {
  return state.hasScreenCapturePermission;
}

function hasValidAccess() {
  return state.hasValidAccess;
}

function isPublic() {
  return state.isPublic;
}

function isStoreScreenshots() {
  return state.storeScreenshots;
}

function getCurrentView() {
  return state.currentView;
}

function getLastSummary() {
  return state.lastSummary;
}

function getIsPaused() {
  return state.isPaused;
}

function getDateCreated() {
  return state.userDateCreated;
}

// Setters
function updateAuthState(isAuthenticated, userIdToken) {
  state.isAuthenticated = isAuthenticated;
  state.userIdToken = userIdToken;
}

function updateScreenCapturePermission(hasPermission) {
  state.hasScreenCapturePermission = hasPermission;
}

function updateSubscriptionState(subscriptionStatus, activeTeam) {
  state.subscriptionStatus = subscriptionStatus;
  state.hasActiveTeam = activeTeam;
  state.hasValidAccess = activeTeam || 
                        subscriptionStatus === 'trialing' || 
                        subscriptionStatus === 'active';
}

function updateIsPublic(isPublic) {
  state.isPublic = isPublic;
}

function updateStoreScreenshots(storeScreenshots) {
  state.storeScreenshots = storeScreenshots;
}

function updateCurrentView(view) {
  state.currentView = view;
}

function updateLastSummary(timestamp) {
  state.lastSummary = timestamp;
}

function updatePauseState(paused) {
  state.isPaused = paused;
}

function updateDateCreated(timestamp) {
  state.userDateCreated = timestamp;
}

// Reset state
function resetState() {
  Object.keys(state).forEach(key => {
    if (Array.isArray(state[key])) {
      state[key] = [];
    } else if (typeof state[key] === 'boolean') {
      state[key] = false;
    } else if (typeof state[key] === 'string') {
      state[key] = '';
    } else {
      state[key] = null;
    }
  });
}

module.exports = {
  getState,
  isAuthenticated,
  hasScreenCapturePermission,
  hasValidAccess,
  isPublic,
  isStoreScreenshots,
  getCurrentView,
  getLastSummary,
  getIsPaused,
  getDateCreated,
  updateAuthState,
  updateScreenCapturePermission,
  updateSubscriptionState,
  updateIsPublic,
  updateStoreScreenshots,
  updateCurrentView,
  updateLastSummary,
  updatePauseState,
  updateDateCreated,
  resetState
}; 