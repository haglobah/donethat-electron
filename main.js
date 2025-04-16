const { app, ipcMain, Tray, Menu, BrowserWindow, nativeImage, screen, Notification, powerMonitor } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const {
  checkScreenCapturePermission: moduleCheckPermission,
  getWaylandStatus
} = require('./src-main/captureScreenshots')
const { 
  startCaptureInterval, 
  stopCaptureInterval, 
  isCapturing,
  setCaptureInterval,
  initCapture
} = require('./src-main/capture')
const { initState } = require('./src-main/main-state')

// Prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('App already running - quitting this instance');
  app.quit();
  // Early exit
  return;
}

// Set up second-instance handler
app.on('second-instance', (event, commandLine, workingDirectory) => {
  // Event won't work for mac
  const { dialog } = require('electron');
  
  // Define platform-specific messages
  let message = 'The app is already running in the tray. Please open it there.';
  
  if (process.platform === 'win32') {
    message += ' (bottom right of the screen next to the time)';
  } else {
    message += ' (You might have to enable your system tray)';
  }
  
  // Show platform-specific alert
  dialog.showMessageBoxSync({
    type: 'info',
    title: 'DoneThat',
    message: 'DoneThat is Already Running',
    detail: message,
    buttons: ['OK']
  });
});

// Handle macOS reactivation (when user clicks dock icon or reopens app)
app.on('activate', () => {
  log.info('App activated');
  // Show the tray menu on reactivation if tray exists
  if (tray) {
    const contextMenu = buildContextMenu();
    tray.popUpContextMenu(contextMenu);
  }
});

// To show dev tools next to main window
let DEBUG = false

// Update screenshot interval logic
let SCREENSHOT_INTERVAL_MINUTES = 5; // Default to 5 minutes for release
// Set interval based on whether it's development or production
if (!app.isPackaged) {
  SCREENSHOT_INTERVAL_MINUTES = 5; // Every minute for development
}
// Set interval in the capture module
setCaptureInterval(SCREENSHOT_INTERVAL_MINUTES);

let iconRecordingPath = path.join(__dirname, 'resources', 'icon_recording.png')
let iconPausedPath = path.join(__dirname, 'resources', 'icon_paused.png')
let iconErrorPath = path.join(__dirname, 'resources', 'icon_error.png')
// State module and variables
let stateManager = null
let tray = null
let mainWindow = null
let screenshotInterval = null

if (DEBUG) {
  // Add custom notification transport for warnings and errors
  log.hooks.push((message, transport) => {
    if (transport !== log.transports.console) return message;

    if (message.level === 'warn' || message.level === 'error') {
      // Only send notifications after app is ready
      if (app.isReady()) {
        try {
          new Notification({
            title: `DoneThat ${message.level.toUpperCase()}`,
            body: message.data.join(' ').substring(0, 100) + (message.data.join(' ').length > 100 ? '...' : ''),
            silent: false
          }).show();
        } catch (err) {
          console.error('Failed to show notification:', err);
        }
      }
    }

    return message;
  });

  // For debugging, replace console with more verbose electron-log
  const originalConsole = { ...console };
  console.log = (...args) => { log.info(...args); originalConsole.log(...args); };
  console.error = (...args) => { log.error(...args); originalConsole.error(...args); };
  console.warn = (...args) => { log.warn(...args); originalConsole.warn(...args); };
  console.info = (...args) => { log.info(...args); originalConsole.info(...args); };
  console.debug = (...args) => { log.debug(...args); originalConsole.debug(...args); };
}

// Only replace console in production, not in debug mode
if (app.isPackaged && !DEBUG) {
  console.log = log.info.bind(log)
  console.error = log.error.bind(log)
  console.warn = log.warn.bind(log)
  console.info = log.info.bind(log)
  console.debug = log.debug.bind(log)
}

// Configure logging based on environment
if (app.isPackaged) {
  // In production: only show warnings and errors
  log.transports.console.level = 'warn'
  log.transports.file.level = 'info'  // Still log info to file for troubleshooting
} else {
  // In development: show all logs
  log.transports.console.level = 'silly'
  log.transports.file.level = 'silly'
}

////// AUTOUPDATER /////

