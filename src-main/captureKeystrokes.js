const { execSync } = require('child_process')
const log = require('electron-log')
const path = require('path')

// Variables to track keystroke data
let isTracking = false
let keystrokeTimeline = []
let pollInterval = null
let lastKeystrokes = []

/**
 * Check if we have permission to track keystrokes
 * @returns {Promise<boolean>} True if permission is granted
 */
async function checkPermission() {
  try {
    if (process.platform === 'darwin') {
      // macOS: Check for accessibility permissions with a simple test
      try {
        execSync('osascript -e "tell application \\"System Events\\" to key code 53"', { stdio: 'ignore' })
        return true
      } catch (error) {
        log.error('Keystroke tracking permission check failed on macOS:', error)
        return false
      }
    } else if (process.platform === 'win32') {
      // Windows: Try to access keyboard state
      try {
        execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Control]::IsKeyLocked([System.Windows.Forms.Keys]::CapsLock)"`, { stdio: 'ignore' })
        return true
      } catch (error) {
        log.error('Keystroke tracking permission check failed on Windows:', error)
        return false
      }
    } else if (process.platform === 'linux') {
      // Linux: Check for input device access
      try {
        const hasWayland = process.env.XDG_SESSION_TYPE === 'wayland'
        
        if (hasWayland) {
          // Wayland - check for evtest
          execSync('which evtest', { stdio: 'ignore' })
        } else {
          // X11 - check for xdotool
          execSync('which xdotool', { stdio: 'ignore' })
        }
        
        return true
      } catch (error) {
        log.error('Keystroke tracking permission check failed on Linux:', error)
        return false
      }
    }
    
    return false
  } catch (error) {
    log.error('Error checking keystroke tracking permission:', error)
    return false
  }
}

/**
 * Get currently pressed keys
 * @returns {Array<{keyCode: string, character: string}>} List of pressed keys
 */
