# Release Notes: Agent0 SDK v0.2.3

## ESM Package

This package is now a native ESM (ECMAScript Module) package. Use `import` statements in your code:

```typescript
import { SDK } from 'agent0-sdk';
```

**Note:** This package no longer supports CommonJS (`require()`). If you're using CommonJS, you'll need to migrate to ESM or use dynamic imports.

---

## Upgrade Instructions

```bash
npm install agent0-sdk@0.2.3
```

