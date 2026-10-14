// Demo PIM mock API (Netlify Function). Stateless: results are derived from the job ID.
var RETAILERS = {
  RetailerA: { code: 'A', rate: 0.04, rule: 'Title max 80 characters, images min 1000px' },
  RetailerB: { code: 'B', rate: 0.07, rule: 'Allergen and nutrition data mandatory' }
};
var REASON_TEXT = {
  INVALID_GTIN_CHECK_DIGIT: 'GTIN check digit is invalid.',
  MISSING_REQUIRED_ATTRIBUTE: "Required attribute 'net_content' is missing.",
  TITLE_TOO_LONG: 'Product title exceeds 80 characters for RetailerA.',
  ALLERGEN_DATA_MISSING: 'Allergen declaration is required for RetailerB.'
};
function gtinCheck(d12) {
  var s = 0;
  for (var i = 0; i < 12; i++) s += Number(d12.charAt(i)) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}
function parseJob(id) {
  var m = /^JOB-(\d+)-([AB])-([A-Z0-9]{6})$/.exec(id || '');
  if (!m) return null;
  return { id: id, count: Number(m[1]), retailer: m[2] === 'A' ? 'RetailerA' : 'RetailerB', tag: m[3] };
}
function seedOf(tag) {
  var n = 0;
  for (var i = 0; i < tag.length; i++) n += tag.charCodeAt(i);
  return n % 9000;
}
function summarize(job) {
  var cfg = RETAILERS[job.retailer];
  var rejected = Math.round(job.count * cfg.rate);
  var valid = job.count - rejected;
  var gtin = Math.round(rejected * 0.4);
  var missing = Math.round(rejected * 0.35);
  var third = rejected - gtin - missing;
  var thirdCode = job.retailer === 'RetailerA' ? 'TITLE_TOO_LONG' : 'ALLERGEN_DATA_MISSING';
  var reasons = [
    { code: 'INVALID_GTIN_CHECK_DIGIT', count: gtin },
    { code: 'MISSING_REQUIRED_ATTRIBUTE', count: missing },
    { code: thirdCode, count: third }
  ].filter(function (r) { return r.count > 0; });
  return {
    jobId: job.id, status: 'COMPLETED', retailer: job.retailer,
    recordCount: job.count, validCount: valid, rejectedCount: rejected,
    qualityScore: Math.round((valid / job.count) * 1000) / 10,
    reasons: reasons
  };
}
function sampleRejections(job) {
  var s = summarize(job);
  if (!s.reasons.length) return [];
  var seed = seedOf(job.tag);
  var out = [];
  var n = Math.min(5, s.rejectedCount);
  for (var i = 0; i < n; i++) {
    var code = s.reasons[i % s.reasons.length].code;
    var base = '5901234' + String(10000 + ((seed + i * 37) % 89999)).slice(0, 5);
    var good = gtinCheck(base);
    var bad = code === 'INVALID_GTIN_CHECK_DIGIT' ? (good + 1) % 10 : good;
    var msg = REASON_TEXT[code];
    if (code === 'INVALID_GTIN_CHECK_DIGIT') msg = 'GTIN check digit is invalid. Expected ' + good + ', found ' + bad + '.';
    out.push({ sku: 'SKU-' + (100001 + seed + i), gtin: base + bad, reasonCode: code, reason: msg });
  }
  return out;
}
function res(status, json) { return { status: status, json: json }; }
function err(status, code, message) { return res(status, { error: code, message: message }); }
function route(method, path, body, query) {
  path = (path || '/').replace(/\/+$/, '') || '/';
  body = body || {}; query = query || {};
  var m, job;
  if (method === 'GET' && path === '/health')
    return res(200, { status: 'UP', service: 'demo-pim-api', version: '1.0.0', timestamp: new Date().toISOString() });

  if (method === 'POST' && path === '/imports') {
    var name = String(body.fileName || '');
    var count = body.recordCount;
    if (!/\.(csv|xlsx)$/i.test(name)) return err(400, 'UNSUPPORTED_FILE_TYPE', 'fileName must end with .csv or .xlsx.');
    if (typeof count !== 'number' || !isFinite(count) || Math.floor(count) !== count || count < 1 || count > 1000000)
      return err(400, 'INVALID_RECORD_COUNT', 'recordCount must be a whole number between 1 and 1,000,000.');
    if (!RETAILERS[body.retailer]) return err(400, 'UNKNOWN_RETAILER', 'retailer must be RetailerA or RetailerB.');
    var tag = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(6, 'X').slice(0, 6);
    return res(202, { jobId: 'JOB-' + count + '-' + RETAILERS[body.retailer].code + '-' + tag, status: 'QUEUED',
      fileName: name, recordCount: count, retailer: body.retailer });
  }
  if ((m = /^\/imports\/([^\/]+)\/rejections$/.exec(path)) && method === 'GET') {
    job = parseJob(m[1]);
    if (!job) return err(404, 'JOB_NOT_FOUND', 'No import job with that ID.');
    return res(200, { jobId: job.id, rejections: sampleRejections(job) });
  }
  if ((m = /^\/imports\/([^\/]+)$/.exec(path)) && method === 'GET') {
    job = parseJob(m[1]);
    if (!job) return err(404, 'JOB_NOT_FOUND', 'No import job with that ID.');
    return res(200, summarize(job));
  }
  if (method === 'POST' && path === '/records/bulk-edit') {
    job = parseJob(body.jobId);
    if (!job) return err(404, 'JOB_NOT_FOUND', 'No import job with that ID.');
    var ops = ['CONVERT_UNITS_OZ_TO_G', 'NORMALIZE_BRAND_NAME', 'SET_COUNTRY_OF_ORIGIN'];
    if (ops.indexOf(body.operation) < 0) return err(400, 'UNKNOWN_OPERATION', 'operation must be one of ' + ops.join(', ') + '.');
    var n = body.recordCount;
    if (typeof n !== 'number' || Math.floor(n) !== n || n < 1) return err(400, 'INVALID_RECORD_COUNT', 'recordCount must be a whole number of at least 1.');
    var sm = summarize(job);
    var updated = Math.min(n, sm.validCount);
    return res(200, { jobId: job.id, operation: body.operation, requested: n, updated: updated,
      failed: 0, auditId: 'AUD-' + job.id.slice(4) + '-' + ops.indexOf(body.operation) });
  }
  if (method === 'POST' && path === '/syndications') {
    job = parseJob(body.jobId);
    if (!job) return err(404, 'JOB_NOT_FOUND', 'No import job with that ID.');
    if (!RETAILERS[body.retailer]) return err(400, 'UNKNOWN_RETAILER', 'retailer must be RetailerA or RetailerB.');
    if (body.retailer !== job.retailer)
      return err(409, 'RETAILER_MISMATCH', 'This job was validated against ' + job.retailer + '. Re-validate before sending to ' + body.retailer + '.');
    var s2 = summarize(job);
    return res(202, { syndicationId: 'SYN-' + job.id.slice(4), jobId: job.id, retailer: job.retailer,
      status: 'ACCEPTED', recordsSent: s2.validCount, recordsSkipped: s2.rejectedCount });
  }
  if ((m = /^\/syndications\/(SYN-[^\/]+)$/.exec(path)) && method === 'GET') {
    job = parseJob('JOB-' + m[1].slice(4));
    if (!job) return err(404, 'SYNDICATION_NOT_FOUND', 'No syndication with that ID.');
    var s3 = summarize(job);
    return res(200, { syndicationId: m[1], jobId: job.id, retailer: job.retailer, status: 'DELIVERED',
      recordsSent: s3.validCount, recordsSkipped: s3.rejectedCount });
  }
  if (method === 'GET' && path === '/gtin/validate') {
    var g = String(query.gtin || '');
    if (!/^\d{13}$/.test(g)) return err(400, 'INVALID_GTIN_FORMAT', 'gtin must be exactly 13 digits.');
    var exp = gtinCheck(g.slice(0, 12));
    return res(200, { gtin: g, valid: exp === Number(g.charAt(12)), expectedCheckDigit: exp });
  }
  return err(404, 'NOT_FOUND', 'No route for ' + method + ' ' + path + '.');
}

var CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  var path = (event.path || '/').replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';
  var body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'INVALID_JSON', message: 'Request body is not valid JSON.' }) }; }
  var r = route(event.httpMethod, path, body, event.queryStringParameters || {});
  return { statusCode: r.status, headers: CORS, body: JSON.stringify(r.json) };
};
