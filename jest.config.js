export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        types: ['jest', 'node'],
        isolatedModules: true,
      },
      useESM: true,
      diagnostics: {
        ignoreCodes: [151002],
      },
    }],
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 120000, // 2 minutes for integration tests with blockchain operations
  maxWorkers: 1, // Run tests sequentially to avoid nonce conflicts
  moduleNameMapper: {
    '^(\\.\\.?/src/.*)\\.js$': '$1.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(ipfs-http-client)/)',
  ],
};