// Configure autoUpdater
function setupAutoUpdater() {
  // Use the centralized logger
  autoUpdater.logger = log

  // Add configuration for GitHub provider
  autoUpdater.allowPrerelease = false
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true


  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version)

    // Send event to renderer to show update view
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded')
    }
  })

  autoUpdater.on('error', (error) => {
    log.error('Update error:', error);

    // More detailed error logging
    if (error.stack) {
      log.error('Error stack:', error.stack);
    }
    if (error.code) {
      log.error('Error code:', error.code);
    }
  })
}

// Add IPC handler to install update and restart
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(true, true)
})

// Function to handle scheduled update checks
function scheduleUpdateChecks() {

  // First check after 1 minute to let the app fully initialize
  setTimeout(() => {
    autoUpdater.checkForUpdates()
      .catch(err => log.error('Error in first update check:', err));

    // Then check every hour
    setInterval(() => {
      autoUpdater.checkForUpdates()
        .catch(err => log.error('Error in hourly update check:', err));
    }, 60 * 60 * 1000);
  }, 1 * 60 * 1000);
}

// Call setup function
setupAutoUpdater()


// Add IPC handler for getting app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

////// AUTOSTART /////

// Fix autostart implementation with platform-specific logic
function setupAutoStart() {
  try {
    if (process.platform === 'win32') {
      // For Windows, use the exact process path without going up a directory
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: []
      });

      log.info('Windows autostart configured with path:', process.execPath);
    } else if (process.platform === 'darwin') {
      // For macOS, use the special path resolution needed for app bundles
      const appFolder = path.dirname(process.execPath);
      const exeName = path.basename(process.execPath);
      const macOSPath = path.resolve(appFolder, '..', exeName);

      app.setLoginItemSettings({
        openAtLogin: true,
        path: macOSPath
      });

    } else {
      // Linux - autostart is not currently supported
    }

    // After update is installed, this will run again with the new executable path
    // when the app restarts, ensuring the autostart always points to latest version
  } catch (error) {
    log.error('Failed to configure autostart:', error);
  }
}

////// MAIN /////

app.whenReady().then(async () => {
  // Initialize the state manager with necessary callbacks
  stateManager = await initState({
    updateIcon: updateTrayIcon,
    checkRecording: checkAndAdjustRecording,
    resumeRecording: () => {
      // Even if already capturing, update icon to show recording state
      if (isCapturing()) {
        updateTrayIcon(true);
        return;
      }
      if (stateManager && stateManager.isAuthenticated()) {
        startRecording();
      }
    },
    navigate: navigateToView,
    stopRecording: stopRecording,
    showWindow: showWindowBelowTray
  });

  // Create tray with initial error icon
  let trayIcon = nativeImage.createFromPath(iconErrorPath)

  // Apply platform-specific resizing for initial icon
  if (process.platform === 'darwin') {
    // macOS menu bar icons should be 18-22px
    trayIcon = trayIcon.resize({ width: 18, height: 18 })
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('DoneThat')

  // Call setupAutoStart here to ensure it runs after app is ready
  setupAutoStart();
  
  // Check screen capture permission
  await checkScreenCapturePermission()
  
  // Initial state check and schedule daily check
  checkAndAdjustRecording();

  // --- Add powerMonitor listener here ---
  powerMonitor.on('resume', () => {
    // Clear the potentially delayed timeout from before sleep
    if (stateManager) {
        stateManager.clearDailyWorkPeriodCheckTimeout();
    }
    // Immediately check the state and schedule the *next* check
    checkAndAdjustRecording();
  });
  // --- End powerMonitor listener ---

  // Handle left-click to show a fresh context menu
  tray.on('click', () => {
    const contextMenu = buildContextMenu()
    tray.popUpContextMenu(contextMenu)
  })

  // Also handle right-click to show a fresh context menu
  tray.on('right-click', () => {
    const contextMenu = buildContextMenu()
    tray.popUpContextMenu(contextMenu)
  })

  // Create window but don't show it yet
  createWindow()

  // Check for updates with proper error handling
  try {
    // Setup updater
    setupAutoUpdater();

    if (app.isPackaged) {
      scheduleUpdateChecks();
    } else {
    }
  } catch (error) {
    log.error('Error setting up updater:', error);
  }

  // Also check permissions when the app is activated
  app.on('activate', async () => {
    await checkScreenCapturePermission();

    log.warn(`A Sending permission check result: hasPermission=${stateManager.hasScreenCapturePermission()}, isWaylandSession=${stateManager.isWaylandSession()}`);

    if (mainWindow) {
      mainWindow.webContents.send('screenCapturePermission', {
        hasPermission: stateManager.hasScreenCapturePermission(),
        isWaylandSession: stateManager.isWaylandSession()
      });
    }
  });

  // Set up periodic update checks (every hour)
  setInterval(() => {
    autoUpdater.checkForUpdates()
      .then()
      .catch(err => console.error('Error in periodic update check:', err))
  }, 60 * 60 * 1000) // 1 hours in milliseconds

})

// Handle OS-level quit events properly - especially important for macOS
app.on('before-quit', () => {
  // Flag that we're actually quitting, not just closing windows
  app.isQuitting = true;

  // Clean up resources
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
  }
  
  // Clean up state (timeouts and save pause state if needed)
  if (stateManager) {
    stateManager.cleanupOnQuit();
  }
})

