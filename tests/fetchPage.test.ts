import http from 'http';
import { AddressInfo } from 'net';
import zlib from 'zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkUrl,
  fetchPage,
  isBlockedAddress,
} from '@utils/recipeImport/fetchPage';
import { ErrorCode } from 'translations/errorCodes';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata endpoint
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not an ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700::1111'])(
    'allows public address %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});

describe('checkUrl', () => {
  it('rejects a malformed URL', () => {
    expect(() => checkUrl('not a url')).toThrow(ErrorCode.Invalid_Url);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/recipe',
    'javascript:alert(1)',
    'http://example.com:8080/recipe',
    'https://user:pass@example.com/recipe',
  ])('rejects %s', (url) => {
    expect(() => checkUrl(url)).toThrow(ErrorCode.Url_Not_Allowed);
  });

  it('accepts a normal http(s) URL', () => {
    expect(checkUrl('https://example.com/pancakes').hostname).toBe(
      'example.com',
    );
  });
});

describe('fetchPage', () => {
  it('refuses private addresses before connecting', async () => {
    await expect(fetchPage('http://127.0.0.1/recipe')).rejects.toThrow(
      ErrorCode.Url_Not_Allowed,
    );
    await expect(fetchPage('http://169.254.169.254/latest')).rejects.toThrow(
      ErrorCode.Url_Not_Allowed,
    );
    await expect(fetchPage('http://[::1]/recipe')).rejects.toThrow(
      ErrorCode.Url_Not_Allowed,
    );
  });

  // A local test server. Real imports can't reach 127.0.0.1 or non-default
  // ports, so these requests swap in a block check that allows 127.0.0.1
  // (everything else stays blocked) and allow the server's random port
  let server: http.Server;
  let port: number;
  const allowLoopback = (ip: string) =>
    ip !== '127.0.0.1' && isBlockedAddress(ip);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case '/recipe':
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1>Pancakes</h1></body></html>');
          break;
        case '/gzip':
          res.writeHead(200, {
            'content-type': 'text/html',
            'content-encoding': 'gzip',
          });
          res.end(zlib.gzipSync('<html><body>Zipped</body></html>'));
          break;
        case '/redirect':
          res.writeHead(302, { location: '/recipe' });
          res.end();
          break;
        case '/redirect-private':
          res.writeHead(302, { location: 'http://10.0.0.1/recipe' });
          res.end();
          break;
        case '/loop':
          res.writeHead(302, { location: '/loop' });
          res.end();
          break;
        case '/json':
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
          break;
        case '/missing':
          res.writeHead(404, { 'content-type': 'text/html' });
          res.end('Not found');
          break;
        case '/huge':
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('x'.repeat(3 * 1024 * 1024));
          break;
        default:
          res.writeHead(500);
          res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const get = (path: string) =>
    fetchPage(`http://127.0.0.1:${port}${path}`, {
      isBlocked: allowLoopback,
      allowAnyPort: true,
    });

  it('returns the page and its final URL', async () => {
    const { html, finalUrl } = await get('/recipe');

    expect(html).toContain('Pancakes');
    expect(finalUrl).toBe(`http://127.0.0.1:${port}/recipe`);
  });

  it('decompresses gzipped pages', async () => {
    const { html } = await get('/gzip');

    expect(html).toContain('Zipped');
  });

  it('follows redirects, returning the final URL', async () => {
    const { finalUrl } = await get('/redirect');

    expect(finalUrl).toBe(`http://127.0.0.1:${port}/recipe`);
  });

  it('checks each redirect, refusing ones to private addresses', async () => {
    await expect(get('/redirect-private')).rejects.toThrow(
      ErrorCode.Url_Not_Allowed,
    );
  });

  it.each([
    ['too many redirects', '/loop'],
    ["a page that isn't HTML", '/json'],
    ['an error status', '/missing'],
    ['a page over 2 MB', '/huge'],
  ])('fails on %s', async (_label, path) => {
    await expect(get(path)).rejects.toThrow(ErrorCode.Fetch_Failed);
  });
});
