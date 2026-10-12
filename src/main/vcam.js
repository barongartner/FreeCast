'use strict';
// Makes FreeCast show up as a webcam in other apps by feeding the OBS Virtual
// Camera device. OBS installs a DirectShow camera that reads frames from a
// named shared-memory queue; anything that writes that queue becomes the
// camera. Layout follows OBS's shared-memory-queue.c: an 80 byte header, then
// three NV12 frame slots, each with a 32 byte slot header holding a timestamp.
const { execFileSync } = require('child_process');

const NAME = 'OBSVirtualCamVideo';
const CLSID = '{A3FCE0F5-3493-419F-958A-ABA1250EC20B}';
const FILE_MAP_READ = 0x4;
const FILE_MAP_ALL_ACCESS = 0xf001f;
const PAGE_READWRITE = 0x4;
const HEADER = 80;
const SLOT_HEADER = 32;
const STATE = { starting: 1, ready: 2, stopping: 3 };
const align = (n) => (n + 31) & ~31;

let koffi = null;
let k32 = null;
let q = null; // { handle, ptr, base, offsets, frameSize, inc, head, stamp }
let available = null;

function load() {
  if (k32) return;
  koffi = require('koffi');
  const lib = koffi.load('kernel32.dll');
  k32 = {
    create: lib.func('void* __stdcall CreateFileMappingW(intptr_t file, void* attrs, uint32_t protect, uint32_t sizeHigh, uint32_t sizeLow, str16 name)'),
    open: lib.func('void* __stdcall OpenFileMappingW(uint32_t access, int inherit, str16 name)'),
    map: lib.func('void* __stdcall MapViewOfFile(void* handle, uint32_t access, uint32_t offHigh, uint32_t offLow, uintptr_t bytes)'),
    unmap: lib.func('int __stdcall UnmapViewOfFile(void* addr)'),
    close: lib.func('int __stdcall CloseHandle(void* handle)'),
    // Electron forbids ArrayBuffers that point at outside memory, so the
    // mapping cannot be wrapped in a Buffer. Everything is copied in instead.
    copy: lib.func('void __stdcall RtlMoveMemory(uintptr_t dest, const void* src, size_t bytes)'),
  };
}

const put = (offset, bytes) => k32.copy(q.base + BigInt(offset), bytes, bytes.length);

// True when the OBS virtual camera driver is registered on this PC.
function isAvailable() {
  if (available === null) {
    try {
      execFileSync('reg', ['query', `HKLM\\SOFTWARE\\Classes\\CLSID\\${CLSID}`], { windowsHide: true, stdio: 'ignore' });
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

function stop() {
  if (!q) return;
  q.head.writeUInt32LE(STATE.stopping, 8);
  put(0, q.head);
  k32.unmap(q.ptr);
  k32.close(q.handle);
  q = null;
}

function start({ w, h, fps }) {
  stop();
  if (!isAvailable()) return { error: 'OBS Studio is not installed, so there is no virtual camera to feed.' };
  try {
    load();
    const taken = k32.open(FILE_MAP_READ, 0, NAME);
    if (taken) {
      k32.close(taken);
      return { error: 'OBS is already using the virtual camera. Stop it there first.' };
    }
    const frameSize = (w * h * 3) / 2;
    const offsets = [];
    let size = align(HEADER);
    for (let i = 0; i < 3; i++) {
      offsets.push(size);
      size = align(size + frameSize + SLOT_HEADER);
    }
    const handle = k32.create(-1, null, PAGE_READWRITE, 0, size, NAME);
    if (!handle) return { error: 'Could not create the camera buffer.' };
    const ptr = k32.map(handle, FILE_MAP_ALL_ACCESS, 0, 0, 0);
    if (!ptr) {
      k32.close(handle);
      return { error: 'Could not map the camera buffer.' };
    }
    const header = Buffer.alloc(HEADER);
    header.writeUInt32LE(STATE.starting, 8);
    offsets.forEach((o, i) => header.writeUInt32LE(o, 12 + i * 4));
    header.writeUInt32LE(w, 28);
    header.writeUInt32LE(h, 32);
    header.writeBigUInt64LE(BigInt(Math.round(1e7 / fps)), 40); // frame interval in 100 ns units
    // head: the first 12 bytes (write index, read index, state), rewritten per frame.
    q = { handle, ptr, base: koffi.address(ptr), offsets, frameSize, inc: 0, head: Buffer.alloc(12), stamp: Buffer.alloc(8) };
    put(0, header);
    return { ok: true };
  } catch (err) {
    q = null;
    return { error: err.message };
  }
}

// frame: one NV12 image of exactly the size given to start().
function write(frame) {
  if (!q || frame.length !== q.frameSize) return;
  const inc = ++q.inc;
  const off = q.offsets[inc % 3];
  q.stamp.writeBigUInt64LE(process.hrtime.bigint(), 0);
  put(off, q.stamp);
  put(off + SLOT_HEADER, frame);
  q.head.writeUInt32LE(inc >>> 0, 0);
  q.head.writeUInt32LE(inc >>> 0, 4);
  q.head.writeUInt32LE(STATE.ready, 8);
  put(0, q.head);
}

module.exports = { start, stop, write, isAvailable };
