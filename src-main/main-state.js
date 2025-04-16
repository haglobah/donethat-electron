const { ipcMain, Notification } = require('electron');
const log = require('electron-log');

// State variables
let store = null;
let pauseState = {
  endTime: null,     // If non-null and in future, app is paused
  timeoutId: null    // Reference to the auto-resume timer
};
let userWorkdays = [1, 2, 3, 4, 5]; // Default Mon-Fri (0=Sun, 6=Sat)
let userWorkhours = { start: "09:00", end: "17:00" }; // Default 9 AM to 5 PM
let lastSummaryTimestamp = null;
let hasScreenCapturePermission = false;
let isWaylandSession = null;
let idToken = null; // User authentication token
let workPeriodCheckTimeoutId = null; // For scheduling next workday/workhours check

// Function references that will be set by main.js
let updateTrayIcon = null;
let checkAndAdjustRecording = null;
let resumeRecordingCallback = null;
let navigateToView = null;
let stopRecordingCallback = null; // Add this for logout handling
let showWindowCallback = null; // Add this for showing the window

/**
 * Initialize the state manager
 * @param {Object} options Configuration options
 * @param {Function} options.updateIcon Function to update tray icon
 * @param {Function} options.checkRecording Function to check and adjust recording
 * @param {Function} options.resumeRecording Function to resume recording
 * @param {Function} options.navigate Function to navigate to a view
 * @param {Function} options.stopRecording Function to stop recording
 * @param {Function} options.showWindow Function to show window
 */
async function initState(options = {}) {
  // Store callback functions
  updateTrayIcon = options.updateIcon;
  checkAndAdjustRecording = options.checkRecording;
  resumeRecordingCallback = options.resumeRecording;
  navigateToView = options.navigate;
  stopRecordingCallback = options.stopRecording;
  showWindowCallback = options.showWindow;

  try {
    // Initialize electron-store using dynamic import for ES module
    const { default: Store } = await import('electron-store');
    store = new Store({
      name: 'donethat-config'
    });

    // Load saved states
    loadPauseState();
    loadWorkSettings();
    loadSummaryTimestamp();
    
    // Set up IPC handlers
    setupIPCHandlers();

    return {
      store,
      isPaused,
      isWorkday,
      isWithinWorkHours,
      isActiveWorkPeriod,
      pauseRecording,
      resumeRecording,
      pauseUntilNextWorkPeriod,
      updateWaylandStatus,
      updateScreenCapturePermission,
      checkAndNotifyForUnreviewedWork,
      getUserWorkdays: () => userWorkdays,
      getUserWorkhours: () => userWorkhours,
      getLastSummaryTimestamp: () => lastSummaryTimestamp,
      hasScreenCapturePermission: () => hasScreenCapturePermission,
      isWaylandSession: () => isWaylandSession,
      isAuthenticated: () => Boolean(idToken),
      getIdToken: () => idToken,
      setIdToken,
      clearIdToken,
      cleanupOnQuit,
      scheduleNextCheck,
      clearDailyWorkPeriodCheckTimeout
    };
  } catch (error) {
    log.error('Failed to initialize state:', error);
    return null;
  }
}

// Helper function to check if currently paused (manual pause)
function isPaused() {
  return pauseState.endTime !== null && pauseState.endTime > new Date();
}

// Helper function to check if today is a configured workday
function isWorkday(date = new Date()) {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  // Ensure userWorkdays is an array before checking
  return Array.isArray(userWorkdays) && userWorkdays.includes(dayOfWeek);
}

// Helper function to check if current time is within configured work hours
function isWithinWorkHours(date = new Date()) {
  // Parse the start and end hours from the format "HH:MM"
  const startParts = userWorkhours.start.split(':');
  const endParts = userWorkhours.end.split(':');
  
  if (startParts.length < 2 || endParts.length < 2) {
    // Invalid format, default to true to avoid disrupting the app
    log.error('Invalid work hours format');
    return true;
  }
  
  const startHour = parseInt(startParts[0], 10);
  const startMinute = parseInt(startParts[1], 10);
  const endHour = parseInt(endParts[0], 10);
  const endMinute = parseInt(endParts[1], 10);

  if (isNaN(startHour) || isNaN(startMinute) || isNaN(endHour) || isNaN(endMinute)) {
    // Invalid numbers, default to true to avoid disrupting the app
    log.error('Invalid work hours numbers');
    return true;
  }
  
  // Create date objects for today's start and end times
  const startTime = new Date(date);
  startTime.setHours(startHour, startMinute, 0, 0);
  
  const endTime = new Date(date);
  endTime.setHours(endHour, endMinute, 0, 0);
  
  // Check if current time is between start and end
  return date >= startTime && date < endTime;
}

