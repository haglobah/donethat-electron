const mockCaptureScreenshotDetailed = jest.fn()
const mockCropRegionFromImage = jest.fn()
const mockCalculateVisibleRegion = jest.fn()
const mockGetStore = jest.fn()
const mockConvertBoundsToDIP = jest.fn((bounds) => bounds)

jest.mock('../captureScreenshots', () => ({
  captureScreenshotDetailed: (...args) => mockCaptureScreenshotDetailed(...args)
}))
jest.mock('../windowRegionUtils', () => ({
  calculateVisibleRegion: (...args) => mockCalculateVisibleRegion(...args),
  cropRegionFromImage: (...args) => mockCropRegionFromImage(...args)
}))
jest.mock('../captureDump', () => ({
  getBasePath: jest.fn(),
  getStore: (...args) => mockGetStore(...args)
}))
jest.mock('../captureWindows', () => ({
  shouldIncludeForContext: jest.fn(() => true),
  getActiveWindowSafe: jest.fn(),
  normalizeAppName: jest.fn((name) => String(name || '').toLowerCase()),
  convertBoundsToDIP: (...args) => mockConvertBoundsToDIP(...args)
}))

const mockScreen = {
  getAllDisplays: jest.fn(),
  getPrimaryDisplay: jest.fn(),
  getDisplayMatching: jest.fn()
}

jest.mock('electron', () => ({
  screen: mockScreen
}))

const {
  __test__: { captureContextForActiveWindow }
} = require('../contextCapture')

describe('context capture display selection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetStore.mockResolvedValue({
      get: jest.fn((key) => {
        if (key === 'contextApps') return [{ appName: 'Slack' }]
        return null
      })
    })
    mockCalculateVisibleRegion.mockReturnValue([{ x: 10, y: 10, width: 50, height: 40 }])
    mockCropRegionFromImage.mockResolvedValue('cropped-image')
  })

  test('selects the screenshot whose displayId matches the target window display', async () => {
    mockCaptureScreenshotDetailed.mockResolvedValue([
      { imageDataUrl: 'display-2-shot', displayId: '2', merged: false },
      { imageDataUrl: 'display-1-shot', displayId: '1', merged: false }
    ])
    mockScreen.getAllDisplays.mockReturnValue([
      { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } }
    ])
    mockScreen.getPrimaryDisplay.mockReturnValue({ id: 1 })
    mockScreen.getDisplayMatching.mockReturnValue({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } })

    const result = await captureContextForActiveWindow({
      title: 'Slack DM',
      bounds: { x: 50, y: 40, width: 400, height: 300 },
      owner: { name: 'Slack' }
    })

    expect(result).toEqual({
      appName: 'Slack',
      title: 'Slack DM',
      base64Data: 'cropped-image'
    })
    expect(mockCropRegionFromImage).toHaveBeenCalledWith(
      'display-1-shot',
      [{ x: 10, y: 10, width: 50, height: 40 }],
      { x: 0, y: 0, width: 1000, height: 800 },
      800
    )
  })
})