////// TRAY /////

// Function to update the tray icon based on recording state
function updateTrayIcon(isActuallyRecording) {
  // Safety check - ensure tray exists before trying to update it
  if (!tray) {
    return
  }

  let iconPath;
  let tooltip;

  const loggedIn = stateManager && stateManager.isAuthenticated();
  const manuallyPaused = stateManager && stateManager.isPaused();
  const todayIsWorkPeriod = stateManager && stateManager.isActiveWorkPeriod(); // Check current day

  if (isActuallyRecording) {
    iconPath = iconRecordingPath;
    tooltip = 'DoneThat - Recording';
  } else if (manuallyPaused) {
    iconPath = iconPausedPath;
    tooltip = 'DoneThat - Paused';
  } else if (!loggedIn) {
    iconPath = iconErrorPath;
    tooltip = 'DoneThat - Not Logged In';
  } else if (!stateManager.hasScreenCapturePermission()) {
      iconPath = iconErrorPath;
      tooltip = 'DoneThat - Screen Permission Needed';
  } else if (!todayIsWorkPeriod) {
    iconPath = iconPausedPath; // Use paused icon for non-work-period
    tooltip = 'DoneThat - Not Recording (no working hours)';
  } else {
    // Default fallback (e.g., other error state?)
    iconPath = iconErrorPath;
    tooltip = 'DoneThat - Not Recording';
  }

  // Load and set the appropriate icon
  let icon = nativeImage.createFromPath(iconPath)

  // MODIFY the resizing code to skip Windows
  if (process.platform === 'darwin') {
    // macOS menu bar icons look best at 18-22px
    icon = icon.resize({ width: 18, height: 18 })
  }

  tray.setImage(icon)

  // Clear any previous title (macOS specific)
  if (process.platform === 'darwin') {
    tray.setTitle('')
  }

  // Update context menu on Linux to reflect current state
  if (process.platform === 'linux') {
    const contextMenu = buildContextMenu()
    tray.setContextMenu(contextMenu)
  }

  tray.setToolTip(tooltip)
}

// Function to navigate to a specific view
function navigateToView(viewName) {
  showWindowBelowTray();
  mainWindow.webContents.send('navigate', viewName);
}

