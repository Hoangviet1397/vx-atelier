// VXSpeakerProfiles — loader + validator cho catalogue loa Atelier VX.
//
// G1 (SCALE-PLAN.md): mọi dữ liệu theo model sống trong www/speaker-profiles.json,
// file này chỉ biết ĐỌC + KIỂM TRA catalogue, không chứa giá trị nào của riêng
// model mark 4 (trừ id mặc định 'vx-mark4' và các giá trị mặc định chung lấy từ
// hành vi mark 4 hiện tại — xem DEFAULTS bên dưới).
//
// Quy tắc:
//  - Fail-closed: thiếu field bắt buộc (BB) thì BỎ profile đó, không đoán giá trị.
//    Một profile hỏng không giết các profile còn lại; catalogue không còn profile
//    hợp lệ nào thì loader báo lỗi, app không được tự bịa profile.
//  - Capability false HOẶC thiếu mã lệnh trong protocol.commands -> tính năng tắt.
//  - Runtime capability = profile ∩ firmware (bitmask GET_INFO): firmware chỉ
//    được trừ, không được cộng thêm. Radio và userModes là phone-side, chỉ theo profile.
//  - Chạy được cả trong trình duyệt thật (Capacitor/WKWebView) và trong jsdom:
//    không dùng DOM, localStorage, hay API Capacitor nào. Chỉ dùng fetch() khi
//    gọi loadCatalogueFromUrl(), và fetch thiếu thì trả lỗi rõ ràng thay vì crash.
//  - Tên lệnh firmware chỉ xuất hiện trong FIRMWARE_COMMAND_NAMES (phục vụ
//    log/debug) — KHÔNG bao giờ dùng làm chuỗi hiển thị cho người dùng.
//
// Cách dùng (xem hướng dẫn nối ở cuối file):
//   const res = await VXSpeakerProfiles.loadCatalogueFromUrl('speaker-profiles.json');
//   const p = VXSpeakerProfiles.getDefaultProfile();            // mark 4
//   const q = VXSpeakerProfiles.getProfileByModelId(info.model);
//   const sel = VXSpeakerProfiles.resolveProfileForInfo({ modelId, hasInfo });
//   const eff = VXSpeakerProfiles.applyFirmwareFeatures(p, info.features);
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VXSpeakerProfiles = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var DEFAULT_PROFILE_ID = 'vx-mark4';
  var GAIA_SERVICE_UUID = '00001100-d102-11e1-9b23-00025b00a5a5';

  // Tên lệnh firmware gốc (giao thức của loa) — chỉ để đọc log/debug,
  // không hiện lên giao diện. Key là tên logic dùng trong profile.commands.
  var FIRMWARE_COMMAND_NAMES = { setTone: 'CMD_SET_BEOSONIC' };

  // Bitmask features firmware trả qua GET_INFO (xem handlePacket trong index.html).
  // ALIGNED (16) không gắn với tính năng người dùng nào nên không có trong map.
  var FEATURE_BITS = { tone: 1, placement: 2, stereoPair: 4, usb: 8, roomMeasurement: 32, swapLeftRight: 64 };
  // Tính năng phone-side / app-side: không có bit firmware, chỉ theo profile.
  var PHONE_SIDE_FEATURES = ['radio', 'userModes', 'builtinModes'];
  // Mọi key capabilities bắt buộc phải có trong profile (thiếu key = profile hỏng).
  var CAPABILITY_KEYS = ['tone', 'placement', 'roomMeasurement', 'stereoPair', 'swapLeftRight', 'usb', 'identify', 'radio', 'userModes', 'builtinModes'];
  // Lệnh nào bắt buộc khi capability tương ứng bật (thiếu mã = tính năng đó tắt,
  // nhưng profile vẫn hợp lệ — xem validateProfile).
  var COMMAND_FOR_FEATURE = { tone: 'setTone', placement: 'setPlacement', stereoPair: 'tws', roomMeasurement: 'roomMeasure', swapLeftRight: 'setRole', identify: 'identify' };
  // Hai lệnh luôn phải có: đọc trạng thái + bắt tay/chứng minh loa VX.
  var ALWAYS_REQUIRED_COMMANDS = ['getState', 'getInfo'];

  // Giá trị mặc định cho field tùy chọn (TC) — đều lấy từ hành vi mark 4 hiện tại.
  var DEFAULTS = {
    discovery: { bleNamePrefixes: ['VX', 'V&X'], serviceUuids: [GAIA_SERVICE_UUID] },
    protocol: {
      packet: { headerBytes: 4, responseCmdFlag: 32768 },
      pollIntervalMs: 3000, connectTimeoutMs: 12000, infoTimeoutMs: 1500
    },
    toneUi: { control: 'stepper', doubleTapResetsToZero: true, sendOnReleaseOnly: true },
    room: {
      sweeps: 4,
      spots: [
        'Ngồi đúng chỗ nghe, cầm iPhone ngang tai.',
        'Dịch iPhone sang trái khoảng 30 cm, vẫn ngang tai.',
        'Dịch iPhone sang phải khoảng 30 cm, vẫn ngang tai.',
        'Đưa iPhone lên cao hơn đầu khoảng một gang tay.'
      ],
      sweep: { fMinHz: 15, fMaxHz: 2000, durationSec: 4.0, levelDbfs: -12 },
      analysis: { fMinHz: 20, fMaxHz: 1000, pointsPerOctave: 48, cutLoHz: 30, cutHiHz: 300, maxBands: 3, maxCutDb: 12, minExcessDb: 2.0 },
      target: { flatFromHz: 200, flatToHz: 1000, bassTiltDbAt40Hz: 2 },
      speakerPlaysSweepFromProto: 5, measureTimeoutSec: 120, minSnrDb: 10, maxPeak: 0.98,
      requiresMicrophone: true, storageKey: 'vx.room',
      timing: { preSec: 0.4, tailSec: 1.8, speakerWaitSec: 1.8 }
    },
    userSaved: { enabled: true, maxNameLength: 18, storageKey: 'vx.modes' },
    pairing: { maxSpeakers: 2 },
    limits: { maxRememberedDevices: 4 }
  };

  // ---------- tiện ích nhỏ (không phụ thuộc môi trường) ----------
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
  function isUuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---------- validator: fail-closed ----------
  // Trả về { ok: boolean, errors: string[] }. ok=false -> caller PHẢI bỏ profile.
  function validateProfile(p) {
    var errors = [];
    var err = function (m) { errors.push(m); };
    if (!isObj(p)) return { ok: false, errors: ['profile không phải object'] };
    var id = p.id || '(không id)';

    if (!isNonEmptyString(p.id) || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) err(id + ': id phải là slug không rỗng (chữ thường, số, gạch ngang)');
    if ('schemaVersion' in p && p.schemaVersion !== SCHEMA_VERSION) err(id + ': schemaVersion ' + p.schemaVersion + ' không được hỗ trợ (loader hiểu ' + SCHEMA_VERSION + ')');
    if (!isInt(p.modelId) || p.modelId < 0) err(id + ': modelId phải là số nguyên >= 0 (số firmware trả qua GET_INFO)');
    if (!isNonEmptyString(p.displayName)) err(id + ': displayName bắt buộc');
    if (['entry', 'standard', 'flagship'].indexOf(p.tier) === -1) err(id + ': tier phải là entry | standard | flagship');

    // discovery: ít nhất 1 trong 2 cách (tiền tố tên / service UUID) phải có.
    if (!isObj(p.discovery)) { err(id + ': discovery bắt buộc'); }
    else {
      var hasPrefixes = Array.isArray(p.discovery.bleNamePrefixes) && p.discovery.bleNamePrefixes.length > 0
        && p.discovery.bleNamePrefixes.every(isNonEmptyString);
      var hasServices = Array.isArray(p.discovery.serviceUuids) && p.discovery.serviceUuids.length > 0
        && p.discovery.serviceUuids.every(isUuid);
      if (Array.isArray(p.discovery.bleNamePrefixes) && !hasPrefixes) err(id + ': discovery.bleNamePrefixes phải là mảng chuỗi không rỗng');
      if (Array.isArray(p.discovery.serviceUuids) && !hasServices) err(id + ': discovery.serviceUuids phải là mảng UUID hợp lệ');
      if (!hasPrefixes && !hasServices) err(id + ': discovery cần ít nhất bleNamePrefixes hoặc serviceUuids');
      if (Array.isArray(p.discovery.modelIds) && !p.discovery.modelIds.every(function (m) { return isInt(m) && m >= 0; }))
        err(id + ': discovery.modelIds phải là mảng số nguyên >= 0');
    }

    // protocol
    var commands = null;
    if (!isObj(p.protocol)) { err(id + ': protocol bắt buộc'); }
    else {
      var pr = p.protocol;
      if (pr.transport !== 'gaia') err(id + ': protocol.transport phải là "gaia" (giá trị khác chưa được hỗ trợ)');
      if (!isInt(pr.vendorId) || pr.vendorId < 0 || pr.vendorId > 0xffff) err(id + ': protocol.vendorId phải là số nguyên 0..65535');
      if (!isUuid(pr.serviceUuid)) err(id + ': protocol.serviceUuid phải là UUID');
      if (!isUuid(pr.commandUuid)) err(id + ': protocol.commandUuid phải là UUID');
      if (!isUuid(pr.responseUuid)) err(id + ': protocol.responseUuid phải là UUID');
      if (!isInt(pr.maxDistance) || pr.maxDistance <= 0) err(id + ': protocol.maxDistance phải là số nguyên > 0');
      if (pr.toneEncoding !== 'polar' && pr.toneEncoding !== 'directDb') err(id + ': protocol.toneEncoding phải là polar | directDb');
      if (!isObj(pr.commands)) { err(id + ': protocol.commands bắt buộc'); }
      else {
        commands = pr.commands;
        Object.keys(commands).forEach(function (k) {
          if (!isInt(commands[k]) || commands[k] < 0 || commands[k] > 0xffff) err(id + ': protocol.commands.' + k + ' phải là mã lệnh 0..65535');
        });
        ALWAYS_REQUIRED_COMMANDS.forEach(function (c) {
          if (!isInt(commands[c])) err(id + ': protocol.commands.' + c + ' bắt buộc (đọc trạng thái / bắt tay)');
        });
      }
    }

    // capabilities: đủ 10 key, kiểu boolean. Thiếu key = profile hỏng (không đoán false).
    var caps = null;
    if (!isObj(p.capabilities)) { err(id + ': capabilities bắt buộc'); }
    else {
      caps = p.capabilities;
      CAPABILITY_KEYS.forEach(function (k) {
        if (typeof caps[k] !== 'boolean') err(id + ': capabilities.' + k + ' bắt buộc, kiểu boolean');
      });
    }

    // Tính năng bật nhưng thiếu mã lệnh -> tính năng đó coi như tắt (ghi chú, không hỏng profile).
    // Lệnh thiếu hẳn trong map thì adapter không được gửi lệnh đó.
    var notes = [];
    if (caps && commands) {
      Object.keys(COMMAND_FOR_FEATURE).forEach(function (feat) {
        if (caps[feat] === true && !isInt(commands[COMMAND_FOR_FEATURE[feat]]))
          notes.push(id + ': capabilities.' + feat + ' = true nhưng thiếu lệnh ' + COMMAND_FOR_FEATURE[feat] + ' -> tính năng tắt');
      });
    }

    // tone
    if (caps && caps.tone === true) {
      if (!isObj(p.tone) || !Array.isArray(p.tone.bands) || p.tone.bands.length === 0) {
        err(id + ': tone.bands bắt buộc khi capabilities.tone = true (ít nhất 1 band)');
      } else {
        var keys = {};
        p.tone.bands.forEach(function (b, i) {
          var where = id + ': tone.bands[' + i + ']';
          if (!isObj(b) || !isNonEmptyString(b.key)) err(where + ': key bắt buộc');
          else if (keys[b.key]) err(where + ': key "' + b.key + '" trùng');
          else keys[b.key] = true;
          if (!isNonEmptyString(b.label)) err(where + ': label bắt buộc');
          if (typeof b.minDb !== 'number' || typeof b.maxDb !== 'number' || !(b.minDb < b.maxDb)) err(where + ': cần minDb < maxDb');
          if (typeof b.stepDb !== 'number' || !(b.stepDb > 0)) err(where + ': stepDb phải > 0');
          if (typeof b.defaultDb !== 'number' || b.defaultDb < b.minDb || b.defaultDb > b.maxDb) err(where + ': defaultDb phải nằm trong [minDb, maxDb]');
        });
      }
    }

    // placement
    if (caps && caps.placement === true) {
      if (!isObj(p.placement) || !Array.isArray(p.placement.options) || p.placement.options.length === 0) {
        err(id + ': placement.options bắt buộc khi capabilities.placement = true (ít nhất 1 option)');
      } else {
        var ids = {};
        p.placement.options.forEach(function (o, i) {
          var where = id + ': placement.options[' + i + ']';
          if (!isObj(o) || !isNonEmptyString(o.id)) err(where + ': id bắt buộc');
          else if (ids[o.id]) err(where + ': id "' + o.id + '" trùng');
          else ids[o.id] = true;
          if (!isNonEmptyString(o.label)) err(where + ': label bắt buộc');
        });
        if (!isNonEmptyString(p.placement.default) || !ids[p.placement.default])
          err(id + ': placement.default phải là id của một option');
      }
    }

    // room
    if (caps && caps.roomMeasurement === true) {
      if (!isObj(p.room)) { err(id + ': room bắt buộc khi capabilities.roomMeasurement = true'); }
      else {
        if (!isInt(p.room.sweeps) || p.room.sweeps <= 0) err(id + ': room.sweeps phải là số nguyên > 0');
        if (!Array.isArray(p.room.spots) || p.room.spots.length === 0 || !p.room.spots.every(isNonEmptyString))
          err(id + ': room.spots phải là mảng chuỗi hướng dẫn không rỗng');
        else if (isInt(p.room.sweeps) && p.room.spots.length !== p.room.sweeps)
          err(id + ': room.spots phải có đúng room.sweeps mục (1 hướng dẫn / 1 lần quét)');
        if (isObj(p.room.sweep)) {
          if (!(p.room.sweep.fMinHz > 0 && p.room.sweep.fMaxHz > p.room.sweep.fMinHz)) err(id + ': room.sweep cần 0 < fMinHz < fMaxHz');
          if (typeof p.room.sweep.durationSec !== 'number' || !(p.room.sweep.durationSec > 0)) err(id + ': room.sweep.durationSec phải > 0');
        }
        if (isObj(p.room.analysis)) {
          var a = p.room.analysis;
          if (!(a.cutLoHz > 0 && a.cutHiHz > a.cutLoHz)) err(id + ': room.analysis cần 0 < cutLoHz < cutHiHz');
          if (!isInt(a.maxBands) || a.maxBands <= 0) err(id + ': room.analysis.maxBands phải là số nguyên > 0');
          if (typeof a.maxCutDb !== 'number' || !(a.maxCutDb > 0)) err(id + ': room.analysis.maxCutDb phải > 0');
          if (typeof a.minExcessDb !== 'number' || a.minExcessDb < 0) err(id + ': room.analysis.minExcessDb phải >= 0');
        }
        if (typeof p.room.minSnrDb === 'number' && p.room.minSnrDb < 0) err(id + ': room.minSnrDb phải >= 0');
        if (typeof p.room.maxPeak === 'number' && !(p.room.maxPeak > 0 && p.room.maxPeak <= 1)) err(id + ': room.maxPeak phải trong (0, 1]');
      }
    }

    // modes
    if (isObj(p.modes)) {
      if (Array.isArray(p.modes.builtin)) {
        p.modes.builtin.forEach(function (m, i) {
          var where = id + ': modes.builtin[' + i + ']';
          if (!isObj(m) || !isNonEmptyString(m.name)) err(where + ': name bắt buộc');
          if (!isInt(m.angle) || m.angle < 0 || m.angle > 359) err(where + ': angle phải là số nguyên 0..359');
          if (isObj(p.protocol) && isInt(p.protocol.maxDistance) && (!isInt(m.distance) || m.distance < 0 || m.distance > p.protocol.maxDistance))
            err(where + ': distance phải là số nguyên 0..maxDistance');
        });
      }
      if (isObj(p.modes.userSaved) && has(p.modes.userSaved, 'maxNameLength')
        && (!isInt(p.modes.userSaved.maxNameLength) || p.modes.userSaved.maxNameLength <= 0))
        err(id + ': modes.userSaved.maxNameLength phải là số nguyên > 0');
    }

    // radio: đài có sẵn là dữ liệu của điện thoại; bật radio thì danh sách phải có.
    if (caps && caps.radio === true) {
      if (!isObj(p.radio) || !isObj(p.radio.builtinStations)
        || !Array.isArray(p.radio.builtinStations.vn) || !Array.isArray(p.radio.builtinStations.world))
        err(id + ': radio.builtinStations.{vn,world} bắt buộc khi capabilities.radio = true');
      else {
        ['vn', 'world'].forEach(function (g) {
          p.radio.builtinStations[g].forEach(function (s, i) {
            var where = id + ': radio.builtinStations.' + g + '[' + i + ']';
            if (!isObj(s) || !isNonEmptyString(s.id) || !isNonEmptyString(s.name)) err(where + ': id và name bắt buộc');
            if (!isNonEmptyString(s.url) || s.url.indexOf('https://') !== 0) err(where + ': url phải bắt đầu bằng https://');
          });
        });
      }
    }

    // limits
    if (isObj(p.limits) && has(p.limits, 'maxRememberedDevices')
      && (!isInt(p.limits.maxRememberedDevices) || p.limits.maxRememberedDevices <= 0))
      err(id + ': limits.maxRememberedDevices phải là số nguyên > 0');

    return { ok: errors.length === 0, errors: errors, notes: notes };
  }

  // Điền giá trị mặc định cho field tùy chọn (TC). Chỉ gọi SAU khi validate ok.
  // Trả về bản copy mới, không sửa object gốc.
  function withDefaults(p) {
    var out = clone(p);
    out.discovery = out.discovery || {};
    if (!out.discovery.bleNamePrefixes) out.discovery.bleNamePrefixes = clone(DEFAULTS.discovery.bleNamePrefixes);
    if (!out.discovery.serviceUuids) out.discovery.serviceUuids = clone(DEFAULTS.discovery.serviceUuids);
    out.protocol.packet = Object.assign(clone(DEFAULTS.protocol.packet), out.protocol.packet || {});
    ['pollIntervalMs', 'connectTimeoutMs', 'infoTimeoutMs'].forEach(function (k) {
      if (!isInt(out.protocol[k])) out.protocol[k] = DEFAULTS.protocol[k];
    });
    if (out.capabilities.tone && isObj(out.tone)) {
      out.tone.ui = Object.assign(clone(DEFAULTS.toneUi), out.tone.ui || {});
      if (!isObj(out.tone.wireMax)) {
        out.tone.wireMax = {};
        out.tone.bands.forEach(function (b) { out.tone.wireMax[b.key] = Math.max(Math.abs(b.minDb), Math.abs(b.maxDb)); });
      }
    }
    if (out.capabilities.roomMeasurement && isObj(out.room)) {
      var d = DEFAULTS.room;
      if (!isInt(out.room.sweeps)) out.room.sweeps = d.sweeps;
      if (!Array.isArray(out.room.spots)) out.room.spots = clone(d.spots);
      out.room.sweep = Object.assign(clone(d.sweep), out.room.sweep || {});
      out.room.analysis = Object.assign(clone(d.analysis), out.room.analysis || {});
      out.room.target = Object.assign(clone(d.target), out.room.target || {});
      out.room.timing = Object.assign(clone(d.timing), out.room.timing || {});
      ['speakerPlaysSweepFromProto', 'measureTimeoutSec', 'minSnrDb', 'maxPeak'].forEach(function (k) {
        if (typeof out.room[k] !== 'number') out.room[k] = d[k];
      });
      if (typeof out.room.requiresMicrophone !== 'boolean') out.room.requiresMicrophone = d.requiresMicrophone;
      if (!isNonEmptyString(out.room.storageKey)) out.room.storageKey = d.storageKey;
    }
    if (isObj(out.modes)) {
      if (!Array.isArray(out.modes.builtin)) out.modes.builtin = [];
      out.modes.userSaved = Object.assign(clone(DEFAULTS.userSaved), out.modes.userSaved || {});
    }
    if (isObj(out.pairing)) {
      if (!isInt(out.pairing.maxSpeakers)) out.pairing.maxSpeakers = DEFAULTS.pairing.maxSpeakers;
    }
    out.limits = Object.assign(clone(DEFAULTS.limits), out.limits || {});
    return out;
  }

  // ---------- catalogue ----------
  var state = { profiles: {}, byModelId: {}, errors: [], loaded: false };

  function validateCatalogue(data) {
    var errors = [];
    var profiles = [];
    if (!isObj(data)) return { ok: false, profiles: [], errors: ['catalogue không phải object'] };
    if (data.schemaVersion !== SCHEMA_VERSION)
      errors.push('catalogue schemaVersion ' + data.schemaVersion + ' không được hỗ trợ (loader hiểu ' + SCHEMA_VERSION + ') — bỏ toàn bộ catalogue');
    if (!Array.isArray(data.models) || data.models.length === 0) {
      errors.push('catalogue.models phải là mảng không rỗng');
      return { ok: false, profiles: [], errors: errors };
    }
    if (errors.length > 0) return { ok: false, profiles: [], errors: errors };
    var seenIds = {}, seenModelIds = {};
    data.models.forEach(function (raw, i) {
      var v = validateProfile(raw);
      var label = (raw && raw.id) ? raw.id : ('models[' + i + ']');
      if (!v.ok) { errors.push.apply(errors, v.errors); return; }
      if (seenIds[raw.id]) { errors.push(label + ': id trùng với profile khác — bỏ profile này'); return; }
      seenIds[raw.id] = true;
      var full = withDefaults(raw);
      profiles.push(full);
      (full.discovery.modelIds || [full.modelId]).forEach(function (mid) {
        if (seenModelIds[mid] && seenModelIds[mid] !== full.id)
          errors.push(label + ': modelId ' + mid + ' đã thuộc profile ' + seenModelIds[mid] + ' — modelId này giữ cho profile trước');
        else seenModelIds[mid] = full.id;
      });
    });
    return { ok: profiles.length > 0, profiles: profiles, errors: errors };
  }

  // Nạp catalogue từ object đã parse sẵn (dùng cho test + fallback nhúng).
  // Profile hỏng bị bỏ và ghi vào result.errors; profile tốt vẫn nạp được.
  // Trả về { ok, profiles, errors } — ok=true khi có ít nhất 1 profile hợp lệ.
  function loadCatalogue(data) {
    var res = validateCatalogue(data);
    state = { profiles: {}, byModelId: {}, errors: res.errors, loaded: res.profiles.length > 0 };
    res.profiles.forEach(function (p) {
      state.profiles[p.id] = p;
      (p.discovery.modelIds || [p.modelId]).forEach(function (mid) {
        if (!state.byModelId[mid]) state.byModelId[mid] = p;
      });
    });
    return { ok: state.loaded, profiles: res.profiles, errors: res.errors };
  }

  // Nạp catalogue từ URL (thường là 'speaker-profiles.json' cạnh file này).
  // Cần fetch(); trong môi trường không có fetch thì reject với lỗi rõ ràng.
  function loadCatalogueFromUrl(url) {
    var fetchFn = (typeof fetch === 'function') ? fetch : null;
    if (!fetchFn) return Promise.reject(new Error('loadCatalogueFromUrl: fetch() không có sẵn trong môi trường này — dùng loadCatalogue(object) thay thế'));
    return fetchFn(url).then(function (res) {
      if (!res.ok) throw new Error('loadCatalogueFromUrl: không tải được ' + url + ' (HTTP ' + res.status + ')');
      return res.json();
    }).then(function (data) { return loadCatalogue(data); });
  }

  // ---------- truy vấn ----------
  function getProfile(id) { return state.profiles[id] || null; }
  function getDefaultProfile() { return state.profiles[DEFAULT_PROFILE_ID] || null; }
  function getProfileByModelId(modelId) { return state.byModelId[modelId] || null; }
  function getAllProfiles() {
    return Object.keys(state.profiles).map(function (k) { return state.profiles[k]; });
  }
  function getLoadErrors() { return state.errors.slice(); }
  function isLoaded() { return state.loaded; }

  // Hợp của discovery toàn catalogue — dùng để dựng filter cho BLE chooser.
  function getDiscoveryFilters() {
    var services = {}, prefixes = {};
    getAllProfiles().forEach(function (p) {
      (p.discovery.serviceUuids || []).forEach(function (u) { services[u] = true; });
      (p.discovery.bleNamePrefixes || []).forEach(function (x) { prefixes[x] = true; });
    });
    return { services: Object.keys(services), namePrefixes: Object.keys(prefixes) };
  }

  function hasCommand(profile, logicalName) {
    return !!(profile && profile.protocol && isObj(profile.protocol.commands) && isInt(profile.protocol.commands[logicalName]));
  }

  // Tính năng có bật không, theo quy tắc: capability true VÀ có mã lệnh (trừ
  // tính năng phone-side thì chỉ cần capability). Chưa có featureBits firmware
  // thì chỉ xét profile (adapter sẽ gọi applyFirmwareFeatures sau khi GET_INFO).
  function isFeatureEnabled(profile, key) {
    if (!profile || !isObj(profile.capabilities) || profile.capabilities[key] !== true) return false;
    if (PHONE_SIDE_FEATURES.indexOf(key) !== -1) return true;
    var cmd = COMMAND_FOR_FEATURE[key];
    if (cmd) return hasCommand(profile, cmd);
    return true;
  }

  // Chọn profile theo kết quả bắt tay với loa (quy tắc SCALE-PLAN §2 / agent 2 §5):
  //  - có GET_INFO + modelId khớp catalogue -> profile đó;
  //  - có GET_INFO nhưng modelId lạ -> profile null, unknownModelId để UI hiện
  //    banner "loa VX mới" và chỉ bật chỉnh âm cơ bản (caller tự xử lý);
  //  - không có GET_INFO (firmware cũ < 2.1) -> mặc định mark 4.
  function resolveProfileForInfo(info) {
    info = info || {};
    if (info.hasInfo) {
      var p = isInt(info.modelId) ? getProfileByModelId(info.modelId) : null;
      if (p) return { profile: p, unknownModelId: null, fallbackUsed: false };
      return { profile: null, unknownModelId: info.modelId, fallbackUsed: false };
    }
    var def = getDefaultProfile();
    return { profile: def, unknownModelId: null, fallbackUsed: true };
  }

  // Runtime capability = profile ∩ firmware. featureBits là bitmask GET_INFO;
  // null/undefined (không có GET_INFO) thì dùng fallbackFeatures của profile.
  // Trả về { effective, dropped } — dropped là các tính năng profile có nhưng
  // firmware không có (UI phải ẩn hẳn, không để nút chết).
  function applyFirmwareFeatures(profile, featureBits) {
    if (!profile) return { effective: null, dropped: [] };
    var bits = (typeof featureBits === 'number')
      ? featureBits
      : (profile.firmware && isInt(profile.firmware.fallbackFeatures) ? profile.firmware.fallbackFeatures : 0);
    var effective = {};
    var dropped = [];
    CAPABILITY_KEYS.forEach(function (key) {
      if (PHONE_SIDE_FEATURES.indexOf(key) !== -1) { effective[key] = profile.capabilities[key] === true; return; }
      var bit = FEATURE_BITS[key];
      var on = profile.capabilities[key] === true && (typeof bit === 'undefined' || (bits & bit) !== 0);
      if (key === 'identify') on = on && hasCommand(profile, 'identify');
      effective[key] = on && isFeatureEnabled(profile, key);
      if (profile.capabilities[key] === true && !effective[key]) dropped.push(key);
    });
    return { effective: effective, dropped: dropped };
  }

  // ---------- helper cho UI / adapter ----------
  function getBand(profile, key) {
    if (!profile || !profile.tone || !Array.isArray(profile.tone.bands)) return null;
    for (var i = 0; i < profile.tone.bands.length; i++) if (profile.tone.bands[i].key === key) return profile.tone.bands[i];
    return null;
  }

  // Kẹp giá trị dB vào [minDb, maxDb] của band rồi làm tròn theo stepDb
  // (code cũ: Math.round(v * 2) / 2 với step 0,5 — đây là dạng tổng quát).
  function clampDb(profile, bandKey, value) {
    var band = getBand(profile, bandKey);
    if (!band) return null;
    var v = Math.max(band.minDb, Math.min(band.maxDb, Number(value)));
    var stepped = Math.round(v / band.stepDb) * band.stepDb;
    return Number(stepped.toFixed(3));
  }

  // Index của option placement để gửi qua SET_PLACEMENT (thứ tự = thứ tự options).
  function placementIndex(profile, placementId) {
    if (!profile || !profile.placement || !Array.isArray(profile.placement.options)) return -1;
    for (var i = 0; i < profile.placement.options.length; i++) if (profile.placement.options[i].id === placementId) return i;
    return -1;
  }

  // Key localStorage theo từng loa (đổi loa không lẫn chế độ/kết quả đo).
  // Vd: storageKeyFor(profile, 'vx.modes') -> 'vx.modes:vx-mark4'.
  function storageKeyFor(profile, baseKey) {
    if (!profile || !isNonEmptyString(baseKey)) return baseKey;
    return baseKey + ':' + profile.id;
  }

  function firmwareCommandName(logicalName) { return FIRMWARE_COMMAND_NAMES[logicalName] || null; }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_PROFILE_ID: DEFAULT_PROFILE_ID,
    FEATURE_BITS: clone(FEATURE_BITS),
    CAPABILITY_KEYS: CAPABILITY_KEYS.slice(),
    validateProfile: validateProfile,
    validateCatalogue: validateCatalogue,
    loadCatalogue: loadCatalogue,
    loadCatalogueFromUrl: loadCatalogueFromUrl,
    getProfile: getProfile,
    getDefaultProfile: getDefaultProfile,
    getProfileByModelId: getProfileByModelId,
    getAllProfiles: getAllProfiles,
    getLoadErrors: getLoadErrors,
    isLoaded: isLoaded,
    getDiscoveryFilters: getDiscoveryFilters,
    hasCommand: hasCommand,
    isFeatureEnabled: isFeatureEnabled,
    resolveProfileForInfo: resolveProfileForInfo,
    applyFirmwareFeatures: applyFirmwareFeatures,
    getBand: getBand,
    clampDb: clampDb,
    placementIndex: placementIndex,
    storageKeyFor: storageKeyFor,
    firmwareCommandName: firmwareCommandName
  };
}));

