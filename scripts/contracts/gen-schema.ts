/**
 * Generates docs/integration/companion-v1.schema.json from
 * src/lib/contracts/companion.ts (Zod v4 → JSON Schema, no extra deps).
 *
 * Run:  bun scripts/contracts/gen-schema.ts
 * The output must be committed AND copied byte-identical into the PrintEXE
 * repo (docs/contracts/companion-v1.schema.json). The contract tests in both
 * repos fail when this artifact and the code drift apart.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  ROUTES,
  SCHEMAS,
  SOCKET_CLIENT_EVENTS,
  SOCKET_SERVER_EVENTS,
} from '../../src/lib/contracts/companion';
import { EXAMPLES } from '../../src/lib/contracts/companion.examples';

const REQUEST_SCHEMAS = new Set([
  'pairRequest',
  'heartbeatRequest',
  'commandAckRequest',
  'commandIssueRequest',
  'jobStatusRequest',
  'jobReceivedRequest',
]);

const definitions: Record<string, unknown> = {};
for (const [name, schema] of Object.entries(SCHEMAS)) {
  definitions[name] = z.toJSONSchema(schema as z.ZodType, {
    io: REQUEST_SCHEMAS.has(name) ? 'input' : 'output',
    target: 'draft-2020-12',
  });
}

const artifact = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  contractVersion: CONTRACT_VERSION,
  title: 'PrintShop Companion API Contract v1',
  $comment:
    'GENERATED FILE — do not edit by hand. Source: src/lib/contracts/companion.ts (saas repo). Regenerate with `bun scripts/contracts/gen-schema.ts`, then copy byte-identical into the PrintEXE repo at docs/contracts/companion-v1.schema.json. Human contract: docs/integration/COMPANION_V1_CONTRACT.md.',
  definitions,
  routes: ROUTES,
  socketEvents: { server: SOCKET_SERVER_EVENTS, client: SOCKET_CLIENT_EVENTS },
  examples: EXAMPLES,
};

const repoRoot = join(import.meta.dir, '..', '..');
const outPath = join(repoRoot, 'docs', 'integration', 'companion-v1.schema.json');
mkdirSync(join(repoRoot, 'docs', 'integration'), { recursive: true });
writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');
console.log(`wrote ${outPath} (${Object.keys(definitions).length} definitions, ${ROUTES.length} routes, ${Object.keys(EXAMPLES).length} example sets)`);
