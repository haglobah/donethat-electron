jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../main-state', () => ({
  getGeminiApiKey: jest.fn(),
  getOpenAICompatibleConfig: jest.fn(),
  getMainWindow: jest.fn()
}));

const {
  buildLocalProcessingNotification,
  isTransientLocalProcessingError,
  formatLocalProcessingErrorForUser
} = require('../processLocal');

describe('local processing notifications', () => {
  test('downgrades transport failures to in-app-only connection banners', () => {
    const error = new Error('Network error while contacting provider.');
    error.cause = new TypeError('temporary DNS lookup issue');
    error.cause.code = 'EAI_AGAIN';

    expect(isTransientLocalProcessingError(error)).toBe(true);

    expect(buildLocalProcessingNotification(error)).toEqual({
      id: 'local-processing-connection-issue',
      title: 'Connection issue',
      message: 'Could not reach the local AI provider. DoneThat will try again on the next capture.',
      sticky: false,
      noFocus: true,
      alsoNative: false
    });
  });

  test('does not treat provider 404 pages as transient just because the body says not found', () => {
    const error = new Error([
      '<!DOCTYPE html><html><body>Not Found | OpenRouter</body></html>',
      'Troubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/MODEL_NOT_FOUND/'
    ].join('\n'));
    error.status = 404;

    expect(isTransientLocalProcessingError(error)).toBe(false);
    expect(buildLocalProcessingNotification(error)).toEqual({
      id: 'local-processing-error',
      title: 'Local processing error',
      message: formatLocalProcessingErrorForUser(error),
      sticky: true,
      alsoNative: true
    });
  });

  test('treats ENOTFOUND as non-transient so bad hostnames still notify natively', () => {
    const error = new Error('Connection error.');
    error.cause = new TypeError('fetch failed');
    error.cause.code = 'ENOTFOUND';

    expect(isTransientLocalProcessingError(error)).toBe(false);
    expect(buildLocalProcessingNotification(error).alsoNative).toBe(true);
  });
});
