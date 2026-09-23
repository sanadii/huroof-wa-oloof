import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { scanVisualContract } from '../scripts/scan-visual-contract.js';

const fixture = (name: string) => resolve('tests/fixtures/visual-contract', name);

test('visual scanner allows only the concrete QR encoder pair and tokenized SVG stops', async () => {
  assert.deepEqual(await scanVisualContract(fixture('positive')), []);
});

test('visual scanner rejects raw CSS gradients', async () => {
  assert.match((await scanVisualContract(fixture('raw-gradient'))).join('\n'), /gradient/);
});

test('visual scanner rejects the QR color pair outside its one encoder call', async () => {
  assert.match((await scanVisualContract(fixture('non-qr-colors'))).join('\n'), /#\[0-9a-f\]/);
});

test('visual scanner rejects raw custom-property palette declarations in src', async () => {
  assert.match((await scanVisualContract(fixture('raw-palette'))).join('\n'), /#\[0-9a-f\]/);
});

