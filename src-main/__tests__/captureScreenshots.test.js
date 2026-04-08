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

const {
  captureScreenshot,
  captureScreenshotDetailed
} = require('../captureScreenshots')

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
