# Comprehensive Testing Guide - Agent0 + Subgraph

This guide covers all available tests you can run to verify the Arweave integration.

---

## Agent0-TS Repository Tests

### 1. Unit Tests (No Environment Required) ✅

These tests run without blockchain/IPFS/Arweave access and verify pure logic.

#### A. Arweave Tag Generation
```bash
npm test -- --testPathPattern="arweave-tags"
```
**Tests:** 31 tests covering tag generation for registrations and feedback
**Status:** ✅ 31/31 passing
**What it verifies:**
- Correct tag structure (Content-Type, App-Name, Protocol, etc.)
- Optional vs required tags
- Edge cases (empty strings, zero scores, different chains)
- ISO 8601 timestamp format

#### B. Registration Format Utilities
```bash
npm test -- --testPathPattern="registration-format"
```
**Tests:** 10 tests covering ERC-8004 format conversion
**Status:** ✅ 10/10 passing
**What it verifies:**
- Shared formatter works for both IPFS and Arweave
- Wallet address formatting (eip155:chainId:address)
- Trust model handling
- Registry metadata inclusion

#### C. Endpoint Crawler
```bash
npm test -- --testPathPattern="endpoint-crawler"
```
**Tests:** MCP/A2A endpoint crawling logic
**What it verifies:**
- JSON-RPC endpoint discovery
- Agentcard.json fallback
- Timeout handling
- Capability extraction

**Run all unit tests:**
```bash
npm test -- --testPathPattern="(arweave-tags|registration-format|endpoint-crawler)"
```

---

### 2. Integration Tests (Requires Environment Setup) ⚠️

These tests interact with real blockchain, IPFS, and Arweave services.

#### Prerequisites: Create `.env` file
```bash
# .env (in agent0-ts root)
CHAIN_ID=11155111
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY_HERE
AGENT_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
ARWEAVE_PRIVATE_KEY=0xYOUR_EVM_KEY_HERE  # Optional, defaults to AGENT_PRIVATE_KEY
PINATA_JWT=YOUR_PINATA_JWT_HERE
SUBGRAPH_URL=https://gateway.thegraph.com/api/.../subgraphs/id/...
```

#### A. IPFS Registration Flow
```bash
npm test -- --testPathPattern="registration-ipfs" --verbose
```
**What it tests:**
- Complete IPFS registration flow
- Upload to Pinata
- On-chain URI setting
- Agent reload from IPFS
- Update flow

**Expected time:** ~60 seconds (blockchain confirmations)