// Function to build the context menu with pause options
function buildContextMenu() {
  const isLoggedIn = stateManager && stateManager.isAuthenticated();
  const currentlyPaused = stateManager && stateManager.isPaused();

  // Start with basic template
  const template = []

  // Add "Open App" as the first option for all platforms
  template.push({
    label: 'Open App',
    click: () => navigateToView('signup-next')
  }, 
  // Add Open Settings option (renamed from Setup)
  {
    label: 'Open Settings',
    click: () => navigateToView('settings'),
    enabled: isLoggedIn
  },
  { type: 'separator' },
  // Add "Open Web Portal" option
  {
    label: 'Open Web Portal',
    click: () => {
      const { shell } = require('electron');
      shell.openExternal('https://app.donethat.ai');
    }
  },
  { type: 'separator' },
)

  // Add pause options
  template.push(
    {
      label: 'Pause for 5 minutes',
      click: () => stateManager.pauseRecording(5 * 60 * 1000, mainWindow),
      enabled: isLoggedIn && !currentlyPaused && screenshotInterval
    },
    {
      label: 'Pause for 15 minutes',
      click: () => stateManager.pauseRecording(15 * 60 * 1000, mainWindow),
      enabled: isLoggedIn && !currentlyPaused && screenshotInterval
    },
    {
      label: 'Pause for 30 minutes',
      click: () => stateManager.pauseRecording(30 * 60 * 1000, mainWindow),
      enabled: isLoggedIn && !currentlyPaused && screenshotInterval
    },
    {
      label: 'Pause for 1 hour',
      click: () => stateManager.pauseRecording(60 * 60 * 1000, mainWindow),
      enabled: isLoggedIn && !currentlyPaused && screenshotInterval
    },
    {
      label: 'Pause for today',
      click: () => stateManager.pauseUntilNextWorkPeriod(mainWindow),
      enabled: isLoggedIn && !currentlyPaused && screenshotInterval
    },
    {
      label: 'Resume',
      click: () => stateManager.resumeRecording(mainWindow),
      enabled: isLoggedIn && currentlyPaused
    }
  )

  // Add separator before logout
  template.push(
    { type: 'separator' }
  );

  // Always show logout option but disable if not logged in
  template.push(
    {
      label: 'Logout',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('logout');
        }
      },
      enabled: isLoggedIn
    }
  );

  // Add quit option at the end
  template.push(
    {
      label: 'Quit',
      click: () => app.quit()
    }
  )

  return Menu.buildFromTemplate(template)
}

// Central function to evaluate and adjust recording state based on all factors
function checkAndAdjustRecording() {
    const isCurrentlyRecording = isCapturing();
    const isAuthenticated = stateManager && stateManager.isAuthenticated();
    const hasPermission = stateManager && stateManager.hasScreenCapturePermission();
    const isPaused = stateManager && stateManager.isPaused();
    const isActivePeriodNow = stateManager ? stateManager.isActiveWorkPeriod() : false; // Check current work period status
    const lastSummaryTimestamp = stateManager ? stateManager.getLastSummaryTimestamp() : null;

    // Determine the *ideal* recording state based on current conditions
    const shouldBeRecording = isAuthenticated && hasPermission && !isPaused && isActivePeriodNow;

    // --- Notification Logic for Workday End ---
    // Check if recording was active *before* this check AND it should stop *now* primarily because the work period ended
    if (isCurrentlyRecording && !shouldBeRecording && !isActivePeriodNow) {
        // This condition targets the moment the work period ends while recording was active.
        // We assume the other essential conditions (auth, permission, not paused) were met just before this.

        // Check the timestamp condition
        const threeHoursInMillis = 3 * 60 * 60 * 1000;
        if (lastSummaryTimestamp && (Date.now() - lastSummaryTimestamp > threeHoursInMillis)) {
            // Show notification
            const notification = new Notification({
                title: "Workday Ended",
                body: "Remember to generate your summary in DoneThat!",
                silent: false // Make sure it's not silent
            });

            // Make notification clickable to open the app
            notification.on('click', () => {
                 navigateToView('signup-next'); // Navigate to the main view
            });

            notification.show();
            log.info('Workday ended notification shown.'); // Log that we showed it
        }
    }
    // --- End Notification Logic ---

    // If authenticated, has permission, not manually paused, but outside work hours,
    // auto-pause until next work period
    if (isAuthenticated && hasPermission && !isPaused && !isActivePeriodNow) {
        stateManager.pauseUntilNextWorkPeriod(mainWindow);
    } 
    // Regular start/stop logic
    else if (isCurrentlyRecording && !shouldBeRecording) {
        stopRecording();
    } else if (!isCurrentlyRecording && shouldBeRecording) {
        startRecording();
    } else {
        // No change in start/stop needed, but update icon based on *actual* recording status
        // This handles cases like being manually paused outside work hours, etc.
        updateTrayIcon(isCurrentlyRecording);
    }

    // Schedule the next check (important for the loop)
    if (stateManager) {
        stateManager.scheduleNextCheck();
    }
}

////// WINDOWS /////

