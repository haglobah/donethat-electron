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
  teamStatus: null,

  // Settings state
  hasEmails: false,
  hasSlack: false,
  emailRecipients: [],
  slackChannel: null,
  summaryNotificationTime: "17:00", // Default time (5:00 PM)

  // Navigation state
  currentView: null
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

function hasEmails() {
  return state.hasEmails;
}

function hasSlack() {
  return state.hasSlack;
}

function getEmailRecipients() {
  return [...state.emailRecipients];
}

function getSlackChannel() {
  return state.slackChannel;
}

function getSummaryNotificationTime() {
  return state.summaryNotificationTime;
}

function getCurrentView() {
  return state.currentView;
}

// Setters
function updateAuthState(isAuthenticated, userIdToken) {
  state.isAuthenticated = isAuthenticated;
  state.userIdToken = userIdToken;
}

function updateScreenCapturePermission(hasPermission) {
  state.hasScreenCapturePermission = hasPermission;
}

function updateSubscriptionState(subscriptionStatus, teamStatus) {
  state.subscriptionStatus = subscriptionStatus;
  state.teamStatus = teamStatus;
  
  state.hasValidAccess = teamStatus === 'active' || 
                        subscriptionStatus === 'trialing' || 
                        subscriptionStatus === 'active';
}

function updateEmailSettings(recipients) {
  state.emailRecipients = [...recipients];
  state.hasEmails = recipients.length > 0;
}

function updateSlackSettings(channel) {
  state.slackChannel = channel;
  state.hasSlack = !!channel;
}

function updateNotificationTime(time) {
  state.summaryNotificationTime = time;
}

function updateCurrentView(view) {
  state.currentView = view;
}

// Reset state (useful for logout)
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
  hasEmails,
  hasSlack,
  getEmailRecipients,
  getSlackChannel,
  getSummaryNotificationTime,
  getCurrentView,
  updateAuthState,
  updateScreenCapturePermission,
  updateSubscriptionState,
  updateEmailSettings,
  updateSlackSettings,
  updateNotificationTime,
  updateCurrentView,
  resetState
}; 