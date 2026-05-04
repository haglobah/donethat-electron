const mockGetScreenSources = jest.fn()
const mockCreateFromBuffer = jest.fn()

const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}

const mockStore = {
  get: jest.fn(),
  set: jest.fn()
}

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
Object.defineProperty(process, 'platform', {
  value: 'darwin',
  configurable: true
})

jest.mock('electron-log', () => mockLog)
jest.mock('electron-store', () => ({
  __esModule: true,
  default: jest.fn(() => mockStore)
}))
jest.mock('../screenCaptureSemaphore', () => ({
  getScreenSources: (...args) => mockGetScreenSources(...args)
}))
jest.mock('../telemetry', () => ({
  recordPermissionCheck: jest.fn()
}))
jest.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (...args) => mockCreateFromBuffer(...args)
  },
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn()
  },
  shell: {
    openExternal: jest.fn()
  },
  app: {
    getPath: jest.fn(() => '/tmp/test-user-data')
  }
}))

const expectedImageDataUrl = `data:image/jpeg;base64,${Buffer.from('jpeg-image').toString('base64')}`

const { recordPermissionCheck } = require('../telemetry')

const {
  captureScreenshot,
  captureScreenshotDetailed,
  checkScreenCapturePermission
} = require('../captureScreenshots')

const minimalScreenSource = {
  id: 'screen-1',
  name: 'Display 1',
  display_id: '0',
  thumbnail: {
    getSize: () => ({ width: 1, height: 1 }),
    toDataURL: () => 'data:image/png;base64,AA'
  }
}

describe('captureScreenshot detailed metadata', () => {
  afterAll(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockStore.get.mockReturnValue(undefined)
    mockCreateFromBuffer.mockReturnValue({
      getSize: () => ({ width: 1000, height: 700 }),
      resize() {
        return this
      },
      toJPEG: () => Buffer.from('jpeg-image')
    })
  })

  test('returns detailed screenshot entries with normalized display IDs while keeping public API unchanged', async () => {
    mockGetScreenSources.mockResolvedValue([
      {
        id: 'screen-b',
        name: 'Display B',
        display_id: 200,
        thumbnail: {
          toDataURL: () => 'data:image/png;base64,AAAA',
          getSize: () => ({ width: 1920, height: 1080 })
        }
      },
      {
        id: 'screen-a',
        name: 'Display A',
        display_id: '100',
        thumbnail: {
          toDataURL: () => 'data:image/png;base64,AAAA',
          getSize: () => ({ width: 1920, height: 1080 })
        }
      }
    ])

    const detailedScreenshots = await captureScreenshotDetailed({ caller: 'unit-test' })
    const publicScreenshots = await captureScreenshot({ caller: 'unit-test' })

    expect(detailedScreenshots).toEqual([
      { imageDataUrl: expectedImageDataUrl, displayId: '200', merged: false },
      { imageDataUrl: expectedImageDataUrl, displayId: '100', merged: false }
    ])
    expect(publicScreenshots).toEqual([
      expectedImageDataUrl,
      expectedImageDataUrl
    ])
  })
})

describe('checkScreenCapturePermission (desktopCapturer probe)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetScreenSources.mockReset()
    mockStore.get.mockReturnValue(undefined)
    mockCreateFromBuffer.mockReturnValue({
      getSize: () => ({ width: 1000, height: 700 }),
      resize() {
        return this
      },
      toJPEG: () => Buffer.from('jpeg-image')
    })
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    }
  })

  afterEach(() => {
    jest.useRealTimers()
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor)
    }
  })

  test('grants after timeout then sources', async () => {
    jest.useFakeTimers()
    mockGetScreenSources
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([minimalScreenSource])

    const pending = checkScreenCapturePermission('unit-timeout-retry')
    await jest.advanceTimersByTimeAsync(400)
    const result = await pending

    expect(result).toBe(true)
    expect(mockGetScreenSources).toHaveBeenCalledTimes(2)
    expect(recordPermissionCheck).toHaveBeenLastCalledWith(
      'screen',
      'unit-timeout-retry',
      'granted',
      expect.any(Number)
    )
  })

  test('empty sources are retried until attempts exhausted', async () => {
    jest.useFakeTimers()
    mockGetScreenSources.mockResolvedValue([])

    const pending = checkScreenCapturePermission('unit-empty')
    await jest.advanceTimersByTimeAsync(400 + 800 + 1600 + 2000)
    const result = await pending

    expect(result).toBe(false)
    expect(mockGetScreenSources).toHaveBeenCalledTimes(4)
    expect(recordPermissionCheck).toHaveBeenLastCalledWith(
      'screen',
      'unit-empty',
      'denied',
      expect.any(Number)
    )
  })

  test('all attempts time out yields undefined', async () => {
    jest.useFakeTimers()
    mockGetScreenSources.mockResolvedValue(null)

    const pending = checkScreenCapturePermission('unit-all-timeout')
    await jest.advanceTimersByTimeAsync(400 + 800 + 1600 + 2000)
    const result = await pending

    expect(result).toBeUndefined()
    expect(mockGetScreenSources).toHaveBeenCalledTimes(4)
    expect(recordPermissionCheck).toHaveBeenLastCalledWith(
      'screen',
      'unit-all-timeout',
      'skipped_busy',
      expect.any(Number)
    )
  })

  test('retries empty sources before granting', async () => {
    jest.useFakeTimers()
    mockGetScreenSources
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([minimalScreenSource])

    const pending = checkScreenCapturePermission('unit-empty-then-grant')
    await jest.advanceTimersByTimeAsync(400)
    const result = await pending

    expect(result).toBe(true)
    expect(mockGetScreenSources).toHaveBeenCalledTimes(2)
  })
})