// Separate window creation from showing
function createWindow() {
  if (!mainWindow) {
    mainWindow = new BrowserWindow({
      width: DEBUG ? 600 : 250,
      height: DEBUG ? 600 : 450,
      // Add frame on Linux, keep frameless on other platforms
      frame: false,
      resizable: false,
      // Make window movable on Linux but keep it fixed on other platforms
      movable: !(process.platform === 'darwin'),
      show: false,
      skipTaskbar: true, // Hide from taskbar on Windows/Linux
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        partition: 'persist:donethat',
        webSecurity: true,
        // Add these to ensure proper persistence
        enableRemoteModule: false,
        sandbox: false,
        // This is important for IndexedDB persistence
        backgroundThrottling: false
      }
    })

    mainWindow.loadFile('./src/index.html')

    // Debug inspector
    if (DEBUG) {
      mainWindow.webContents.openDevTools();
    }
    // Log any webContents errors
    mainWindow.webContents.on('console-message', (event, level, message) => {
      console.log('Renderer Console:', message);
    });

    // Position the window once it's ready.
    mainWindow.once('ready-to-show', () => {
      mainWindow.webContents.send('screenCapturePermission', {
        hasPermission: stateManager.hasScreenCapturePermission(),
        isWaylandSession: stateManager.isWaylandSession()
      });
      
      // Initialize capture with auth error handler
      initCapture(mainWindow, handleCaptureAuthErrors);
    })

    mainWindow.on('blur', () => {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide()
      }
    })
  }
}

// Intelligently positions the window relative to the tray icon
// with support for multiple displays
function showWindowBelowTray() {
  // Get tray icon bounds
  const trayBounds = tray.getBounds()

  // Get window size
  const windowBounds = mainWindow.getBounds()

  // Get all displays
  const allDisplays = screen.getAllDisplays()

  // Find which display contains the tray icon
  const trayDisplay = allDisplays.find(display => {
    const { x, y, width, height } = display.bounds
    return (
      trayBounds.x >= x && trayBounds.x < x + width &&
      trayBounds.y >= y && trayBounds.y < y + height
    )
  }) || screen.getPrimaryDisplay() // Fall back to primary if not found

  // Use the working area of the display containing the tray
  const { workArea } = trayDisplay

  let x, y;

  // Linux-specific positioning logic
  if (process.platform === 'linux') {
    // On Linux, center in the primary display as a fallback
    // since tray positioning can be unreliable
    x = Math.round(workArea.x + (workArea.width / 2) - (windowBounds.width / 2))
    y = Math.round(workArea.y + (workArea.height / 2) - (windowBounds.height / 2))

    // If we have valid tray bounds, try to position near it
    if (trayBounds.width > 0 && trayBounds.height > 0) {
      // Position at the bottom of the screen if the tray appears to be at the bottom
      // Common for panels at bottom of screen
      if (trayBounds.y > workArea.y + (workArea.height / 2)) {
        y = workArea.y + workArea.height - windowBounds.height - 50; // 50px buffer
      } else {
        // Otherwise position at top with offset
        y = workArea.y + 50;
      }
    }
  } else {
    // Original positioning for Windows and macOS
    // Calculate x position: center window horizontally relative to the tray icon
    x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2))

    // Determine if tray is closer to top or bottom of the display
    const distanceToTop = trayBounds.y - workArea.y
    const distanceToBottom = (workArea.y + workArea.height) - (trayBounds.y + trayBounds.height)

    if (distanceToTop < distanceToBottom) {
      // Tray is closer to top - position window below tray
      y = trayBounds.y + trayBounds.height
    } else {
      // Tray is closer to bottom - position window above tray
      y = trayBounds.y - windowBounds.height
    }
  }

  // Ensure window doesn't go off-screen horizontally
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - windowBounds.width))

  // Ensure window doesn't go off-screen vertically
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - windowBounds.height))

  mainWindow.setPosition(x, y, false)
  mainWindow.show()
  mainWindow.focus() // Ensure window gets focus
}
// Modify the window-all-closed handler to respect system quit
app.on('window-all-closed', (event) => {
  // Only prevent default if we're not in the quit process
  if (!app.isQuitting) {
    event.preventDefault();
  }
  // Otherwise let the app quit normally
});

// Update the focus handler to use state manager
app.on('browser-window-focus', async () => {
  const oldPermission = stateManager ? stateManager.hasScreenCapturePermission() : false;
  await checkScreenCapturePermission();

  // Only send update if permission status actually changed
  if (oldPermission !== stateManager.hasScreenCapturePermission() && mainWindow) {
    // Use the state manager values
    mainWindow.webContents.send('screenCapturePermission', {
      hasPermission: stateManager.hasScreenCapturePermission(),
      isWaylandSession: stateManager.isWaylandSession()
    });

    // Re-evaluate recording state based on permission change
    checkAndAdjustRecording();
  }
});

