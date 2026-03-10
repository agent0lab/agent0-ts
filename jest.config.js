export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: ['jest', 'node'],
      },
      useESM: true,
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
  testTimeout: 300000, // 5 minutes for integration tests with blockchain operations
  maxWorkers: 1, // Run tests sequentially to avoid nonce conflicts
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    // Allow ESM dependencies we import (directly or via dynamic import) to be loaded correctly in Jest.
    'node_modules/(?!(helia|@helia|multiformats|kubo-rpc-client)/)',
  ],
};

