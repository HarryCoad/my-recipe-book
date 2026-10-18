import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import zlib from 'zlib';
import { Readable } from 'stream';
import AppError from '@utils/appError';
import { ErrorCode } from 'translations/errorCodes';

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; MyRecipeBook/1.0; +recipe import)';

// Addresses a user-supplied URL must never reach: this machine, private
// networks, link-local (including the cloud metadata endpoint 169.254.169.254)
// and other reserved ranges
const blockList = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockList.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockList.addSubnet(address, prefix, 'ipv6');
}

/** Whether an IP address is one a user-supplied URL isn't allowed to reach */
export const isBlockedAddress = (ip: string): boolean => {
  // IPv4 written as IPv6 (::ffff:127.0.0.1) is checked as the IPv4 address
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isBlockedAddress(mapped[1]);

  const family = net.isIP(ip);
  if (family === 0) return true;
  return blockList.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};

/** Parse a URL and check it's one we're willing to fetch */
export const checkUrl = (value: string, allowAnyPort = false): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(ErrorCode.Invalid_Url, 400);
  }

  // Default ports only, and no credentials in the URL
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (url.port !== '' && !allowAnyPort) ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new AppError(ErrorCode.Url_Not_Allowed, 400);
  }
  return url;
};

type IsBlocked = (ip: string) => boolean;

/**
 * Look up a host and check every address it has. Uses dns.resolve rather
 * than dns.lookup: lookup goes through the OS resolver, which is broken on
 * the dev machine (see server.ts). Checking every address, and connecting to
 * the one checked, stops a hostname pointing at an internal address, and DNS
 * rebinding between the check and the connection
 */
const resolveSafe = async (hostname: string, isBlocked: IsBlocked) => {
  // URL keeps IPv6 hosts in brackets
  const host = hostname.replace(/^\[|\]$/g, '');

  let addresses: { address: string; family: 4 | 6 }[];
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) as 4 | 6 }];
  } else {
    const [v4, v6] = await Promise.allSettled([
      dns.promises.resolve4(host),
      dns.promises.resolve6(host),
    ]);
    addresses = [
      ...(v4.status === 'fulfilled' ? v4.value : []).map((address) => ({
        address,
        family: 4 as const,
      })),
      ...(v6.status === 'fulfilled' ? v6.value : []).map((address) => ({
        address,
        family: 6 as const,
      })),
    ];
  }

  if (addresses.length === 0) {
    throw new AppError(ErrorCode.Fetch_Failed, 502);
  }
  if (addresses.some(({ address }) => isBlocked(address))) {
    throw new AppError(ErrorCode.Url_Not_Allowed, 400);
  }
  return addresses[0];
};

/** Undo gzip, deflate or brotli compression, if the server used it */
const decompress = (res: http.IncomingMessage): Readable => {
  switch (res.headers['content-encoding']) {
    case 'gzip':
      return res.pipe(zlib.createGunzip());
    case 'deflate':
      return res.pipe(zlib.createInflate());
    case 'br':
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
};

/** One request, without following redirects */
const request = (
  url: URL,
  address: { address: string; family: 4 | 6 },
  signal: AbortSignal,
) =>
  new Promise<
    | { redirect: string }
    | { html: string; contentType: string | undefined; status: number }
  >((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      {
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'gzip, deflate, br',
        },
        // Connect to the address that was checked, whatever DNS says now
        lookup: (_hostname, options, callback) => {
          if ((options as { all?: boolean }).all) {
            (
              callback as unknown as (
                err: null,
                addresses: { address: string; family: number }[],
              ) => void
            )(null, [address]);
          } else {
            callback(null, address.address, address.family);
          }
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: res.headers.location });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        const body = decompress(res);
        body.on('data', (chunk: Buffer) => {
          // Counted after decompression, so a small compressed page can't
          // expand into something huge
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new AppError(ErrorCode.Fetch_Failed, 502));
            return;
          }
          chunks.push(chunk);
        });
        body.on('end', () =>
          resolve({
            html: Buffer.concat(chunks).toString('utf8'),
            contentType: res.headers['content-type'],
            status,
          }),
        );
        body.on('error', () =>
          reject(new AppError(ErrorCode.Fetch_Failed, 502)),
        );
      },
    );
    req.on('error', () => reject(new AppError(ErrorCode.Fetch_Failed, 502)));
  });

/**
 * Fetch a web page from a URL a user gave us, safely: only public http(s)
 * addresses, at most 3 redirects (each one checked again), a 10 second limit
 * and a 2 MB size limit. Returns the HTML and the final URL after redirects.
 * The options are only for tests, to fetch from a local test server
 */
export const fetchPage = async (
  value: string,
  {
    isBlocked = isBlockedAddress,
    allowAnyPort = false,
  }: { isBlocked?: IsBlocked; allowAnyPort?: boolean } = {},
) => {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = checkUrl(value, allowAnyPort);

  for (let redirects = 0; ; redirects += 1) {
    const address = await resolveSafe(url.hostname, isBlocked);

    let result;
    try {
      result = await request(url, address, signal);
    } catch (err) {
      throw err instanceof AppError
        ? err
        : new AppError(ErrorCode.Fetch_Failed, 502);
    }

    if ('redirect' in result) {
      if (redirects >= MAX_REDIRECTS) {
        throw new AppError(ErrorCode.Fetch_Failed, 502);
      }
      url = checkUrl(new URL(result.redirect, url).toString(), allowAnyPort);
      continue;
    }

    const isHtml = /text\/html|application\/xhtml\+xml/i.test(
      result.contentType ?? '',
    );
    if (result.status < 200 || result.status >= 300 || !isHtml) {
      throw new AppError(ErrorCode.Fetch_Failed, 502);
    }
    return { html: result.html, finalUrl: url.toString() };
  }
};
