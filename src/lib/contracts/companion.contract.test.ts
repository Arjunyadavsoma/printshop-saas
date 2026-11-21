import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  ROUTES,
  SCHEMAS,
  SOCKET_SERVER_EVENTS,
} from './companion';
import { EXAMPLES } from './companion.examples';

/**
 * CONTRACT DRIFT TESTS — the machine side of the Phase 1 "one contract" rule.
 *
 * The committed artifact docs/integration/companion-v1.schema.json is
 * generated from src/lib/contracts/companion.ts. These tests fail when:
 *   1. the artifact was not regenerated after a schema change
 *   2. an example no longer satisfies its schema (or vice versa)
 *   3. a documented route no longer maps to a real route.ts file
 *   4. the human contract document version and the artifact version diverge
 *
 * PrintEXE keeps a byte-identical copy and a C# test that deserializes the
 * examples into its client DTOs — update both repos in the same commit.
 */
const HERE = dirname(fileURLToPath(import.meta.url)); // src/lib/contracts
const REPO_ROOT = join(HERE, '..', '..', '..');
const ARTIFACT_PATH = join(REPO_ROOT, 'docs', 'integration', 'companion-v1.schema.json');
const CONTRACT_DOC_PATH = join(REPO_ROOT, 'docs', 'integration', 'COMPANION_V1_CONTRACT.md');

interface Artifact {
  contractVersion: string;
  definitions: Record<string, unknown>;
  routes: { method: string; path: string; sourceFile: string }[];
  socketEvents: { server: string[]; client: string[] };
  examples: Record<string, unknown[]>;
}

const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as Artifact;

describe('companion contract artifact', () => {
  it('exists and is generated for the current CONTRACT_VERSION', () => {
    expect(artifact.contractVersion).toBe(CONTRACT_VERSION);
  });

  it('is in sync with src/lib/contracts/companion.ts (regenerate after schema changes)', async () => {
    // Re-run the generator logic in-memory and compare against the committed file.
    const { z } = await import('zod');
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
      definitions[name] = z.toJSONSchema(schema as never, {
        io: REQUEST_SCHEMAS.has(name) ? 'input' : 'output',
        target: 'draft-2020-12',
      });
    }
    expect(artifact.definitions).toEqual(definitions);
    expect(artifact.routes).toEqual(ROUTES);
    expect(artifact.socketEvents.server).toEqual([...SOCKET_SERVER_EVENTS]);
    expect(artifact.examples).toEqual(EXAMPLES);
  });

  for (const [name, examples] of Object.entries(EXAMPLES)) {
    it(`example set "${name}" parses against its schema`, () => {
      const schema = SCHEMAS[name as keyof typeof SCHEMAS];
      expect(schema, `no schema named "${name}"`).toBeDefined();
      for (const example of examples) {
        const result = schema.safeParse(example);
        expect(result.success, `${name} example failed: ${JSON.stringify(result.error?.issues?.[0])}`).toBe(true);
      }
    });
  }

  it('every example set has a matching schema (no orphans)', () => {
    const schemaNames = new Set(Object.keys(SCHEMAS));
    for (const name of Object.keys(EXAMPLES)) {
      expect(schemaNames.has(name), `example "${name}" has no schema`).toBe(true);
    }
  });

  it('every documented route maps to a real route.ts on disk', () => {
    for (const route of ROUTES) {
      // '/api/v1/agents/jobs/:jobId/status' -> src/app/api/v1/agents/jobs/[id]/status/route.ts.
      // The directory's param name ([id]) need not match the documented one
      // (:jobId) — it doesn't affect the URL — so ':' accepts any '[...]'.
      const base = join(REPO_ROOT, 'src', 'app', 'api', 'v1');
      let cursor = base;
      for (const segment of route.path.replace(/^\/api\/v1\/?/, '').split('/')) {
        if (segment.startsWith(':')) {
          const options = existsSync(cursor)
            ? readdirSync(cursor).filter((d) => /^\[.+\]$/.test(d))
            : [];
          expect(options.length > 0, `route ${route.method} ${route.path} -> no [...] segment under ${cursor}`).toBe(true);
          cursor = join(cursor, options[0]);
        } else {
          cursor = join(cursor, segment);
        }
      }
      expect(existsSync(join(cursor, 'route.ts')), `route ${route.method} ${route.path} -> missing ${cursor}/route.ts`).toBe(true);
      expect(existsSync(join(REPO_ROOT, route.sourceFile)), `sourceFile missing: ${route.sourceFile}`).toBe(true);
    }
  });

  it('human contract document version matches the artifact version', () => {
    const doc = readFileSync(CONTRACT_DOC_PATH, 'utf8');
    expect(doc).toContain(`**Version:** ${CONTRACT_VERSION}`);
    expect(doc).toContain('companion-v1.schema.json');
  });
});