function getPressedKeys() {
  const keys = []
  
  try {
    if (process.platform === 'darwin') {
      // macOS: Use AppleScript to check key states
      const script = `
        tell application "System Events"
          set keyList to {}
          
          repeat with keyCode from 0 to 127
            if key code keyCode is down then
              set end of keyList to keyCode
            end if
          end repeat
          
          return keyList
        end tell
      `
      
      const result = execSync(`osascript -e '${script}'`).toString().trim()
      
      if (result && result !== '{}') {
        // Parse result - format is like: {0, 15, 36}
        const keyCodesStr = result.replace(/[{}]/g, '').split(', ')
        
        if (keyCodesStr[0] !== '') {
          keyCodesStr.forEach(codeStr => {
            const code = parseInt(codeStr, 10)
            if (!isNaN(code)) {
              // Convert key code to character when possible
              let char = getMacKeyCharacter(code)
              keys.push({
                keyCode: `KC_${code}`,
                character: char
              })
            }
          })
        }
      }
    } else if (process.platform === 'win32') {
      // Windows: Use PowerShell to check key states
      const script = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Collections.Generic;

        public class KeyboardHelper {
          [DllImport("user32.dll")]
          public static extern short GetAsyncKeyState(int vKey);
          
          public static List<int> GetPressedKeys() {
            List<int> pressedKeys = new List<int>();
            
            // Check all virtual key codes
            for (int i = 8; i <= 190; i++) {
              // Skip unused codes
              if ((i >= 14 && i <= 15) || (i >= 21 && i <= 26) || (i >= 28 && i <= 31) ||
                  (i >= 33 && i <= 35) || (i >= 41 && i <= 46) || (i >= 58 && i <= 64) ||
                  (i >= 91 && i <= 95) || (i >= 106 && i <= 109) || (i >= 146 && i <= 159) ||
                  (i >= 174 && i <= 177) || (i >= 181 && i <= 183)) {
                continue;
              }
              
              short state = GetAsyncKeyState(i);
              if ((state & 0x8000) != 0) {
                pressedKeys.Add(i);
              }
            }
            
            return pressedKeys;
          }
        }
"@

        $pressedKeys = [KeyboardHelper]::GetPressedKeys()
        
        $output = @()
        foreach ($keyCode in $pressedKeys) {
          $keyChar = ""
          
          # Try to convert key code to character
          switch ($keyCode) {
            8 { $keyChar = "Backspace" }
            9 { $keyChar = "Tab" }
            13 { $keyChar = "Enter" }
            16 { $keyChar = "Shift" }
            17 { $keyChar = "Ctrl" }
            18 { $keyChar = "Alt" }
            20 { $keyChar = "CapsLock" }
            27 { $keyChar = "Esc" }
            32 { $keyChar = "Space" }
            37 { $keyChar = "Left" }
            38 { $keyChar = "Up" }
            39 { $keyChar = "Right" }
            40 { $keyChar = "Down" }
            48 { $keyChar = "0" }
            49 { $keyChar = "1" }
            50 { $keyChar = "2" }
            51 { $keyChar = "3" }
            52 { $keyChar = "4" }
            53 { $keyChar = "5" }
            54 { $keyChar = "6" }
            55 { $keyChar = "7" }
            56 { $keyChar = "8" }
            57 { $keyChar = "9" }
            65 { $keyChar = "a" }
            66 { $keyChar = "b" }
            67 { $keyChar = "c" }
            68 { $keyChar = "d" }
            69 { $keyChar = "e" }
            70 { $keyChar = "f" }
            71 { $keyChar = "g" }
            72 { $keyChar = "h" }
            73 { $keyChar = "i" }
            74 { $keyChar = "j" }
            75 { $keyChar = "k" }
            76 { $keyChar = "l" }
            77 { $keyChar = "m" }
            78 { $keyChar = "n" }
            79 { $keyChar = "o" }
            80 { $keyChar = "p" }
            81 { $keyChar = "q" }
            82 { $keyChar = "r" }
            83 { $keyChar = "s" }
            84 { $keyChar = "t" }
            85 { $keyChar = "u" }
            86 { $keyChar = "v" }
            87 { $keyChar = "w" }
            88 { $keyChar = "x" }
            89 { $keyChar = "y" }
            90 { $keyChar = "z" }
            default { $keyChar = "" }
          }
          
          $output += @{
            keyCode = "VK_$keyCode"
            character = $keyChar
          }
        }
        
        ConvertTo-Json $output
      `
      
      const result = execSync(`powershell -Command "${script.replace(/\$/g, '\$').replace(/"/g, '\\"')}"`).toString().trim()
      
      if (result && result !== '[]') {
        try {
          const parsedResult = JSON.parse(result)
          parsedResult.forEach(key => {
            keys.push({
              keyCode: key.keyCode,
              character: key.character
            })
          })
        } catch (jsonError) {
          log.error('Error parsing Windows key state JSON:', jsonError)
        }
      }
    } else if (process.platform === 'linux') {
      // Linux: Different approaches for Wayland vs X11
      const hasWayland = process.env.XDG_SESSION_TYPE === 'wayland'
      
      if (hasWayland) {
        // Wayland - access input devices directly
        try {
          // List input devices
          const devicesOutput = execSync('ls /dev/input/by-path/ | grep -i kbd').toString().trim()
          const devicePaths = devicesOutput.split('\n')
          
          if (devicePaths && devicePaths.length > 0 && devicePaths[0]) {
            // Take the first keyboard device
            const keyboardPath = path.join('/dev/input/by-path', devicePaths[0])
            
            // Use evtest to check key states (run very briefly)
            const evtestOutput = execSync(`timeout 0.1s evtest ${keyboardPath} 2>&1 || true`).toString()
            
            // Parse events for key presses
            const keyEvents = evtestOutput.match(/EV_KEY.*value 1/g)
            
            if (keyEvents && keyEvents.length > 0) {
              keyEvents.forEach(eventLine => {
                const keyMatch = eventLine.match(/KEY_(\w+)/)
                if (keyMatch && keyMatch[1]) {
                  const keyName = keyMatch[1]
                  keys.push({
                    keyCode: `KEY_${keyName}`,
                    character: getLinuxKeyCharacter(keyName)
                  })
                }
              })
            }
          }
        } catch (error) {
          log.error('Error getting Wayland key states:', error)
        }
      } else {
        // X11 - use xdotool
        try {
          // Get modifier key states
          const modifierOutput = execSync('xdotool getmouselocation --shell | grep WINDOW').toString().trim()
          const activeWindow = modifierOutput.split('=')[1]
          
          if (activeWindow) {
            // Get key states for the active window
            const keyOutput = execSync(`xdotool key --window ${activeWindow} --delay 0 getactivewindow getwindowname 2>/dev/null || true`).toString().trim()
            
            // This is very limited - X11 doesn't easily allow checking key states
            // For a real implementation, consider using a library like 'x11' for Node.js
            
            // For demonstration, we'll just check a few common keys
            const keyCommands = [
              'key shift', 'key ctrl', 'key alt', 'key super'
            ]
            
            for (const cmd of keyCommands) {
              try {
                const test = execSync(`xdotool ${cmd} sleep 0.01 ${cmd} up`).toString()
                const keyName = cmd.split(' ')[1]
                
                keys.push({
                  keyCode: `X11_${keyName.toUpperCase()}`,
                  character: keyName
                })
              } catch (error) {
                // Key not pressed - skip
              }
            }
          }
        } catch (error) {
          log.error('Error getting X11 key states:', error)
        }
      }
    }
  } catch (error) {
    log.error('Error getting pressed keys:', error)
  }
  
  return keys
}

