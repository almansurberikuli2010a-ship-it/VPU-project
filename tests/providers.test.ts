import {config} from "../server/config.js";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessImage, serper, imageRecords, resolveUniversity} from '../server/providers.js';
import {AppError} from '../server/errors.js';

const assessment = {category: 'campus', is_relevant: true, confidence: 0.91, reasoning: 'Visible identity supported by source.', duplicate_risk: 'unknown', tags: ['architecture']};
const generated = (data: unknown) => new Response(JSON.stringify({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(data)}]}}]}), {status: 200});

test('Gemini adapter sends level-one JSON and actual image bytes, then parses level two', async t => {
  const provider = config.AI_PROVIDER; config.AI_PROVIDER = 'gemini'; t.after(() => {config.AI_PROVIDER = provider;});
  let sent: Record<string, any> | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/[^/]+:generateContent$/);
    sent = JSON.parse(String(init.body));
    return generated(assessment);
  });
  const input = {university_name: 'Test', image_url: 'https://example.com/photo.jpg', image_context: 'Untrusted source context'};
  const result = await assessImage(input, Buffer.from('real image bytes in production'), new AbortController().signal);
  assert.deepEqual(result, assessment);
  assert.deepEqual(JSON.parse(sent!.contents[0].parts[0].text), input);
  assert.equal(sent!.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(sent!.contents[0].parts[1].inlineData.data, 'base64').toString(), 'real image bytes in production');
  assert.equal(sent!.generationConfig.responseMimeType, 'application/json');
  assert(sent!.generationConfig.responseJsonSchema.properties.reasoning);
  assert(!sent!.generationConfig.responseJsonSchema.properties.categories);
});
test('Gemini malformed output and rate limits remain explicit failures', async t => {
  const provider = config.AI_PROVIDER; config.AI_PROVIDER = 'gemini'; t.after(() => {config.AI_PROVIDER = provider;});
  const mock = t.mock.method(globalThis, 'fetch', async () => generated({...assessment, confidence: 'very high'}));
  const input = {university_name: 'Test', image_url: 'https://example.com/photo.jpg', image_context: ''};
  await assert.rejects(assessImage(input, Buffer.from('image'), new AbortController().signal), e => e instanceof AppError && e.code === 'AI_INVALID_RESPONSE');
  mock.mock.mockImplementation(async () => new Response('{}', {status: 429}));
  await assert.rejects(assessImage(input, Buffer.from('image'), new AbortController().signal), e => e instanceof AppError && e.code === 'AI_RATE_LIMITED');
});
test('Serper adapter uses Images endpoint and its actual fields, not SerpAPI fields', async t => {
  const provider = config.AI_PROVIDER; config.AI_PROVIDER = 'gemini'; t.after(() => {config.AI_PROVIDER = provider;});
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://google.serper.dev/images');
    assert.equal(JSON.parse(String(init.body)).q, 'Test campus');
    return new Response(JSON.stringify({images: [{title: 'Campus', imageUrl: 'https://example.com/a.jpg', link: 'https://example.com/gallery'}]}));
  });
  const result = imageRecords(await serper('images', 'Test campus', new AbortController().signal));
  assert.equal(result[0].imageUrl, 'https://example.com/a.jpg');
  assert.equal(result[0].link, 'https://example.com/gallery');
});
test('university resolver rejects references to nonexistent retrieved sources', async t => {
  const provider = config.AI_PROVIDER; config.AI_PROVIDER = 'gemini'; t.after(() => {config.AI_PROVIDER = provider;});
  t.mock.method(globalThis, 'fetch', async (url: string) => url.includes('serper.dev') ?
    new Response(JSON.stringify({organic: [{title: 'Test university', link: 'https://example.edu', snippet: 'Test university in Test City.'}]})) :
    generated({candidates: [{name: 'Invented', location: 'Test', city: 'Test', description: 'Test', source_indices: [99], official_source_index: 99}]}));
  await assert.rejects(resolveUniversity('Test', new AbortController().signal), e => e instanceof AppError && e.code === 'AI_INVALID_RESPONSE');
});