// Helper function to check if it's currently an active work period
function isActiveWorkPeriod(date = new Date()) {
  return isWorkday(date) && isWithinWorkHours(date);
}

// Function to pause recording for a specified duration
function pauseRecording(duration, mainWindow) {
  if (pauseState.timeoutId) {
    clearTimeout(pauseState.timeoutId);
    pauseState.timeoutId = null;
  }

  // Calculate end time
  const endTime = new Date(Date.now() + duration);
  
  // Set pause state
  pauseState = {
    endTime: endTime,
    timeoutId: setTimeout(() => resumeRecording(mainWindow), duration)
  };
  
  // Save the pause state
  savePauseState();
  
  // Make sure recording is stopped
  if (stopRecordingCallback) {
    stopRecordingCallback();
  }
  
  // Update tray icon if callback is available
  if (updateTrayIcon) {
    updateTrayIcon(false);
  }

  // Send analytics event to renderer
  if (mainWindow) {
    mainWindow.webContents.send('analytics-event', {
      eventName: 'recording_state_changed',
      eventParams: {
        status: 'paused',
        duration_minutes: Math.round(duration / (60 * 1000))
      }
    });
  }
}

// Function to pause until the start of the next active work period (either today or next workday)
function pauseUntilNextWorkPeriod(mainWindow) {
  const now = new Date();
  
  // Parse work hours
  const startParts = userWorkhours.start.split(':');
  const endParts = userWorkhours.end.split(':');
  
  if (startParts.length < 2 || endParts.length < 2) {
    // Invalid format, fall back to pausing for a day
    log.error('Invalid work hours format when trying to pause until next period');
    pauseRecording(24 * 60 * 60 * 1000, mainWindow);
    return;
  }
  
  const startHour = parseInt(startParts[0], 10);
  const startMinute = parseInt(startParts[1], 10);

  // Today's start time
  const todayStartTime = new Date(now);
  todayStartTime.setHours(startHour, startMinute, 0, 0);
  
  // Check if we're before today's start time on a workday
  if (isWorkday(now) && now < todayStartTime) {
    const duration = todayStartTime.getTime() - now.getTime();
    if (duration > 0) {
      pauseRecording(duration, mainWindow);
      return;
    }
  }
  
  // Find the next workday
  let nextWorkdayDate = new Date(now);
  nextWorkdayDate.setDate(nextWorkdayDate.getDate() + 1);
  
  let daysAhead = 0;
  while (!isWorkday(nextWorkdayDate) && daysAhead < 7) {
    nextWorkdayDate.setDate(nextWorkdayDate.getDate() + 1);
    daysAhead++;
  }
  
  // If no workday found in the next week, just pause for a day
  if (daysAhead >= 7) {
    log.warn('No workday found in the next week, pausing for 24 hours');
    pauseRecording(24 * 60 * 60 * 1000, mainWindow);
    return;
  }
  
  // Set the time to the start of work hours on that workday
  nextWorkdayDate.setHours(startHour, startMinute, 0, 0);
  
  const duration = nextWorkdayDate.getTime() - now.getTime();
  
  // Ensure duration is positive
  if (duration > 0) {
    pauseRecording(duration, mainWindow);
  } else {
    log.error('Calculated pause duration was not positive');
    // Fallback: Pause for 1 hour
    pauseRecording(60 * 60 * 1000, mainWindow);
  }
}

// Function to resume recording (called manually or by timer)
function resumeRecording(mainWindow) {
  if (pauseState.timeoutId) {
    clearTimeout(pauseState.timeoutId);
  }

  // Reset pause state
  const wasPaused = isPaused(); // Check if we were *manually* paused
  pauseState = { endTime: null, timeoutId: null };
  if (store) store.delete('pauseState');

  // Call resume callback if available
  if (resumeRecordingCallback) {
    resumeRecordingCallback();
  }

  // Common operations for all resume cases
  if (mainWindow && wasPaused) {
    mainWindow.webContents.send('pauseStateChanged', false);
    mainWindow.webContents.send('analytics-event', { 
        eventName: 'recording_state_changed',
        eventParams: { status: 'resumed' } 
    });
  }
  
  // Check for unreviewed work when manually resuming
  checkAndNotifyForUnreviewedWork(mainWindow);
}

