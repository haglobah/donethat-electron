const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}

jest.mock('electron-log', () => mockLog)
jest.mock('get-windows', () => ({
  activeWindow: jest.fn(),
  openWindows: jest.fn()
}))
jest.mock('../telemetry', () => ({
  recordPermissionCheck: jest.fn(),
  recordActiveWindowProbeTimeout: jest.fn()
}))
jest.mock('electron', () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: jest.fn(() => true)
  },
  ipcMain: {
    on: jest.fn()
  },
  shell: {
    openExternal: jest.fn()
  },
  app: {
    on: jest.fn(),
    removeListener: jest.fn()
  },
  screen: {
    screenToDipRect: jest.fn((_display, bounds) => bounds),
    getDisplayMatching: jest.fn(() => ({ id: 1, scaleFactor: 1 })),
    getAllDisplays: jest.fn(() => [{ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }])
  }
}))

const captureWindows = require('../captureWindows')

describe('captureWindows timeline sanitization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    captureWindows.__test__.resetState()
  })

  test('getTimelineBuffer strips displayId from returned activity entries', () => {
    captureWindows.__test__.setWindowTimeline([
      {
        timestamp: new Date().toISOString(),
        title: 'Window Title',
        app: 'Slack',
        executable: '/Applications/Slack.app',
        bounds: { x: 10, y: 20, width: 100, height: 80 },
        displayId: '123',
        screen: 1
      }
    ])
    captureWindows.__test__.setTrackingState(true)

    const result = captureWindows.getTimelineBuffer(5 * 60 * 1000, false)

    expect(result).toEqual([
      {
        timestamp: expect.any(String),
        title: 'Window Title',
        app: 'Slack',
        executable: '/Applications/Slack.app'
      }
    ])
    expect(result[0].displayId).toBeUndefined()
  })
})
