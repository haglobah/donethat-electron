module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src-main'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src-main/**/*.js',
    '!src-main/__tests__/**',
    '!src-main/**/*.test.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  forceExit: true
};