// Function to save pause state using electron-store
function savePauseState() {
  try {
    // Skip if store is not initialized
    if (!store) {
      log.warn('Store not initialized');
      return;
    }

    const stateToSave = {
      endTime: pauseState.endTime ? pauseState.endTime.getTime() : null
    };
    store.set('pauseState', stateToSave);
  } catch (error) {
    log.error('Failed to save pause state:', error);
  }
}

// Function to load pause state using electron-store
function loadPauseState() {
  try {
    // Skip if store is not initialized
    if (!store) {
      log.warn('Store not initialized when loading pause state');
      return false;
    }

    const savedState = store.get('pauseState');
    
    if (savedState && savedState.endTime) {
      const endTime = new Date(savedState.endTime);
      const now = new Date();
      
      // If pause end time is in the future, restore the pause
      if (endTime > now) {
        const remainingDuration = endTime.getTime() - now.getTime();
        
        pauseState = {
          endTime: endTime,
          timeoutId: setTimeout(() => resumeRecording(), remainingDuration)
        };
        
        return true;
      } else {
        // Pause period has already expired
        store.delete('pauseState');
      }
    }
  } catch (error) {
    log.error('Failed to load pause state:', error);
  }
  return false;
}

// Load work settings (days and hours) from store
function loadWorkSettings() {
  try {
    if (!store) {
      log.warn('Store not initialized when loading work settings');
      return;
    }

    // Load userWorkdays from store, with validation and default fallback
    const savedWorkdays = store.get('userWorkdays');
    if (Array.isArray(savedWorkdays) && savedWorkdays.every(d => typeof d === 'number' && d >= 0 && d <= 6)) {
      userWorkdays = [...new Set(savedWorkdays)].sort((a, b) => a - b); // Ensure unique & sorted
    } else {
      // Default is already set, but save it initially if not present
      if (!savedWorkdays) {
        store.set('userWorkdays', userWorkdays);
      }
    }

    // Load userWorkhours from store, with validation and default fallback
    const savedWorkhours = store.get('userWorkhours');
    if (savedWorkhours && typeof savedWorkhours === 'object' && savedWorkhours.start && savedWorkhours.end) {
      userWorkhours = {
        start: savedWorkhours.start,
        end: savedWorkhours.end
      };
    } else {
      // Default is already set, but save it initially if not present
      if (!savedWorkhours) {
        store.set('userWorkhours', userWorkhours);
      }
    }
  } catch (error) {
    log.error('Failed to load work settings:', error);
  }
}

// Load last summary timestamp from store
function loadSummaryTimestamp() {
  try {
    if (!store) {
      log.warn('Store not initialized when loading summary timestamp');
      return;
    }
    
    let loadedTimestamp = store.get('lastSummaryPeriodEnd');

    // Directly try to use the loaded value, assuming it's milliseconds (number)
    if (loadedTimestamp !== null && loadedTimestamp !== undefined) {
      try {
        const dateObject = new Date(loadedTimestamp);
        // Validate the date created from the loaded number
        if (!isNaN(dateObject.getTime())) {
          lastSummaryTimestamp = loadedTimestamp; // Store as milliseconds
        } else {
          // If the loaded number results in an invalid date, log error and delete the stored value
          log.error('Invalid period end format received:', loadedTimestamp, 
                    'Type:', typeof loadedTimestamp, 
                    'Resulting date object:', dateObject);
          store.delete('lastSummaryPeriodEnd');
          lastSummaryTimestamp = null;
        }
      } catch (error) {
        log.error('Error processing period end:', error, 
                 'Raw value:', loadedTimestamp, 
                 'Type:', typeof loadedTimestamp);
        store.delete('lastSummaryPeriodEnd');
        lastSummaryTimestamp = null;
      }
    } else {
      // For new users, initialize timestamp to current time
      // This gives them time to use the app before showing notifications
      lastSummaryTimestamp = Date.now();
      store.set('lastSummaryPeriodEnd', lastSummaryTimestamp);
    }
  } catch (error) {
    log.error('Failed to load summary timestamp:', error);
  }
}

