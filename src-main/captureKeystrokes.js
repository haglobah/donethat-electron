const log = require('electron-log');
const { GlobalKeyboardListener } = require('node-global-key-listener');

// Module state
let isTracking = false;
let keystrokeTimeline = [];
let keyboardListener = null;
let lastKeyTime = {}; // Stores the last time each key was pressed for debouncing
const DEBOUNCE_TIME = 150; // 150ms debounce time for keystrokes
const MAX_KEYSTROKE_HISTORY = 1000; // Limit keystroke history to avoid memory issues

/**
 * Check if the application has permission to track keystrokes
 * @returns {Promise<boolean>} True if permission is granted, false otherwise
 */
async function checkPermissions() {
  try {
    // Attempt to create a keyboard listener - this will fail if permissions aren't granted
    const testListener = new GlobalKeyboardListener();
    
    // If we get here, we likely have permissions
    // Clean up test listener
    testListener.kill();
    return true;
  } catch (error) {
    log.error('Keystroke tracking permission check failed:', error);
    return false;
  }
}

/**
 * Normalizes key names to more readable format
 * @param {Object} e Key event
 * @param {Object} down Down state
 * @returns {string} Normalized key representation
 */
function normalizeKeyName(e, down) {
  // Handle special keys with Unicode characters and readable names
  const specialKeys = {
    'space': ' ',
    'tab': '⇥',        // Tab arrow
    'enter': '↵',      // Return symbol
    'escape': 'Esc ',  // More readable escape
    'backspace': '⌫ ', // Backspace symbol with space
    'delete': 'Del ',  // More readable delete
    'up': '↑ ',        // Up arrow
    'down': '↓ ',      // Down arrow
    'left': '← ',      // Left arrow
    'right': '→ ',     // Right arrow
    'home': 'Home ',   // Home
    'end': 'End ',     // End
    'page up': 'PgUp ', // More readable Page up
    'page down': 'PgDn ', // More readable Page down
    'insert': 'Ins ',  // More readable Insert
    'capslock': 'Caps ', // More readable Caps lock
    'numlock': 'Num ',  // More readable Num lock
    'scrolllock': 'Scroll ', // More readable Scroll lock
    'pause': 'Pause ', // Pause
    'printscreen': 'PrtSc ', // More readable Print screen
    'clear': 'Clear ', // Clear key
    'menu': 'Menu ',   // Menu/options
    'undo': 'Undo ',   // Undo
    'redo': 'Redo '    // Redo
  };

  // Direct mapping for punctuation keys
  const punctuationKeys = {
    'comma': ',',
    'period': '.',
    'semicolon': ';',
    'quote': '\'',
    'backquote': '`',
    'minus': '-',
    'equal': '=',
    'open bracket': '[',
    'close bracket': ']',
    'backslash': '\\',
    'slash': '/',
    'multiply': '*',
    'add': '+',
    'subtract': '-',
    'decimal point': '.',
    'divide': '/'
  };

  // Handle common modifiers with shorter symbols and proper spacing
  let modifier = '';
  if (e.state.ctrl) modifier += 'Ctrl+';
  if (e.state.alt) modifier += 'Alt+';
  if (e.state.shift) modifier += 'Shift+';
  if (e.state.meta) {
    // Use different symbols depending on OS for better readability
    if (process.platform === 'darwin') {
      modifier += '⌘+'; // Command symbol on macOS
    } else if (process.platform === 'win32') {
      modifier += 'Win+'; // Windows key on Windows
    } else {
      modifier += 'Super+'; // Super key on Linux/others
    }
  }
  
  // Get base key name
  let keyName = e.name ? e.name.toLowerCase() : 'Unknown';
  
  // Special case for space - always return a space character, even with modifiers
  if (keyName === 'space') {
    return ' ';
  }
  
  // Check if it's a special key
  if (specialKeys[keyName]) {
    return modifier + specialKeys[keyName];
  }
  
  // Check if it's a punctuation key
  if (punctuationKeys[keyName]) {
    return modifier ? modifier + punctuationKeys[keyName] : punctuationKeys[keyName];
  }
  
  // For function keys (F1-F12)
  if (/^f\d+$/.test(keyName)) {
    return modifier + keyName.toUpperCase() + ' ';
  }
  
  // For single character keys, handle case appropriately
  if (keyName.length === 1) {
    const char = e.state.shift ? keyName.toUpperCase() : keyName;
    // No space after regular characters
    return modifier ? modifier + char : char;
  }
  
  // For other keys, keep the name with modifiers
  // Only add space after special command names
  return modifier + keyName;
}