#### B. Arweave Registration Flow ⭐ NEW
```bash
npm test -- --testPathPattern="registration-arweave" --verbose
```
**What it tests:**
- Complete Arweave registration flow
- Upload to Arweave via Turbo SDK
- Tag generation and signing
- On-chain URI setting (ar://)
- Agent reload from Arweave
- Update flow
- Race condition prevention

**Expected time:** ~60 seconds (blockchain confirmations)

#### C. HTTP Registration Flow
```bash
npm test -- --testPathPattern="registration-http" --verbose
```
**What it tests:**
- Registration with custom HTTP URI
- Direct HTTP URI setting on-chain

#### D. Feedback System
```bash
npm test -- --testPathPattern="feedback" --verbose
```
**What it tests:**
- Feedback submission with Arweave/IPFS storage
- Storage priority (Arweave → IPFS → on-chain)
- Feedback authorization
- Feedback revocation
- Response appending

**Expected time:** ~90 seconds

#### E. Agent Transfer
```bash
npm test -- --testPathPattern="transfer" --verbose
```
**What it tests:**
- Agent ownership transfer (ERC-721)
- Transfer validation

#### F. Search & Discovery
```bash
npm test -- --testPathPattern="search" --verbose
```
**What it tests:**
- Subgraph queries
- Agent search by capabilities
- Filtering by MCP/A2A/Wallet

**Run all integration tests:**
```bash
npm test
```

---

### 3. Manual Testing Scenarios (Recommended)

#### Scenario A: Basic Arweave Registration
```typescript
// test-arweave-basic.ts
import { SDK } from './src/core/sdk';

async function testBasicRegistration() {
  const sdk = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL!,
    signer: process.env.AGENT_PRIVATE_KEY!,
    subgraphUrl: process.env.SUBGRAPH_URL!,
    arweave: true
  });

  const agent = sdk.createAgent();
  agent.setName('Test Agent ' + Date.now());
  agent.setDescription('Testing Arweave integration');
  agent.setMCP('https://mcp.example.com');

  console.log('Registering agent on Arweave...');
  const result = await agent.registerArweave();

  console.log('✅ Registered!');
  console.log('Agent ID:', result.agentId);
  console.log('Agent URI:', result.agentURI);

  // Wait for subgraph indexing
  console.log('Waiting 30s for subgraph indexing...');
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Reload from Arweave
  console.log('Reloading agent from Arweave...');
  const reloaded = await sdk.loadAgent(result.agentId!);
  console.log('✅ Reloaded successfully!');
  console.log('Name:', reloaded.name);
  console.log('MCP:', reloaded.endpoints?.find(e => e.type === 'MCP')?.value);
}

testBasicRegistration().catch(console.error);
```

Run with: `npx ts-node test-arweave-basic.ts`

#### Scenario B: Parallel Gateway Testing
```typescript
// test-gateway-resilience.ts
import { ArweaveClient } from './src/core/arweave-client';

async function testGatewayResilience() {
  const client = new ArweaveClient({
    privateKey: process.env.AGENT_PRIVATE_KEY!
  });

  // Upload test file
  const testData = { test: 'data', timestamp: Date.now() };
  console.log('Uploading to Arweave...');
  const txId = await client.addJson(testData);
  console.log('✅ Uploaded:', txId);

  // Test parallel gateway retrieval
  console.log('Testing parallel gateway retrieval...');
  const startTime = Date.now();
  const retrieved = await client.getJson(txId);
  const duration = Date.now() - startTime;

  console.log('✅ Retrieved in', duration, 'ms');
  console.log('Data matches:', JSON.stringify(retrieved) === JSON.stringify(testData));

  // Should be <500ms due to parallel fetching
  if (duration < 500) {
    console.log('✅ Parallel gateway optimization working!');
  } else {
    console.log('⚠️ Slow retrieval - check gateways');
  }
}

testGatewayResilience().catch(console.error);
```

#### Scenario C: Race Condition Prevention
```typescript
// test-race-condition.ts
import { SDK } from './src/core/sdk';

async function testRaceCondition() {
  const sdk = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL!,
    signer: process.env.AGENT_PRIVATE_KEY!,
    arweave: true
  });

  const agent = sdk.createAgent();
  agent.setName('Race Test ' + Date.now());
  agent.setDescription('Testing concurrent registration prevention');

  console.log('Attempting concurrent registrations...');

  try {
    const p1 = agent.registerArweave();
    const p2 = agent.registerArweave();  // Should throw immediately

    await Promise.all([p1, p2]);
    console.log('❌ FAILED: Both registrations succeeded (race condition not prevented)');
  } catch (error) {
    if (error instanceof Error && error.message.includes('already in progress')) {
      console.log('✅ PASSED: Race condition prevented');
      console.log('Error message:', error.message);
    } else {
      console.log('❌ FAILED: Wrong error:', error);
    }
  }
}

testRaceCondition().catch(console.error);
```

#### Scenario D: Storage Priority Testing
```typescript
// test-storage-priority.ts
import { SDK } from './src/core/sdk';

async function testStoragePriority() {
  // Test 1: Arweave only
  const sdkArweave = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL!,
    signer: process.env.AGENT_PRIVATE_KEY!,
    arweave: true
  });

  // Give feedback - should use Arweave
  console.log('Test 1: Arweave only...');
  const feedback1 = await sdkArweave.feedbackManager.giveFeedback(
    '11155111:374',
    { score: 95, text: 'Test feedback' }
  );
  console.log(feedback1.feedbackUri?.startsWith('ar://') ? '✅ Used Arweave' : '❌ Did not use Arweave');

  // Test 2: Both Arweave and IPFS (Arweave should take priority)
  const sdkBoth = new SDK({
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL!,
    signer: process.env.AGENT_PRIVATE_KEY!,
    arweave: true,
    ipfs: { pinataEnabled: true, pinataJwt: process.env.PINATA_JWT! }
  });

  console.log('Test 2: Both configured (Arweave should win)...');
  const feedback2 = await sdkBoth.feedbackManager.giveFeedback(
    '11155111:374',
    { score: 90, text: 'Priority test' }
  );
  console.log(feedback2.feedbackUri?.startsWith('ar://') ? '✅ Arweave took priority' : '⚠️ IPFS used instead');
}

testStoragePriority().catch(console.error);
```

---

## Subgraph Repository Tests

### 1. Build Verification
```bash
cd ../subgraph
npm run codegen
npm run build
```
**What it verifies:**
- Schema is valid
- TypeScript mappings compile
- All data sources configured correctly

**Expected output:**
```
✔ Generate
✔ Compile
✔ Write to build/
```

### 2. Graph Test Framework (if available)
```bash
cd ../subgraph
npm test
```
**What it tests:**
- Event handler logic
- Entity creation
- Data source template triggering

**Note:** Check if `tests/` directory exists in subgraph repo

### 3. Local Graph Node Testing

#### Setup Local Graph Node
```bash
# In subgraph directory
docker-compose up -d  # Uses compose.yml
```

This starts:
- Graph Node
- IPFS (for subgraph deployment)
- PostgreSQL (for indexed data)

#### Deploy Locally
```bash
npm run create-local
npm run deploy-local
```

#### Test Queries
```bash
# Query local endpoint
curl -X POST http://localhost:8000/subgraphs/name/agent0-sdk/agent0-sdk \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ agents(first: 5) { id agentId agentURI agentURIType } }"
  }'
```

#### Verify Arweave Indexing
```bash
# Check logs for Arweave data source triggers
docker logs graph-node | grep "ArweaveRegistrationFile"

# Should see:
# "Triggering data source: ArweaveRegistrationFile"
# "Processing Arweave file: ar://..."
```

---

## Performance Benchmarking

### 1. Upload Speed Test
```typescript
// benchmark-upload.ts
import { ArweaveClient } from './src/core/arweave-client';

async function benchmarkUpload() {
  const client = new ArweaveClient({
    privateKey: process.env.AGENT_PRIVATE_KEY!
  });

  const sizes = [
    { name: 'Tiny (1KB)', data: 'x'.repeat(1024) },
    { name: 'Small (10KB)', data: 'x'.repeat(10240) },
    { name: 'Medium (50KB)', data: 'x'.repeat(51200) },
    { name: 'Large (99KB)', data: 'x'.repeat(99 * 1024) }
  ];

  for (const test of sizes) {
    const start = Date.now();
    await client.addJson({ data: test.data });
    const duration = Date.now() - start;
    console.log(`${test.name}: ${duration}ms`);
  }
}
```

### 2. Gateway Response Time
```typescript
// benchmark-gateways.ts
import { ARWEAVE_GATEWAYS } from './src/utils/constants';

async function benchmarkGateways() {
  const txId = 'YOUR_TEST_TXID_HERE';

  for (const gateway of ARWEAVE_GATEWAYS) {
    const start = Date.now();
    try {
      const response = await fetch(`${gateway}/${txId}`);
      const duration = Date.now() - start;
      console.log(`${gateway}: ${duration}ms (${response.ok ? 'OK' : 'FAILED'})`);
    } catch (error) {
      console.log(`${gateway}: FAILED (${error})`);
    }
  }
}
```

---

## Continuous Integration Tests

### GitHub Actions / CI Pipeline

Create `.github/workflows/test.yml`:
```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test -- --testPathPattern="(arweave-tags|registration-format|endpoint-crawler)"

      - name: Check TypeScript compilation
        run: npm run build

  integration-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        env:
          CHAIN_ID: ${{ secrets.CHAIN_ID }}
          RPC_URL: ${{ secrets.RPC_URL }}
          AGENT_PRIVATE_KEY: ${{ secrets.AGENT_PRIVATE_KEY }}
          SUBGRAPH_URL: ${{ secrets.SUBGRAPH_URL }}
        run: npm test
```

---

## Test Coverage Report

```bash
# Generate coverage report
npm run test:coverage

# View in browser
open coverage/lcov-report/index.html
```

**Target Coverage:**
- Unit tests: 100% for new Arweave code
- Integration tests: All critical paths

---

## Quick Test Checklist

### Before Merge:
- [ ] All unit tests passing (41/41)
- [ ] TypeScript compiles without errors
- [ ] Documentation updated (CLAUDE.md)
- [ ] At least one manual integration test successful

### Before Production:
- [ ] All integration tests passing with real keys
- [ ] Subgraph builds and deploys successfully
- [ ] Performance benchmarks meet targets (<3s uploads, <500ms retrievals)
- [ ] Race condition prevention verified
- [ ] Gateway fallback verified (test with 1 gateway down)

---

## Troubleshooting Common Test Failures

### Issue: "Cannot find module '../subgraph'"
**Solution:** Ensure subgraph repo is cloned at `../subgraph`
```bash
cd ..
git clone https://github.com/kempsterrrr/subgraph
cd subgraph
git checkout feat/arweave-integration
```

### Issue: "Arweave client not configured"
**Solution:** Add `arweave: true` to SDK config

### Issue: "Failed to retrieve from all gateways"
**Solution:**
1. Check internet connection
2. Verify txId is valid
3. Check ARWEAVE_GATEWAYS in constants.ts

### Issue: Integration tests timeout
**Solution:**
1. Increase timeout in jest.config.js (currently 120s)
2. Check RPC endpoint is responsive
3. Ensure sufficient Sepolia ETH in test wallet

---

## Reporting Test Results

When reporting test results, include:
1. Test command run
2. Pass/fail counts
3. Error messages (if any)
4. Environment (Node version, OS)
5. Timing information

**Example:**
```
Command: npm test -- --testPathPattern="arweave-tags"
Result: ✅ 31/31 passing
Duration: 4.2s
Environment: Node 18.17.0, Windows 11
```

---

**Happy Testing! 🚀**

If you encounter any issues during testing, refer to the troubleshooting section or reach out for support.