////// INPUT DATA ////

// Checks all conditions (login, permission, pause, workday) and starts interval if appropriate
function startRecording() {
  // Check for unreviewed work before starting/resuming recording
  if (stateManager) {
    stateManager.checkAndNotifyForUnreviewedWork(mainWindow);
  }

  // Start the capture interval - auth errors are now handled by the callback passed to initCapture
  if (stateManager && stateManager.isAuthenticated()) {
    startCaptureInterval(stateManager.getIdToken());
  }
  
  // Common operations
  updateTrayIcon(true) // Show recording state
  if (mainWindow) {
    mainWindow.webContents.send('pauseStateChanged', false)
    mainWindow.webContents.send('analytics-event', { 
      eventName: 'recording_state_changed',
      eventParams: { status: 'started' } 
    })
  }
}

// Stops the interval and updates the icon
function stopRecording() {
  // Stop the capture interval and all captures
  stopCaptureInterval();

  updateTrayIcon(false) // Update icon to non-recording state
  
  // Send state updates
  if (mainWindow) {
    mainWindow.webContents.send('pauseStateChanged', true)
    mainWindow.webContents.send('analytics-event', { 
      eventName: 'recording_state_changed',
      eventParams: { status: 'stopped' } 
    })
  }
}

// Function to check screen capture permission
async function checkScreenCapturePermission() {
  // Get current permission status from OS-level APIs
  const hasPermission = await moduleCheckPermission();
  const waylandStatus = getWaylandStatus();
  
  // Update the state manager with current values
  if (stateManager) {
    stateManager.updateScreenCapturePermission(hasPermission);
    stateManager.updateWaylandStatus(waylandStatus);
  } else {
    log.warn('State manager not initialized, cannot update screen capture permission');
  }
  
  return hasPermission;
}

// Also update the explicit permission check handler
ipcMain.on('checkScreenCapturePermission', async () => {
  await checkScreenCapturePermission();

  if (mainWindow) {
    // Send both permission status and session type from state manager
    mainWindow.webContents.send('screenCapturePermission', {
      hasPermission: stateManager.hasScreenCapturePermission(),
      isWaylandSession: stateManager.isWaylandSession()
    });
  }
});

// Add a new IPC handler for requesting screen capture permission
ipcMain.on('requestScreenCapturePermission', async () => {
  // On macOS this would open System Preferences > Security & Privacy > Screen Recording
  // On Windows there isn't a direct way to open system settings for this
  const { shell } = require('electron')

  if (process.platform === 'darwin') {
    // macOS
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  } else if (process.platform === 'win32') {
    // Windows - open general privacy settings
    shell.openExternal('ms-settings:privacy')
  } else {
    // Linux or other platforms
  }

  // After opening settings, we should check permission again when app regains focus
  const focusListener = async () => {
    // Remove listener immediately to prevent multiple triggers
    app.removeListener('browser-window-focus', focusListener);

    const oldPermission = stateManager.hasScreenCapturePermission();
    await checkScreenCapturePermission();

    if (stateManager.hasScreenCapturePermission() !== oldPermission && mainWindow) { // Check if permission *changed*
      mainWindow.webContents.send('screenCapturePermission', {
        hasPermission: stateManager.hasScreenCapturePermission(),
        isWaylandSession: stateManager.isWaylandSession()
      });

      // Re-evaluate recording state based on permission change
      checkAndAdjustRecording();
    }
  };
  
  app.on('browser-window-focus', focusListener);
})

/**
 * Handles authentication errors reported by the capture module
 * @param {Object} result - Authentication error object
 * @param {boolean} [result.authError] - True if there was a general authentication error
 * @param {boolean} [result.tokenExpired] - True if the authentication token has expired
 */
function handleCaptureAuthErrors(result) {
  // Handle auth error
  if (result && result.authError) {
    if (stateManager) {
      stateManager.clearIdToken();
    }
    
    if (mainWindow) {
      mainWindow.webContents.send('auth-error');
    }
  }
  
  // Handle token expired error
  if (result && result.tokenExpired) {    
    // Request token refresh from renderer process
    if (mainWindow) {
      mainWindow.webContents.send('refresh-token');
      
      // No need for ipcMain.once here as main-state now handles token-refreshed
    }
  }
}