/**
 * Start tracking keystrokes
 * @param {Object} options Configuration options
 * @param {number} options.pollInterval Milliseconds between polls (default: 100)
 * @param {number} options.maxHistoryMs Maximum history to keep in milliseconds (default: 5 minutes)
 * @returns {boolean} Success status
 */
function startTracking(options = {}) {
  if (isTracking) {
    log.warn('Keystroke tracking already active')
    return false
  }
  
  try {
    // Initialize timeline and settings
    keystrokeTimeline = []
    const interval = options.pollInterval || 100
    const maxHistory = options.maxHistoryMs || 5 * 60 * 1000 // 5 minutes default
    
    // Start polling for keystrokes
    pollInterval = setInterval(() => {
      try {
        // Get currently pressed keys
        const currentKeys = getPressedKeys()
        
        // Check if there are changes from the last check
        const hasChanges = !areKeystrokesEqual(currentKeys, lastKeystrokes)
        
        if (hasChanges && currentKeys.length > 0) {
          // Record the keystrokes
          keystrokeTimeline.push({
            timestamp: Date.now(),
            keys: currentKeys
          })
          
          // Update lastKeystrokes
          lastKeystrokes = JSON.parse(JSON.stringify(currentKeys))
          
          // Clean up old data
          const cutoffTime = Date.now() - maxHistory
          keystrokeTimeline = keystrokeTimeline.filter(entry => entry.timestamp >= cutoffTime)
        }
      } catch (error) {
        log.error('Error in keystroke tracking interval:', error)
      }
    }, interval)
    
    isTracking = true
    log.info('Started keystroke tracking')
    return true
  } catch (error) {
    log.error('Error starting keystroke tracking:', error)
    return false
  }
}

/**
 * Stop tracking keystrokes
 * @returns {boolean} Success status
 */
function stopTracking() {
  if (!isTracking) {
    return false
  }
  
  try {
    // Clear the polling interval
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
    
    isTracking = false
    log.info('Stopped keystroke tracking')
    return true
  } catch (error) {
    log.error('Error stopping keystroke tracking:', error)
    return false
  }
}

/**
 * Compare two keystroke arrays for equality
 * @param {Array} keys1 First keystroke array
 * @param {Array} keys2 Second keystroke array
 * @returns {boolean} True if the arrays are equal
 */
function areKeystrokesEqual(keys1, keys2) {
  if (!keys1 || !keys2) return false
  if (keys1.length !== keys2.length) return false
  
  // Sort both arrays by keyCode for consistent comparison
  const sortedKeys1 = [...keys1].sort((a, b) => a.keyCode.localeCompare(b.keyCode))
  const sortedKeys2 = [...keys2].sort((a, b) => a.keyCode.localeCompare(b.keyCode))
  
  for (let i = 0; i < sortedKeys1.length; i++) {
    const key1 = sortedKeys1[i]
    const key2 = sortedKeys2[i]
    
    if (key1.keyCode !== key2.keyCode) {
      return false
    }
  }
  
  return true
}

/**
 * Process the keystroke timeline into a more usable format
 * @param {Array} timeline Raw keystroke timeline (optional, uses stored timeline if not provided)
 * @param {Object} options Processing options
 * @param {number} options.timeSegmentMs Size of time segments in milliseconds (default: 1000)
 * @returns {Array} Processed timeline with keystroke data by time segment
 */
function processTimelineData(timeline = keystrokeTimeline, options = {}) {
  try {
    const timeSegmentMs = options.timeSegmentMs || 1000 // Default: 1 second segments
    
    if (!timeline || timeline.length === 0) {
      return []
    }
    
    // Group timeline data by time segments
    const segments = []
    const segmentMap = {}
    
    // Process all entries
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i]
      const segmentTime = Math.floor(entry.timestamp / timeSegmentMs) * timeSegmentMs
      
      // Get or create segment
      if (!segmentMap[segmentTime]) {
        const segment = {
          startTime: segmentTime,
          endTime: segmentTime + timeSegmentMs - 1,
          keystrokes: []
        }
        segmentMap[segmentTime] = segment
        segments.push(segment)
      }
      
      // Add keys to the segment
      const segment = segmentMap[segmentTime]
      
      entry.keys.forEach(key => {
        // Check if this key is already in the segment
        const existingKey = segment.keystrokes.find(k => k.keyCode === key.keyCode)
        
        if (existingKey) {
          // Increment count for existing key
          existingKey.count += 1
        } else {
          // Add new key to segment
          segment.keystrokes.push({
            keyCode: key.keyCode,
            character: key.character,
            count: 1
          })
        }
      })
    }
    
    // Sort segments by time
    segments.sort((a, b) => a.startTime - b.startTime)
    
    // Sort keystrokes by count (descending) within each segment
    segments.forEach(segment => {
      segment.keystrokes.sort((a, b) => b.count - a.count)
    })
    
    return segments
  } catch (error) {
    log.error('Error processing keystroke timeline:', error)
    return []
  }
}