// ---------- Hướng dẫn nối vào www/index.html (cho agent UI, G1b) ----------
// 1. Chèn 2 dòng này NGAY TRƯỚC <script src="vx3d.js?v=3"></script>
//    (hiện ở cuối file, quanh dòng 1192-1193), giữ nguyên thứ tự:
//      <script src="speaker-profile.js?v=1"></script>
//    File JSON KHÔNG cần thẻ script — loader tự fetch nó lúc chạy:
//      const res = await VXSpeakerProfiles.loadCatalogueFromUrl('speaker-profiles.json');
//      if (!res.ok) { /* hiện lỗi, không dùng profile bịa */ }
//    Vì index.html chạy trong IIFE 'use strict' nên gọi loader qua window:
//      window.VXSpeakerProfiles.loadCatalogueFromUrl(...)
//    Lưu ý: phải load xong catalogue TRƯỚC khi code chính đọc GAIA_SERVICE /
//    TMAX / PLACES / MODELS — tức là await ở đầu script chính, trước mọi
//    khởi tạo dùng hằng số loa.
// 2. Thay hằng số hardcode bằng profile (mark 4 phải cho kết quả bit-identical):
//      const prof = VXSpeakerProfiles.getDefaultProfile();
//      GAIA_SERVICE / COMMAND / RESPONSE <- prof.protocol.serviceUuid / commandUuid / responseUuid
//      VX_VENDOR <- prof.protocol.vendorId (30296)
//      CMD_* <- prof.protocol.commands.getState / setTone / setPlacement / getInfo / tws /
//               setRoomEq / roomMeasure / roomEqEnable / setRole / identify
//      MAX_DIST <- prof.protocol.maxDistance (50)
//      TMAX <- { bass: prof.tone.bands[0].maxDb, treble: prof.tone.bands[1].maxDb }
//      PLACES / PLACE_NOTES <- prof.placement.options (id/label/note)
//      MODELS[4] (name/tagline/about/highlights/specs/image) <- prof (displayName/...)
//      ROOM_SWEEPS / ROOM_SPOTS / ROOM <- prof.room
//      builtin presets <- prof.modes.builtin (giữ nguyên, builtinModes=false nên UI vẫn ẩn)
//      RADIO <- prof.radio.builtinStations
// 3. Chọn profile lúc nối loa: sau GET_INFO, dùng
//      VXSpeakerProfiles.resolveProfileForInfo({ modelId: info.model, hasInfo: true })
//    rồi VXSpeakerProfiles.applyFirmwareFeatures(profile, info.features) để ẩn
//    tính năng firmware không có. Firmware cũ không có GET_INFO thì resolve với
//    { hasInfo: false } -> mặc định mark 4 (đúng fallback hiện tại).
// 4. KHÔNG sửa www/native-ble.js trong bước nối này; loader không đụng BLE.
