// JSON calls to the local server; a failure throws with the server's message.
export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  // Read text first: a non-JSON error page (proxy, gateway) must still leave
  // something to report instead of dying in res.json() with a SyntaxError.
  const raw = await response.text().catch(() => '');
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { error: raw.slice(0, 200) || `HTTP ${response.status}` }; }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
