/* Test hoi quy tone-codec.js — chay bang node, khong can trinh duyet.
 *   node test-tone-codec.js   (tu repo root ~/workspace/vx-atelier-ios-v1/)
 *
 * G2 (21/11/2026) da xoa ham cu beosonic()/polarFromTone() khoi
 * www/index.html, nen test nay KHONG trich ham cu tu index.html nua.
 * Thay vao do no doi chieu codec moi voi GOLDEN SNAPSHOT
 * test/tone-codec-golden.json — ket qua cua ham cu, dong bang TRUOC khi
 * xoa (sinh bang node /tmp/gen_golden.js tu index.html luc ham cu con
 * nguyen; luc do test cu chay 22.599 diem, 0 lech). Moi diem phai khop
 * dung (so nguyen ===, so thuc === bit-identical). Bat ky lech nao cung FAIL.
 * Neu toan co thay doi co chu dich, golden phai duoc tai sinh tu lich su
 * git cua index.html truoc G2 — khong sua tay file golden.
 *
 * Luoi quet (giong test cu):
 *   [E1] encode: moi cap (bass, treble) theo nac 0.5 dB trong dai mark 4
 *        bass -6..+6 (25) x treble -8..+8 (33) = 825 diem.
 *   [E2] encode ngoai luoi: 2000 diem gia tri le + vuot dai (vd. bass 10)
 *        de chung minh encode moi la ban sao thuan tuy, khong kep bien an.
 *   [D1] decode: moi goc 0..359 x moi khoang cach 0..50 = 18.360 diem.
 *   [D2] decode gia tri le: 500 diem (goc, khoang cach) thap phan.
 *   [R]  round-trip (kiem tra tinh chat, khong phai gate bit-identical):
 *        decode(encode(tone)) lam tron 0.5 dB phai tra ve dung tone goc.
 *   [Q]  quantizeDb/prepareTone khop bieu thuc cu trong setTone().
 *   [N]  tone-codec.js khong chua chu "Beosonic" (nhan hieu B&O).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const codecSrc = fs.readFileSync(path.join(ROOT, 'www/tone-codec.js'), 'utf-8');
const Codec = require('./www/tone-codec.js');

// --- golden snapshot: ket qua cua ham cu, dong bang truoc G2 ---
const goldenPath = path.join(ROOT, 'test/tone-codec-golden.json');
if (!fs.existsSync(goldenPath)) throw new Error('thieu golden snapshot: ' + goldenPath + ' (xem dau file test nay)');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));
for (const k of ['encodeGrid', 'encodeRandom', 'decodeGrid', 'decodeRandom']) {
  if (!Array.isArray(golden[k]) || !golden[k].length) throw new Error('golden snapshot thieu/rong: ' + k);
}

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    if (failures.length < 10) failures.push(label + ' :: ' + detail);
  }
}
const same = (a, b) => a === b;

function report(name, n) {
  console.log(`[${name}] ${n} diem — khop ${pass - (report._prev || 0)} / lech ${fail - (report._prevF || 0)}`);
  report._prev = pass; report._prevF = fail;
}

// --- [E1] encode: toan bo luoi 0.5 dB (doi chieu golden) ---
{
  let n = 0;
  for (const [bass, treble, angle, distance] of golden.encodeGrid) {
    const b = Codec.encode({ bass, treble });
    n++;
    check('E1', same(b.angle, angle) && same(b.distance, distance),
      `encode(${bass}, ${treble}) golden=${angle}/${distance} moi=${b.angle}/${b.distance}`);
  }
  report('E1 encode luoi 0.5 dB', n);
}

// --- [E2] encode ngoai luoi: gia tri le + vuot dai ---
{
  let n = 0;
  for (const [bass, treble, angle, distance] of golden.encodeRandom) {
    const b = Codec.encode({ bass, treble });
    n++;
    check('E2', same(b.angle, angle) && same(b.distance, distance),
      `encode(${bass}, ${treble}) golden=${angle}/${distance} moi=${b.angle}/${b.distance}`);
  }
  report('E2 encode ngoai luoi', n);
}

// --- [D1] decode: moi goc 0-359 x moi khoang cach 0-50 ---
{
  let n = 0;
  for (const [angle, dist, bass, treble] of golden.decodeGrid) {
    const b = Codec.decode(angle, dist);
    n++;
    check('D1', same(b.bass, bass) && same(b.treble, treble),
      `decode(${angle}, ${dist}) golden=${bass}/${treble} moi=${b.bass}/${b.treble}`);
  }
  report('D1 decode toan luoi', n);
}

// --- [D2] decode gia tri le ---
{
  let n = 0;
  for (const [angle, dist, bass, treble] of golden.decodeRandom) {
    const b = Codec.decode(angle, dist);
    n++;
    check('D2', same(b.bass, bass) && same(b.treble, treble),
      `decode(${angle}, ${dist}) golden=${bass}/${treble} moi=${b.bass}/${b.treble}`);
  }
  report('D2 decode gia tri le', n);
}

// --- [R] round-trip: decode(encode(tone)) lam tron 0.5 dB tra ve tone goc ---
{
  let n = 0, bad = 0;
  for (let bi = -12; bi <= 12; bi++) {
    for (let ti = -16; ti <= 16; ti++) {
      const tone = { bass: bi / 2, treble: ti / 2 };
      const p = Codec.encode(tone);
      const g = Codec.decode(p.angle, p.distance);
      const rt = { bass: Codec.quantizeDb(g.bass), treble: Codec.quantizeDb(g.treble) };
      n++;
      check('R', same(rt.bass, tone.bass) && same(rt.treble, tone.treble),
        `round-trip(${tone.bass}, ${tone.treble}) -> ${p.angle}/${p.distance} -> ${rt.bass}/${rt.treble}`);
      if (rt.bass !== tone.bass || rt.treble !== tone.treble) bad++;
    }
  }
  report('R round-trip luoi 0.5 dB', n);
}

// --- [Q] quantizeDb / prepareTone khop bieu thuc cu trong setTone() ---
{
  let n = 0;
  for (let v = -10; v <= 10; v += 0.25) {
    n++;
    check('Q', same(Codec.quantizeDb(v), Math.round(v * 2) / 2), `quantizeDb(${v})`);
  }
  const cases = [
    [{ bass: 6.3, treble: -8.7 }, { bass: 6, treble: -8 }],
    [{ bass: -6.4, treble: 8.4 }, { bass: -6, treble: 8 }],
    [{ bass: 1.26, treble: -2.74 }, { bass: 1.5, treble: -2.5 }],
    [{ bass: 0, treble: 0 }, { bass: 0, treble: 0 }]
  ];
  for (const [input, expected] of cases) {
    n++;
    const got = Codec.prepareTone(input);
    check('Q', same(got.bass, expected.bass) && same(got.treble, expected.treble),
      `prepareTone(${JSON.stringify(input)}) = ${JSON.stringify(got)}, muon ${JSON.stringify(expected)}`);
  }
  report('Q quantize/prepare', n);
}

// --- [N] khong co chu "Beosonic" trong tone-codec.js ---
check('N', !/beosonic/i.test(codecSrc), 'tone-codec.js chua chu Beosonic');

// --- [G] nap dang classic script: window.ToneCodec ton tai ---
{
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(codecSrc, sandbox);
  check('G', sandbox.ToneCodec && typeof sandbox.ToneCodec.encode === 'function'
    && typeof sandbox.ToneCodec.decode === 'function'
    && typeof sandbox.ToneCodec.createToneCodec === 'function',
    'global ToneCodec thieu API');
  // createToneCodec voi dai khac: kiem tra tham so hoa (khong doi voi mark 4).
  const other = sandbox.ToneCodec.createToneCodec({ bassMax: 4, trebleMax: 4, maxDistance: 40 });
  const p = other.encode({ bass: 4, treble: 0 });
  check('G', p.angle === 45 && p.distance === 40, `codec dai khac: ${JSON.stringify(p)}`);
  const d = other.decode(45, 40);
  check('G', d.bass === 4 && d.treble === 0, `decode dai khac: ${JSON.stringify(d)}`);
}

// --- tong ket ---
console.log('----------------------------------------');
console.log(`TONG: ${pass} khop, ${fail} lech`);
if (failures.length) { console.log('Vi du lech:'); failures.forEach(f => console.log('  ' + f)); }
if (fail) { console.log('FAIL'); process.exit(1); }
console.log('PASS — codec moi bit-identical voi golden snapshot cua ham cu tren toan bo luoi quet');
