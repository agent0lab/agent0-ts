# Release Notes: Agent0 SDK v0.2.2

## New Features

### Added Owner and Operator Filtering in Agent Search

- Search agents by owner address(es) using `owners` parameter
- Search agents by operator address(es) using `operators` parameter
- Supports single or multiple addresses for filtering
- Can be combined with other search filters (name, active status, etc.)

**Example:**
```typescript
// Search by single owner
const results = await sdk.searchAgents({ owners: ['0x...'] });

// Search by multiple owners
const results = await sdk.searchAgents({ 
  owners: ['0x...', '0x...'] 
});

// Combined with other filters
const results = await sdk.searchAgents({ 
  owners: ['0x...'],
  active: true,
  name: 'Test'
});
```

## Security Fixes

### Fixed npm Security Vulnerabilities

Fixed 5 npm security vulnerabilities (2 moderate, 3 high) by adding npm overrides for transitive dependencies:

- Updated `nanoid` to `^5.1.6` (fixes CVE in nanoid generation)
- Updated `parse-duration` to `^2.1.3` (fixes Regex DoS vulnerability)
- All dependencies now pass `npm audit` with 0 vulnerabilities

## Build Improvements

### Automatic Type Generation

- Added `postinstall` script to automatically generate TypeScript types after `npm install`
- Fixed build errors when running `tsc` directly or after fresh clones
- Generated types are now created automatically, improving developer experience

## Documentation

- Updated README with build process clarification
- Added note explaining that types are generated automatically and to use `npm run build` instead of `tsc` directly

## Technical Details

- Added npm `overrides` field to `package.json` to force secure versions of transitive dependencies
- Improved build reliability by ensuring codegen runs before any TypeScript compilation

---

## Upgrade Instructions

No breaking changes. Upgrade with:

```bash
npm install agent0-sdk@0.2.2
```

## Full Changelog

- [#4](https://github.com/agent0lab/agent0-ts/pull/4) - Added filtering by owner and operator addresses
- [#1](https://github.com/agent0lab/agent0-ts/issues/1) - Fixed npm security vulnerabilities
- [#1](https://github.com/agent0lab/agent0-ts/issues/1) - Fixed TypeScript build errors for fresh clones

