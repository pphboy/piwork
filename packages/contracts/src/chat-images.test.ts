import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatInputDigest, validateChatImages, type ChatImageInput } from "./chat-images.js";

const fixtures = JSON.parse(readFileSync(new URL("../../../fixtures/chat-images/validation.json", import.meta.url), "utf8")) as Array<ChatImageInput & { name: string; valid: boolean; promptDigest: string; width?:number; height?:number; paddingBytes?:number }>;
function crc32(b:Uint8Array){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function bytes(value:typeof fixtures[number]) {
  let b=Buffer.from(value.data,"base64");
  if(value.width!==undefined){b.writeUInt32BE(value.width,16);b.writeUInt32BE(value.height!,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);}
  if(value.paddingBytes){const chunk=Buffer.alloc(value.paddingBytes-b.length,120);chunk.writeUInt32BE(chunk.length-12,0);chunk.write("tEXt",4);chunk[8]=107;chunk[9]=0;chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);b=Buffer.concat([b.subarray(0,-12),chunk,b.subarray(-12)]);}
  return b;
}
for (const value of fixtures) test(`shared image container: ${value.name}`, () => {
  const image = { mimeType: value.mimeType, data: bytes(value).toString("base64") };
  if (!value.valid) { assert.throws(() => validateChatImages([image])); return; }
  assert.equal(validateChatImages([image])[0]?.byteSize, bytes(value).length);
  assert.equal(chatInputDigest("look", [image]), value.promptDigest);
});
test("image limits and canonical base64 are enforced", () => {
  const f = fixtures[0]!; const image = { mimeType: f.mimeType, data: f.data };
  assert.throws(() => validateChatImages(Array(5).fill(image)));
  assert.throws(() => validateChatImages([{...image,data:image.data+"\n"}]));
  assert.throws(() => validateChatImages([{...image,data:""}]));
  assert.equal(chatInputDigest("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  const large={...image,data:bytes(fixtures.find(f=>f.name==="bytes-at")!).toString("base64")};
  assert.equal(validateChatImages([large,large]).length,2);
  assert.throws(()=>validateChatImages([large,large,image]),/10 MiB/);
});
