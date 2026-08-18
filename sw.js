const CACHE_PREFIX = "inventory-cost-calculator";
const CACHE_VERSION = "v5";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const REGISTRATION_SCOPE = self.registration.scope;
const APP_SHELL_URL = new URL("./", REGISTRATION_SCOPE).href;
const CORE_URLS = ["./", "manifest.webmanifest", "favicon.svg"].map(
  (path) => new URL(path, REGISTRATION_SCOPE).href,
);
const CACHEABLE_DESTINATIONS = new Set([
  "audio",
  "font",
  "image",
  "manifest",
  "script",
  "style",
  "track",
  "video",
  "worker",
]);

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function canCacheResponse(response) {
  if (!response || !response.ok || !["basic", "default"].includes(response.type)) {
    return false;
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  return !/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl);
}

async function putIfCacheable(cache, request, response) {
  if (!canCacheResponse(response)) {
    return;
  }

  try {
    await cache.put(request, response.clone());
  } catch {
    // Some responses (for example Vary: *) cannot be written to Cache Storage.
  }
}

async function fetchAndCache(cache, request) {
  const response = await fetch(request);
  await putIfCacheable(cache, request, response);
  return response;
}

async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  const uniqueUrls = new Set(CORE_URLS);

  for (const candidate of Array.isArray(urls) ? urls.slice(0, 300) : []) {
    try {
      const url = new URL(candidate, REGISTRATION_SCOPE);
      if (isSameOrigin(url) && ["http:", "https:"].includes(url.protocol)) {
        uniqueUrls.add(url.href);
      }
    } catch {
      // Ignore malformed URLs supplied by a client.
    }
  }

  await Promise.allSettled(
    [...uniqueUrls].map(async (url) => {
      const request = new Request(url, {
        cache: "reload",
        credentials: "same-origin",
      });
      await fetchAndCache(cache, request);
    }),
  );
}

function offlineDocument() {
  return new Response(
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="theme-color" content="#0c79d8" />
    <title>暂时无法连接 · 库存成本计算器</title>
    <style>
      :root { color-scheme: light; font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f8fc; color: #10243e; padding: 24px; }
      main { width: min(100%, 520px); background: #fff; border: 1px solid #dce6f0; border-radius: 24px; padding: 36px; box-shadow: 0 20px 60px rgba(30, 79, 122, .12); }
      .mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 15px; background: #e7f3ff; color: #0c79d8; font-size: 24px; }
      h1 { margin: 24px 0 10px; font-size: clamp(24px, 5vw, 34px); line-height: 1.2; }
      p { margin: 0; color: #5b6d80; line-height: 1.75; }
      button { margin-top: 28px; border: 0; border-radius: 12px; padding: 12px 20px; background: #0c79d8; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
      button:focus-visible { outline: 3px solid #8dcaff; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">↻</div>
      <h1>当前处于离线状态</h1>
      <p>已缓存的页面和本地数据仍可继续使用。若这是首次打开，请恢复网络后再试一次。</p>
      <button type="button" onclick="location.reload()">重新连接</button>
    </main>
  </body>
</html>`,
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

async function navigationResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(request, { signal: controller.signal });
    await putIfCacheable(cache, request, response);
    return response;
  } catch {
    const exactMatch = await cache.match(request, { ignoreSearch: true });
    if (exactMatch) {
      return exactMatch;
    }

    const appShell = await cache.match(APP_SHELL_URL, { ignoreSearch: true });
    return appShell ?? offlineDocument();
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedResourceResponse(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetchAndCache(cache, request);

  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }

  return network;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await cacheUrls(CORE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_URLS") {
    event.waitUntil(cacheUrls(event.data.urls));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(cachedResourceResponse(request, event));
  }
});