/**
 * Process a keystroke event and add it to the timeline
 * @param {Object} e Key event
 * @param {boolean} down Key state
 */
function processKeystroke(e, down) {
  try {
    // Get current time for debounce check
    const now = Date.now();
    
    // Create a unique key combining key name and modifiers to prevent duplicates
    // but still allow modifier combinations (e.g. "a" vs "Shift+a")
    let modifierStr = '';
    if (e.state.ctrl) modifierStr += 'c';
    if (e.state.alt) modifierStr += 'a';
    if (e.state.shift) modifierStr += 's';
    if (e.state.meta) modifierStr += 'm';
    
    const uniqueKey = `${e.name}-${modifierStr}`;
    
    // Debounce check - ignore if the same key was pressed recently
    if (lastKeyTime[uniqueKey] && now - lastKeyTime[uniqueKey] < DEBOUNCE_TIME) {
      return;
    }
    
    // Update last key time for debouncing
    lastKeyTime[uniqueKey] = now;
    
    // Add to keystroke timeline - we'll correlate with window info later
    keystrokeTimeline.push({
      key: normalizeKeyName(e, down),
      vkey: e.vkey,
      state: down ? 'down' : 'up',
      timestamp: new Date().toISOString()
    });
    
    // Limit the size of keystroke history to avoid memory issues
    if (keystrokeTimeline.length > MAX_KEYSTROKE_HISTORY) {
      keystrokeTimeline = keystrokeTimeline.slice(-MAX_KEYSTROKE_HISTORY);
    }
  } catch (error) {
    log.error('Error processing keystroke:', error);
  }
}

/**
 * Start tracking keystrokes
 * @throws {Error} If permission is denied
 * @returns {Promise<boolean>} Success status
 */
async function startTracking() {
  if (isTracking) {
    return true;
  }

  // Check if we have permission to track keystrokes
  if (!await checkPermissions()) {
    log.warn('Keystroke tracking permission not granted');
    return false;
  }

  // Reset data before starting
  keystrokeTimeline = [];
  lastKeyTime = {};

  try {
    // Initialize keystroke listener
    keyboardListener = new GlobalKeyboardListener();
    
    // Handle key events
    keyboardListener.addListener(function (e, down) {
      // Only care about keydown events to avoid duplicate keystrokes
      if (!down) {
        return; // Skip key up events
      }
      
      // Process the keystroke
      processKeystroke(e, down);
    });
    
    isTracking = true;
    return true;
  } catch (error) {
    log.error('Failed to start keystroke tracking:', error);
    return false;
  }
}

/**
 * Stop tracking keystrokes
 */
function stopTracking() {
  if (!isTracking) {
    return;
  }
  
  try {
    if (keyboardListener) {
      keyboardListener.kill();
      keyboardListener = null;
    }
  } catch (error) {
    log.error('Error stopping keystroke tracking:', error);
  } finally {
    isTracking = false;
    // Clear the lastKeyTime object to ensure no stale data when restarting
    lastKeyTime = {};
  }
}

/**
 * Get the keystroke timeline collected so far
 * @param {number} timeWindowMs - Time window in milliseconds to get data for, defaults to 5 minutes
 * @param {boolean} resetAfterCollection - Whether to clear the timeline after collecting data
 * @returns {Array} Keystroke timeline data for the specified time window
 */
function getKeystrokeTimeline(timeWindowMs = 5 * 60 * 1000, resetAfterCollection = true) {
  if (!isTracking || keystrokeTimeline.length === 0) {
    return [];
  }
  
  // If no time window specified, return all keystrokes
  if (!timeWindowMs) {
    const result = [...keystrokeTimeline];
    
    if (resetAfterCollection) {
      keystrokeTimeline = [];
    }
    
    return result;
  }
  
  // Filter keystrokes to only include those within the time window
  const now = new Date().getTime();
  const cutoffTime = now - timeWindowMs;
  
  const result = keystrokeTimeline.filter(entry => {
    const entryTime = new Date(entry.timestamp).getTime();
    return entryTime >= cutoffTime;
  });
  
  // If requested, clear the timeline after collection to avoid duplicating data
  if (resetAfterCollection) {
    keystrokeTimeline = [];
  }
  
  return result;
}

/**
 * Clear the keystroke timeline data
 */
function clearTimeline() {
  keystrokeTimeline = [];
}

/**
 * Checks if keystroke tracking is currently active
 * @returns {boolean} True if tracking is active
 */
function isTrackingActive() {
  return isTracking;
}

module.exports = {
  startTracking,
  stopTracking,
  checkPermissions,
  getKeystrokeTimeline,
  clearTimeline,
  isTracking: isTrackingActive
}; 