// Update Wayland session status
function updateWaylandStatus(status) {
  isWaylandSession = status;
}

// Update screen capture permission status
function updateScreenCapturePermission(permission) {
  hasScreenCapturePermission = permission;
}

// Function to check for unreviewed work and notify
function checkAndNotifyForUnreviewedWork(mainWindow) {
  try {
    if (!store) {
      return; // Can't check if store isn't ready
    }

    // Retrieve the stored period end time
    const storedPeriodEnd = store.get('lastSummaryPeriodEnd');
    
    // Only show notification if we have a valid period end time and it's been more than 12 hours
    if (typeof storedPeriodEnd === 'number' && !isNaN(storedPeriodEnd) && storedPeriodEnd > 0) {
      const hoursSinceLastSummary = (Date.now() - storedPeriodEnd) / (1000 * 60 * 60);

      if (hoursSinceLastSummary > 12) {
        // Add 2-minute delay before showing notification
        setTimeout(() => {
          // Double-check the period end hasn't been updated during the delay
          const currentPeriodEnd = store.get('lastSummaryPeriodEnd');
          if (currentPeriodEnd === storedPeriodEnd) {
            const notification = new Notification({
              title: "Review Yesterday's Work",
              body: "You haven't reviewed your last summary. Generate one in DoneThat to catch up!",
              silent: false
            });
            
            // Make notification clickable to open the app
            notification.on('click', () => {
              if (navigateToView) {
                navigateToView('signup-next');
              }
            });
            
            notification.show();
          }
        }, 2 * 60 * 1000); // 2 minutes in milliseconds
      }
    } else {
    }
  } catch (error) {
    log.error('Error checking/notifying for unreviewed work:', error);
  }
}

