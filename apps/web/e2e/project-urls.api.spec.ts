import { expect, test } from '@playwright/test';
import { normalizeSiteUrl, projectOrigins, projectUrlsSchema } from '../src/lib/app/projects';

test('local development addresses default to HTTP and retain their port and path', () => {
    for (const [input, expected] of [
        ['localhost', 'http://localhost'],
        [' LOCALHOST:3000/app/?tab=details#section ', 'http://localhost:3000/app'],
        ['localhost:443', 'http://localhost:443'],
        ['localhost:80', 'http://localhost'],
        ['localhost.:3000', 'http://localhost.:3000'],
        ['preview.localhost:5173/', 'http://preview.localhost:5173'],
        ['127.0.0.1:8080/app/', 'http://127.0.0.1:8080/app'],
        ['127.0.0.2:3000', 'http://127.0.0.2:3000'],
        ['[::1]:3000/', 'http://[::1]:3000'],
        ['https://localhost:3000/', 'https://localhost:3000'],
        ['https://localhost:80', 'https://localhost:80'],
        ['https://[::1]:3000', 'https://[::1]:3000'],
        ['http://example.com:8080/app/', 'http://example.com:8080/app'],
        ['example.com:80/', 'https://example.com:80'],
        ['localhost.example.com:3000', 'https://localhost.example.com:3000'],
        ['127.example.com:3000', 'https://127.example.com:3000'],
        ['192.168.1.2:3000', 'https://192.168.1.2:3000'],
    ]) {
        expect(normalizeSiteUrl(input!), input).toBe(expected);
    }
});

test('local addresses retain website validation', () => {
    for (const input of ['', 'not a site', 'http://localhost:65536', 'ftp://localhost:3000',
        'https://user:password@localhost:3000', 'javascript:alert(1)', '[::1', 'localhost:abc']) {
        expect(projectUrlsSchema.safeParse([input]).success, input).toBe(false);
    }
});

test('local address deduplication preserves distinct schemes and ports', () => {
    const urls = projectUrlsSchema.parse(['localhost:3000/', 'http://localhost:3000',
        'https://localhost:3000', 'localhost:3001']);
    expect(urls).toEqual(['http://localhost:3000', 'https://localhost:3000', 'http://localhost:3001']);
    expect(projectOrigins({ urls })).toEqual(urls);
});
