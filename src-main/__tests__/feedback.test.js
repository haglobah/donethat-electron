const mockGetScreenSources = jest.fn()
const mockGetFocusedWindow = jest.fn()
const mockCreateFromBuffer = jest.fn()

jest.mock('../screenCaptureSemaphore', () => ({
  getScreenSources: (...args) => mockGetScreenSources(...args)
}))

const mockLog = {
  warn: jest.fn(),
  error: jest.fn()
}

const mockScreen = {
  getAllDisplays: jest.fn()
}

const mockBrowserWindow = {
  getFocusedWindow: (...args) => mockGetFocusedWindow(...args)
}

jest.mock('electron-log', () => mockLog)
jest.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (...args) => mockCreateFromBuffer(...args)
  },
  screen: mockScreen,
  BrowserWindow: mockBrowserWindow
}))

const { captureFeedbackScreenshot } = require('../feedback')

describe('feedback screenshot display selection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateFromBuffer.mockReturnValue({
      getSize: () => ({ width: 1000, height: 700 }),
      resize() {
        return this
      },
      toJPEG: () => Buffer.from('jpeg-image')
    })
  })

  test('matches the focused window display to the source by display_id instead of index', async () => {
    mockGetScreenSources.mockResolvedValue([
      {
        display_id: '2',
        thumbnail: {
          toDataURL: () => 'data:image/png;base64,AAAA'
        }
      },
      {
        display_id: '1',
        thumbnail: {
          toDataURL: () => 'data:image/png;base64,AAAA'
        }
      }
    ])
    mockGetFocusedWindow.mockReturnValue({
      getBounds: () => ({ x: 100, y: 100, width: 300, height: 200 })
    })
    mockScreen.getAllDisplays.mockReturnValue([
      { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 } },
      { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } }
    ])

    const result = await captureFeedbackScreenshot(null)

    expect(result).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg-image').toString('base64')}`)
  })
})
