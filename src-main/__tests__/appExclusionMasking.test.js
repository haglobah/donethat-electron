const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}

const mockScreen = {
  getPrimaryDisplay: jest.fn(() => ({ id: 1 })),
  getAllDisplays: jest.fn(() => [])
}

const mockShouldExcludeWindow = jest.fn((window, excludedApps) => {
  return excludedApps.some((rule) => rule.appName === window.appName)
})

const mockCalculateVisibleRegion = jest.fn(() => [{ x: 10, y: 10, width: 100, height: 80 }])
const mockApplyMaskToImage = jest.fn(async (imageDataUrl) => `masked:${imageDataUrl}`)

jest.mock('electron-log', () => mockLog)
jest.mock('electron', () => ({
  screen: mockScreen,
  app: {
    getPath: jest.fn(() => '/tmp/test-user-data')
  }
}))
jest.mock('../captureWindows', () => ({
  shouldExcludeWindow: (...args) => mockShouldExcludeWindow(...args),
  getAllVisibleWindows: jest.fn()
}))
jest.mock('../windowRegionUtils', () => ({
  calculateVisibleRegion: (...args) => mockCalculateVisibleRegion(...args),
  applyMaskToImage: (...args) => mockApplyMaskToImage(...args)
}))

const {
  __test__: { maskExcludedApps }
} = require('../appExclusionMasking')

describe('app exclusion masking display matching', () => {
  const excludedApps = [{ appName: 'Slack' }]

  beforeEach(() => {
    jest.clearAllMocks()
    mockScreen.getPrimaryDisplay.mockReturnValue({ id: 1 })
  })

  test('matches screenshots to displays by displayId even when order differs', async () => {
    const screenshots = [
      { imageDataUrl: 'shot-display-1', displayId: '1', merged: false },
      { imageDataUrl: 'shot-display-2', displayId: '2', merged: false }
    ]
    const displayBounds = [
      { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } },
      { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }
    ]
    const windowData = [
      {
        appName: 'Slack',
        title: 'Confidential',
        bounds: { x: 10, y: 10, width: 100, height: 80 },
        displayId: '1',
        screen: 1,
        hasActivity: true
      }
    ]

    const result = await maskExcludedApps(screenshots, excludedApps, windowData, displayBounds)

    expect(result).toEqual([
      { imageDataUrl: 'masked:shot-display-1', displayId: '1', merged: false },
      { imageDataUrl: 'shot-display-2', displayId: '2', merged: false }
    ])
    expect(mockApplyMaskToImage).toHaveBeenCalledTimes(1)
    expect(mockApplyMaskToImage).toHaveBeenCalledWith(
      'shot-display-1',
      [{ x: 10, y: 10, width: 100, height: 80 }],
      displayBounds[1].bounds
    )
  })

  test('skips windows with unresolved display instead of masking display 0', async () => {
    const screenshots = [
      { imageDataUrl: 'shot-display-1', displayId: '1', merged: false },
      { imageDataUrl: 'shot-display-2', displayId: '2', merged: false }
    ]
    const displayBounds = [
      { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }
    ]
    const windowData = [
      {
        appName: 'Slack',
        title: 'Unknown display',
        bounds: { x: 50, y: 50, width: 100, height: 80 },
        displayId: null,
        screen: null,
        hasActivity: true
      }
    ]

    const result = await maskExcludedApps(screenshots, excludedApps, windowData, displayBounds)

    expect(result).toEqual(screenshots)
    expect(mockApplyMaskToImage).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalledWith(
      '[app-masking] Skipping excluded window with unresolved display',
      expect.objectContaining({
        appName: 'Slack',
        screenshotDisplayId: 'unresolved',
        skipped: 'true'
      })
    )
  })

  test('falls back to index matching only when the entire capture lacks display IDs', async () => {
    const screenshots = [
      { imageDataUrl: 'shot-0', displayId: null, merged: false },
      { imageDataUrl: 'shot-1', displayId: null, merged: false }
    ]
    const displayBounds = [
      { id: 10, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 11, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }
    ]
    const windowData = [
      {
        appName: 'Slack',
        title: 'Fallback display',
        bounds: { x: 1050, y: 50, width: 100, height: 80 },
        displayId: null,
        screen: 1,
        hasActivity: true
      }
    ]

    const result = await maskExcludedApps(screenshots, excludedApps, windowData, displayBounds)

    expect(result).toEqual([
      { imageDataUrl: 'shot-0', displayId: null, merged: false },
      { imageDataUrl: 'masked:shot-1', displayId: null, merged: false }
    ])
    expect(mockLog.warn).toHaveBeenCalledWith(
      '[app-masking] Falling back to index-based screenshot matching',
      expect.objectContaining({
        screenshotCount: '2',
        displayCount: '2'
      })
    )
  })

  test('preserves best-effort index fallback for partial legacy screenshot arrays', async () => {
    const screenshots = ['legacy-shot-0']
    const displayBounds = [
      { id: 10, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 11, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }
    ]
    const windowData = [
      {
        appName: 'Slack',
        title: 'Partial legacy capture',
        bounds: { x: 50, y: 50, width: 100, height: 80 },
        displayId: null,
        screen: 0,
        hasActivity: true
      }
    ]

    const result = await maskExcludedApps(screenshots, excludedApps, windowData, displayBounds)

    expect(result).toEqual([
      { imageDataUrl: 'masked:legacy-shot-0', displayId: null, merged: false }
    ])
    expect(mockApplyMaskToImage).toHaveBeenCalledTimes(1)
  })

  test('keeps merged screenshot masking working for Linux-style merged captures', async () => {
    const screenshots = [
      { imageDataUrl: 'merged-shot', displayId: null, merged: true }
    ]
    const displayBounds = [
      { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }
    ]
    const windowData = [
      {
        appName: 'Slack',
        title: 'Merged display',
        bounds: { x: 1050, y: 50, width: 100, height: 80 },
        displayId: '2',
        screen: 1,
        hasActivity: true
      }
    ]

    const result = await maskExcludedApps(screenshots, excludedApps, windowData, displayBounds)

    expect(result).toEqual([
      { imageDataUrl: 'masked:merged-shot', displayId: null, merged: true }
    ])
    expect(mockApplyMaskToImage).toHaveBeenCalledWith(
      'merged-shot',
      [{ x: 10, y: 10, width: 100, height: 80 }],
      { x: 0, y: 0, width: 2000, height: 800 }
    )
  })

  test('keeps the single-display masking path unchanged', async () => {
    const screenshots = [
      { imageDataUrl: 'single-shot', displayId: '1', merged: false }
    ]
    const displayBounds = [
      { id: 1, bounds: { x: 0, y: 0, width: 1200, height: 900 } }
    ]
    const windowData = [
      {
        appName: 'Slack',
        title: 'Single display',
        bounds: { x: 100, y: 100, width: 300, height: 200 },
        displayId: '1',
        screen: 0,
        hasActivity: true
      }
    ]

    const result = await maskExcludedApps(screenshots, excludedApps, windowData, displayBounds)

    expect(result).toEqual([
      { imageDataUrl: 'masked:single-shot', displayId: '1', merged: false }
    ])
  })
})
