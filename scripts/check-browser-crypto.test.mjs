import assert from 'node:assert/strict';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import test from 'node:test';
import { randomUUID, sha256Hex } from '../apps/ui-shared/browser-crypto.js';

test('HTTP IP checksum and UUID fallbacks work without secure-context APIs', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{value:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},configurable:true});
  try {
    for (const data of [Buffer.alloc(0),Buffer.from('abc'),Buffer.alloc(1000000,97),...([55,56,63,64,65,257,4096].map(length=>randomBytes(length)))]) {
      assert.equal(await sha256Hex(data),createHash('sha256').update(data).digest('hex'));
    }
    const ids=new Set(Array.from({length:100},()=>randomUUID()));
    assert.equal(ids.size,100);
    for(const id of ids)assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  } finally { Object.defineProperty(globalThis,'crypto',descriptor); }
});

test('secure-context checksums use the same output format',async()=>{
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
