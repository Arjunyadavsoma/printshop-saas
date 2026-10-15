#!/usr/bin/env bun
/**
 * Standalone seed script (spec §13). Creates the demo shop "QuickPrint" with
 * an owner login + dev payment credentials, idempotent. Run with:
 *   bun run scripts/seed.ts
 * (The API also exposes POST /api/v1/dev/seed which calls the same code.)
 */
import { seedDemoData } from '../src/lib/services/seed.service';

const result = await seedDemoData();
console.log('Seed complete:');
console.log(JSON.stringify(result, null, 2));
console.log(`\nLogin:  owner@quickprint.demo / ${result.password}`);
process.exit(0);
