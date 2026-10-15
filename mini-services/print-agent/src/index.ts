#!/usr/bin/env bun
/**
 * print-agent — the shop's PC daemon (Phase 6).
 *
 * Usage:
 *   print-agent setup          # interactive: shop slug, owner login → mint a device token
 *   print-agent start          # run the daemon (socket.io push + polling + heartbeat + disk queue)
 *   print-agent status         # show config + last-seen + pending-jobs count
 *   print-agent test-printer   # try the local print command on a test page
 *
 * Env:
 *   PRINT_AGENT_DEMO=1         # skip the real print command (sandbox: no printer)
 *   PRINT_AGENT_API_URL        # override the API base (e.g. http://127.0.0.1:81)
 *   PRINT_AGENT_REALTIME_URL   # override the realtime mini-service base
 *   PRINT_AGENT_DEVICE_TOKEN   # non-interactive setup: a pre-minted device token
 *   PRINT_AGENT_NAME           # non-interactive setup: agent name
 *   PRINTER_NAME               # target a specific CUPS/printer queue
 *
 * Talks OUTBOUND only. No inbound ports. Works behind any NAT/firewall.
 */
import { platform, hostname } from 'node:os';
import { loadConfig, saveConfig, defaultName, VERSION, CONFIG_PATH_RESOLVED } from './config.js';
import { runAgent } from './agent.js';
import { printFile, writeToTemp } from './printer.js';

const cmd = process.argv[2] ?? 'help';

async function setup(): Promise<void> {
  console.log('=== print-agent setup ===');
  const apiUrl = process.env.PRINT_AGENT_API_URL ?? (await prompt('API URL (the gateway)', 'http://127.0.0.1:81'));
  const shopSlug = process.env.PRINT_AGENT_SHOP_SLUG ?? (await prompt('Shop slug', 'quickprint'));
  const name = process.env.PRINT_AGENT_NAME ?? (await prompt('Agent name', defaultName()));
  // If a pre-minted device token is provided (non-interactive), use it.
  if (process.env.PRINT_AGENT_DEVICE_TOKEN) {
    const realtimeUrl = process.env.PRINT_AGENT_REALTIME_URL ?? 'http://127.0.0.1:3003';
    saveConfig({ shopSlug, apiUrl, realtimeUrl, deviceToken: process.env.PRINT_AGENT_DEVICE_TOKEN, agentId: 'pending', name, version: VERSION });
    console.log('✓ device token accepted. Run `print-agent start`.');
    return;
  }
  // Interactive: log in as the shop owner + mint a device token.
  const email = await prompt('Owner email', 'owner@quickprint.demo');
  const password = await prompt('Owner password', 'demo1234');
  const loginRes = await fetch(`${apiUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!loginRes.ok) { console.error('login failed', await loginRes.text()); process.exit(1); }
  const login = (await loginRes.json()) as { data: { accessToken: string } };
  const regRes = await fetch(`${apiUrl}/api/v1/agents/register`, { method: 'POST', headers: { Authorization: `Bearer ${login.data.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, os: platform(), version: VERSION }) });
  if (!regRes.ok) { console.error('register failed', await regRes.text()); process.exit(1); }
  const reg = (await regRes.json()) as { data: { deviceToken: string; agentId: string } };
  const realtimeUrl = process.env.PRINT_AGENT_REALTIME_URL ?? 'http://127.0.0.1:3003';
  saveConfig({ shopSlug, apiUrl, realtimeUrl, deviceToken: reg.data.deviceToken, agentId: reg.data.agentId, name, version: VERSION });
  console.log('✓ agent registered. Run `print-agent start`.');
}

async function status(): Promise<void> {
  const c = loadConfig();
  if (!c) { console.log('No config. Run `print-agent setup`.'); return; }
  console.log('config:', JSON.stringify({ ...c, deviceToken: c.deviceToken.slice(0, 8) + '…' }, null, 2));
  console.log('config path:', CONFIG_PATH_RESOLVED);
  const r = await fetch(`${c.apiUrl}/api/v1/agents/jobs/pending`, { headers: { Authorization: `Bearer ${c.deviceToken}` } });
  if (r.ok) { const j = (await r.json()) as { data: { jobs: unknown[] } }; console.log('pending jobs:', j.data.jobs.length); }
  else console.log('pending jobs: (unreachable)');
}

async function testPrinter(): Promise<void> {
  console.log('=== test printer ===');
  const demoPage = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Root 1 0 R>>\n%%EOF';
  const tmp = writeToTemp('test-page.pdf', new TextEncoder().encode(demoPage));
  console.log(`test page → ${tmp}`);
  const result = await printFile(tmp, { copies: 1, colorMode: 'bw', duplex: false, paperSize: 'a4' });
  if (result.ok) console.log(`✓ printed${result.printerName ? ` (${result.printerName})` : ''}`);
  else console.log(`✗ print failed: ${result.error} (set PRINT_AGENT_DEMO=1 to skip)`);
}

async function prompt(label: string, def: string): Promise<string> {
  const v = await Bun.prompt(`${label} [${def}]:`);
  return (v && v.trim()) || def;
}

async function main(): Promise<void> {
  switch (cmd) {
    case 'setup': return setup();
    case 'start': return runAgent();
    case 'status': return status();
    case 'test-printer': return testPrinter();
    default:
      console.log('print-agent — the shop PC print daemon\n');
      console.log('Commands:');
      console.log('  setup         interactive wizard (mints a device token)');
      console.log('  start         run the daemon');
      console.log('  status        show config + pending-jobs count');
      console.log('  test-printer  try the local print command');
      console.log(`\nEnv: PRINT_AGENT_DEMO=1, PRINT_AGENT_DEVICE_TOKEN=…, PRINTER_NAME=…`);
  }
}

void main();
