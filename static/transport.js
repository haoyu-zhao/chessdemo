'use strict';
window.QueenAPI = (() => {
  const config = window.QUEEN_CONFIG || {};
  const remote = !!config.endpointSources?.length;
  const tokenKey = 'queen-pages-session';
  const originKey = 'queen-api-origin';
  const validOrigin = value => typeof value === 'string' && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(value);
  let apiOrigin = remote ? localStorage.getItem(originKey) || '' : '';
  if (remote && !validOrigin(apiOrigin)) apiOrigin = '';
  let checkedAt = 0, resolving = null;

  async function resolve(force = false) {
    if (!remote) return '';
    if (!force && apiOrigin && Date.now() - checkedAt < 30000) return apiOrigin;
    if (resolving) return resolving;
    resolving = (async () => {
      for (const source of config.endpointSources) {
        if (source !== config.endpointSources[0] && apiOrigin) return apiOrigin;
        try {
          const url = new URL(source, document.baseURI);
          url.searchParams.set('v', Math.floor(Date.now() / 10000));
          const response = await fetch(url, {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000)});
          if (!response.ok) continue;
          const data = await response.json();
          if (!validOrigin(data.api_origin)) continue;
          apiOrigin = data.api_origin;
          checkedAt = Date.now();
          localStorage.setItem(originKey, apiOrigin);
          return apiOrigin;
        } catch { /* Try the next published endpoint source. */ }
      }
      if (apiOrigin) return apiOrigin;
      throw Error('The service is reconnecting. Please try again shortly.');
    })();
    try { return await resolving; } finally { resolving = null; }
  }

  async function send(path, body) {
    const before = await resolve();
    const headers = {'X-Queen-Client': '1'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (remote) {
      headers['X-Queen-Auth'] = 'bearer';
      const token = localStorage.getItem(tokenKey);
      if (token) headers.Authorization = 'Bearer ' + token;
    }
    const options = {method: body === undefined ? 'GET' : 'POST', headers,
      credentials: remote ? 'omit' : 'same-origin', cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body)};
    const perform = origin => fetch(origin + '/api' + path, {...options, signal: AbortSignal.timeout(20000)});
    let response;
    try {
      response = await perform(before);
    } catch (error) {
      const after = await resolve(true);
      // GET is safe to retry. Never replay an uncertain mutation automatically.
      if (body === undefined && after !== before) response = await perform(after);
      else throw Error('Connection interrupted. Please retry or refresh to resume your saved game.');
    }
    if (response.status >= 500 && remote) {
      const after = await resolve(true);
      if (body === undefined && after !== before) response = await perform(after);
    }
    if (!response.ok) {
      let data;
      try { data = await response.json(); } catch { data = {}; }
      const error = Error(typeof data.detail === 'string' ? data.detail : 'The service is temporarily unavailable.');
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async function request(path, body) {
    const response = await send(path, body);
    const data = await response.json();
    if (remote && path === '/login' && data.token) localStorage.setItem(tokenKey, data.token);
    return data;
  }

  async function download(path, filename) {
    const response = await send(path);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {request, download, resolve,
    shareBase: config.shareBase || new URL('./', document.baseURI).href};
})();
