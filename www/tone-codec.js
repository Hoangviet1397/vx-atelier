/* Tone codec — Atelier VX (G2, SCALE-PLAN.md)
 *
 * Chuyen doi giua am sac (bass/treble, don vi dB) va toa do cuc
 * (angle, distance) ma loa hieu. Loa chi nhan mot diem tren vong tron:
 * goc (0-359 do) + khoang cach (0..maxDistance). Codec nay la ban sao
 * chinh xac toan cuc hien co trong www/index.html (ham cu nam trong IIFE
 * cua trang); KHONG thay doi toan, KHONG them lam tron hay kep bien ben
 * trong encode/decode.
 *
 * - decode(angle, distance) -> { bass, treble }   (ban sao ham cu)
 * - encode({ bass, treble }) -> { angle, distance } (ban sao ham cu)
 * - quantizeDb(v)             -> lam tron ve nac 0.5 dB, giong setTone()
 * - prepareTone({bass, treble}) -> kep bien +-max roi lam tron 0.5 dB,
 *   dung truoc encode o tang UI, dung nhu setTone() dang lam hom nay.
 *
 * Dai Bass/Treble va maxDistance la tham so, khong hardcode trong toan:
 * mac dinh la mark 4 (bass +-6 dB, treble +-8 dB, maxDistance 50).
 * Model khac truyen dai cua no qua createToneCodec() hoac qua tham so
 * ranges cua encode/decode. Chu y: codec cuc 2 chieu chi chua duoc
 * 2 dai; model 3 dai can lenh firmware moi (xem D9 trong SCALE-PLAN.md),
 * khong duoc anh xa gia qua codec nay.
 *
 * Dinh dang: classic script (khong phai ES module) de nap truc tiep
 * trong WebView qua <script src="tone-codec.js">, dong thoi dung duoc
 * trong Node qua module.exports de test hoi quy.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ToneCodec = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Dai mac dinh cua mark 4 — lay dung tu code cu (TMAX, MAX_DIST).
  var MARK4_RANGES = { bassMax: 6, trebleMax: 8, maxDistance: 50 };

  function resolveRanges(ranges) {
    if (!ranges) return MARK4_RANGES;
    return {
      bassMax: ranges.bassMax != null ? ranges.bassMax : MARK4_RANGES.bassMax,
      trebleMax: ranges.trebleMax != null ? ranges.trebleMax : MARK4_RANGES.trebleMax,
      maxDistance: ranges.maxDistance != null ? ranges.maxDistance : MARK4_RANGES.maxDistance
    };
  }

  // Lam tron ve nac 0.5 dB — dung bieu thuc giong setTone() trong index.html.
  function quantizeDb(v) {
    return Math.round(v * 2) / 2;
  }

  // Kep bien +-max roi lam tron 0.5 dB, dung nhu setTone() dang lam truoc
  // khi goi ham doi cuc. Chi dung o tang UI; encode() khong tu kep bien.
  function prepareTone(tone, ranges) {
    var r = resolveRanges(ranges);
    return {
      bass: quantizeDb(Math.max(-r.bassMax, Math.min(r.bassMax, tone.bass))),
      treble: quantizeDb(Math.max(-r.trebleMax, Math.min(r.trebleMax, tone.treble)))
    };
  }

  // decode: (angle, distance) -> { bass, treble }.
  // Ban sao chinh xac ham cu trong index.html, chi thay 6/8/MAX_DIST
  // bang tham so ranges.
  function decode(angle, distance, ranges) {
    var r = resolveRanges(ranges);
    var a = angle - 45;
    while (a < 0) a += 360;
    while (a >= 360) a -= 360;
    var d = distance / r.maxDistance, off, bk, tk;
    if (a < 45 || a >= 315) { off = (a > 180 ? a - 360 : a) / 45; bk = 1; tk = off; }
    else if (a < 135) { off = (a - 90) / 45; bk = -off; tk = 1; }
    else if (a < 225) { off = (a - 180) / 45; bk = -1; tk = -off; }
    else { off = (a - 270) / 45; bk = off; tk = -1; }
    return { bass: r.bassMax * d * bk, treble: r.trebleMax * d * tk };
  }

  // encode: { bass, treble } -> { angle, distance }.
  // Ban sao chinh xac ham cu trong index.html (nghich dao cua decode:
  // am sac nam tren hinh vuong canh d). Khong kep bien, khong lam tron
  // dau vao — UI lam viec do qua prepareTone() truoc khi goi.
  function encode(tone, ranges) {
    var r = resolveRanges(ranges);
    var B = tone.bass / r.bassMax, T = tone.treble / r.trebleMax;
    var d = Math.max(Math.abs(B), Math.abs(T));
    if (d < 1e-3) return { angle: 0, distance: 0 };
    var bk = B / d, tk = T / d;
    var a = bk > 0.999 ? 45 * tk
      : tk > 0.999 ? 90 - 45 * bk
      : bk < -0.999 ? 180 - 45 * tk
      : 270 + 45 * bk;
    return { angle: Math.round((a + 45 + 720) % 360), distance: Math.round(d * r.maxDistance) };
  }

  // Mot codec gan voi dai cua mot model cu the (vd. lay tu profile).
  function createToneCodec(ranges) {
    var r = resolveRanges(ranges);
    return {
      ranges: r,
      encode: function (tone) { return encode(tone, r); },
      decode: function (angle, distance) { return decode(angle, distance, r); },
      quantizeDb: quantizeDb,
      prepareTone: function (tone) { return prepareTone(tone, r); }
    };
  }

  // Mac dinh: mark 4.
  var mark4 = createToneCodec(MARK4_RANGES);

  return {
    MARK4_RANGES: MARK4_RANGES,
    createToneCodec: createToneCodec,
    encode: mark4.encode,
    decode: mark4.decode,
    quantizeDb: quantizeDb,
    prepareTone: mark4.prepareTone,
    mark4: mark4
  };
});