// Set up IPC handlers for state management
function setupIPCHandlers() {
  // Auth handlers - single source of truth for login/logout events
  ipcMain.on('login', (event, token) => {
    const mainWindow = event.sender.getOwnerBrowserWindow();
    
    if (setIdToken(token)) {
      // Check recording state after login
      if (checkAndAdjustRecording) {
        checkAndAdjustRecording();
      }
      
      // Update tray icon
      if (updateTrayIcon) {
        updateTrayIcon(!isPaused() && hasScreenCapturePermission);
      }
      
      // Send permission status to renderer
      if (mainWindow) {
        mainWindow.webContents.send('screenCapturePermission', {
          hasPermission: hasScreenCapturePermission,
          isWaylandSession: isWaylandSession
        });
      }
    }
  });
  
  ipcMain.on('logout', (event) => {
    clearIdToken();
    
    // Stop recording on logout
    if (stopRecordingCallback) {
      stopRecordingCallback();
    }
  });

  ipcMain.on('initialAuthCheck', (event, isAuthenticated) => {
    if (!isAuthenticated) {
      // If user is not authenticated, show the window
      if (showWindowCallback) {
        showWindowCallback();
      }
    }
  });
  
  // Token refresh handling
  ipcMain.on('token-refreshed', (event, newToken) => {
    const mainWindow = event.sender.getOwnerBrowserWindow();
    
    if (setIdToken(newToken)) {
      // Token updated successfully
    } else {
      if (mainWindow) {
        mainWindow.webContents.send('auth-error');
      }
    }
  });

  // Listen for workday updates from renderer
  ipcMain.on('updateWorkdays', (event, days) => {
    if (Array.isArray(days) && days.every(d => typeof d === 'number' && d >= 0 && d <= 6)) {
      userWorkdays = [...new Set(days)].sort((a, b) => a - b); // Update state, ensure unique & sorted
      
      // Save the updated workdays to the store
      try {
        if (store) {
          store.set('userWorkdays', userWorkdays);
        } else {
          log.warn('Store not initialized, cannot save userWorkdays.');
        }
      } catch (error) {
        log.error('Failed to save userWorkdays:', error);
      }
      
      // Check and adjust recording state if callback available
      if (checkAndAdjustRecording) {
        checkAndAdjustRecording();
      }
    } else {
      log.error('Received invalid workdays data:', days);
    }
  });

  // Listen for workhours updates from renderer
  ipcMain.on('updateWorkhours', (event, hours) => {
    if (hours && typeof hours === 'object' && hours.start && hours.end) {
      userWorkhours = {
        start: hours.start,
        end: hours.end
      };
      
      // Save the updated workhours to the store
      try {
        if (store) {
          store.set('userWorkhours', userWorkhours);
        } else {
          log.warn('Store not initialized, cannot save userWorkhours.');
        }
      } catch (error) {
        log.error('Failed to save userWorkhours:', error);
      }
      
      // Check if we should adjust recording based on the new hours
      if (checkAndAdjustRecording) {
        checkAndAdjustRecording();
      }
    } else {
      log.error('Received invalid workhours data:', hours);
    }
  });

  // Add IPC handler for resume action
  ipcMain.on('resumeRecording', (event) => {
    const mainWindow = event.sender.getOwnerBrowserWindow();
    resumeRecording(mainWindow);
  });

  // Add handler to get initial pause state
  ipcMain.handle('getInitialPauseState', () => {
    return isPaused();
  });

  // From dashboard
  ipcMain.on('pauseUntilTomorrow', (event) => {
    const mainWindow = event.sender.getOwnerBrowserWindow();
    pauseUntilNextWorkPeriod(mainWindow);
  });

  // Add IPC handler for pause state updates
  ipcMain.on('pauseStateChanged', (event, isPaused) => {
    const mainWindow = event.sender.getOwnerBrowserWindow();
    if (mainWindow) {
      mainWindow.webContents.send('pauseStateChanged', isPaused);
    }
  });

  // Listen for summary submission events
  ipcMain.on('summarySubmitted', (event, data) => {
    // Check if we received the period end time
    if (data && data.lastSummaryPeriodEnd) {
      // Store the period end time
      const lastSummaryPeriodEnd = data.lastSummaryPeriodEnd;
      
      // Update the local timestamp variable with the period end time
      lastSummaryTimestamp = lastSummaryPeriodEnd;
      
      // Save to persistent store
      if (store) {
        store.set('lastSummaryPeriodEnd', lastSummaryPeriodEnd);
      } else {
        log.warn('Store not initialized, cannot save lastSummaryPeriodEnd on summary submission');
      }
    } else {
      log.warn('No period end time received with summary submission');
    }
  });

  // Add IPC handler for receiving last summary timestamp
  ipcMain.on('updateLastSummaryTimestamp', (event, timestamp) => {
    try {
      // Check if timestamp exists before trying to access its properties
      if (!timestamp) {
        log.warn('Received null or undefined timestamp');
        return;
      }
      
      // Attempt to convert directly, assuming Firebase Timestamp object
      const timestampInMillis = timestamp._seconds * 1000 + Math.floor(timestamp._nanoseconds / 1000000);

      // Attempt to store the converted milliseconds
      if (store) {
        lastSummaryTimestamp = timestampInMillis; // Update local variable
        store.set('lastSummaryPeriodEnd', timestampInMillis); // Store as periodEnd
      } else {
        // Log only if store isn't ready - potentially important
        log.warn('Store not initialized, cannot save lastSummaryPeriodEnd.');
      }
    } catch (error) {
      // Log any errors during conversion or storage
      log.error('Error processing/storing lastSummaryPeriodEnd:', error, 'Raw value:', timestamp);
    }
  });
}

/**
 * Schedules a check for the next workday/work hours transition
 * Returns the time until the next check in milliseconds
 */