/**
 * Convert macOS key code to character
 * @param {number} keyCode The macOS key code
 * @returns {string} Character representation or empty string
 */
function getMacKeyCharacter(keyCode) {
  // Basic mapping of common key codes
  const keyMap = {
    0: 'a', 1: 's', 2: 'd', 3: 'f', 4: 'h', 5: 'g', 6: 'z', 7: 'x',
    8: 'c', 9: 'v', 11: 'b', 12: 'q', 13: 'w', 14: 'e', 15: 'r',
    16: 'y', 17: 't', 18: '1', 19: '2', 20: '3', 21: '4', 22: '6',
    23: '5', 24: '=', 25: '9', 26: '7', 27: '-', 28: '8', 29: '0',
    30: ']', 31: 'o', 32: 'u', 33: '[', 34: 'i', 35: 'p', 36: 'Return',
    37: 'l', 38: 'j', 39: '\'', 40: 'k', 41: ';', 42: '\\', 43: ',',
    44: '/', 45: 'n', 46: 'm', 47: '.', 48: 'Tab', 49: 'Space', 50: '`',
    51: 'Delete', 53: 'Escape', 55: 'Command', 56: 'Shift', 57: 'CapsLock',
    58: 'Option', 59: 'Control', 60: 'RShift', 61: 'ROption', 62: 'RControl',
    65: '.', 67: '*', 69: '+', 71: 'Clear', 75: '/', 76: 'Return',
    78: '-', 81: '=', 82: '0', 83: '1', 84: '2', 85: '3', 86: '4',
    87: '5', 88: '6', 89: '7', 91: '8', 92: '9',
    96: 'F5', 97: 'F6', 98: 'F7', 99: 'F3', 100: 'F8', 101: 'F9',
    103: 'F11', 105: 'F13', 107: 'F14', 109: 'F10', 111: 'F12',
    113: 'F15', 114: 'Help', 115: 'Home', 116: 'PageUp', 117: 'ForwardDelete',
    118: 'F4', 119: 'End', 120: 'F2', 121: 'PageDown', 122: 'F1', 123: 'Left',
    124: 'Right', 125: 'Down', 126: 'Up'
  }
  
  return keyMap[keyCode] || ''
}

/**
 * Convert Linux key name to character
 * @param {string} keyName The Linux key name
 * @returns {string} Character representation or empty string
 */
function getLinuxKeyCharacter(keyName) {
  // Basic mapping of common key names
  const keyMap = {
    A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', H: 'h',
    I: 'i', J: 'j', K: 'k', L: 'l', M: 'm', N: 'n', O: 'o', P: 'p',
    Q: 'q', R: 'r', S: 's', T: 't', U: 'u', V: 'v', W: 'w', X: 'x',
    Y: 'y', Z: 'z',
    1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 0: '0',
    MINUS: '-', EQUAL: '=', BACKSPACE: 'Backspace', TAB: 'Tab', SPACE: 'Space',
    LEFTBRACE: '[', RIGHTBRACE: ']', SEMICOLON: ';', APOSTROPHE: '\'',
    GRAVE: '`', BACKSLASH: '\\', COMMA: ',', DOT: '.', SLASH: '/',
    ENTER: 'Enter', LEFTSHIFT: 'Shift', RIGHTSHIFT: 'Shift',
    LEFTCTRL: 'Ctrl', RIGHTCTRL: 'Ctrl', LEFTALT: 'Alt', RIGHTALT: 'Alt',
    CAPSLOCK: 'CapsLock', NUMLOCK: 'NumLock', SCROLLLOCK: 'ScrollLock',
    ESC: 'Esc', HOME: 'Home', END: 'End', PAGEUP: 'PageUp', PAGEDOWN: 'PageDown',
    LEFT: 'Left', RIGHT: 'Right', UP: 'Up', DOWN: 'Down'
  }
  
  return keyMap[keyName] || keyName
}

module.exports = {
  checkPermission,
  getPressedKeys,
  startTracking,
  stopTracking,
  processTimelineData
} 