function scheduleNextCheck() {
  // Clear any existing timeout
  if (workPeriodCheckTimeoutId) {
    clearTimeout(workPeriodCheckTimeoutId);
    workPeriodCheckTimeoutId = null;
  }

  const now = new Date();
  
  // Calculate next check times for:
  // 1. Start of today's work hours (if in the future)
  // 2. End of today's work hours (if in the future)
  // 3. Start of next workday
  
  let nextCheckTime = null;
  let checkReason = '';
  
  // Parse work hours
  const startParts = userWorkhours.start.split(':');
  const endParts = userWorkhours.end.split(':');
  
  if (startParts.length >= 2 && endParts.length >= 2) {
    const startHour = parseInt(startParts[0], 10);
    const startMinute = parseInt(startParts[1], 10);
    const endHour = parseInt(endParts[0], 10);
    const endMinute = parseInt(endParts[1], 10);
    
    if (!isNaN(startHour) && !isNaN(startMinute) && !isNaN(endHour) && !isNaN(endMinute)) {
      // Today's start time
      const todayStartTime = new Date(now);
      todayStartTime.setHours(startHour, startMinute, 0, 0);
      
      // Today's end time
      const todayEndTime = new Date(now);
      todayEndTime.setHours(endHour, endMinute, 0, 0);
      
      if (isWorkday(now) && now < todayStartTime) {
        // Before work hours on a workday - check at start time
        nextCheckTime = todayStartTime;
        checkReason = "start of today's work hours";
      } else if (now < todayEndTime) {
        // During work hours - check at end time
        nextCheckTime = todayEndTime;
        checkReason = "end of today's work hours";
      } else {
        // After work hours - check at start time on next workday
        let nextWorkday = new Date(now);
        nextWorkday.setDate(nextWorkday.getDate() + 1);
        
        // Find the next workday
        let daysAhead = 1;
        while (!isWorkday(nextWorkday) && daysAhead < 8) {
          nextWorkday.setDate(nextWorkday.getDate() + 1);
          daysAhead++;
        }
        
        if (daysAhead < 8) {
          const nextWorkdayStartTime = new Date(nextWorkday);
          nextWorkdayStartTime.setHours(startHour, startMinute, 0, 0);
          nextCheckTime = nextWorkdayStartTime;
          checkReason = "start of next workday";
        }
      }
    }
  }
  
  // If we couldn't determine a next check time, default to checking at 4:01 AM tomorrow
  if (!nextCheckTime) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(4, 1, 0, 0);
    nextCheckTime = tomorrow;
    checkReason = "default check time (4:01 AM)";
  }
  
  // Calculate milliseconds until next check
  const msUntilCheck = nextCheckTime.getTime() - now.getTime();
  
  // Ensure msUntilCheck is positive
  const positiveMsUntilCheck = Math.max(msUntilCheck, 60000); // Minimum 1 minute wait
    
  // Set timeout for next check
  workPeriodCheckTimeoutId = setTimeout(() => {
    if (checkAndAdjustRecording) {
      checkAndAdjustRecording();
    } else {
      log.warn("checkAndAdjustRecording not available when timeout fired");
      // Schedule the next check anyway to keep the cycle going
      scheduleNextCheck();
    }
  }, positiveMsUntilCheck);
  
  return positiveMsUntilCheck;
}

/**
 * Cleanup function for app quit
 * Clears any timeouts and saves pause state if needed
 */
function cleanupOnQuit() {
  try {
    // Clear pause timeout if active
    if (pauseState.timeoutId) {
      clearTimeout(pauseState.timeoutId);
      pauseState.timeoutId = null;
    }
    
    // Clear work period check timeout if active
    if (workPeriodCheckTimeoutId) {
      clearTimeout(workPeriodCheckTimeoutId);
      workPeriodCheckTimeoutId = null;
    }
    
    // Save pause state to persist after restart if paused
    if (isPaused()) {
      savePauseState();
    }
  } catch (error) {
    log.error('Error during cleanup on quit:', error);
  }
}

/**
 * Set the user's authentication token
 * @param {string} token ID token from authentication provider
 */
function setIdToken(token) {
  if (token && typeof token === 'string') {
    idToken = token;
    return true;
  } else {
    log.warn('Invalid authentication token provided');
    return false;
  }
}

/**
 * Clear the authentication token (logout)
 */
function clearIdToken() {
  idToken = null;
}

/**
 * Clear the work period check timeout
 */
function clearDailyWorkPeriodCheckTimeout() {
  if (workPeriodCheckTimeoutId) {
    clearTimeout(workPeriodCheckTimeoutId);
    workPeriodCheckTimeoutId = null;
  }
}

module.exports = {
  initState,
  cleanupOnQuit,
  isPaused,
  isWorkday,
  isWithinWorkHours,
  isActiveWorkPeriod,
  pauseRecording,
  resumeRecording,
  pauseUntilNextWorkPeriod,
  updateWaylandStatus,
  updateScreenCapturePermission,
  checkAndNotifyForUnreviewedWork,
  getUserWorkdays: () => userWorkdays,
  getUserWorkhours: () => userWorkhours,
  getLastSummaryTimestamp: () => lastSummaryTimestamp,
  hasScreenCapturePermission: () => hasScreenCapturePermission,
  isWaylandSession: () => isWaylandSession,
  isAuthenticated: () => Boolean(idToken),
  getIdToken: () => idToken,
  setIdToken,
  clearIdToken,
  scheduleNextCheck,
  clearDailyWorkPeriodCheckTimeout
}; 