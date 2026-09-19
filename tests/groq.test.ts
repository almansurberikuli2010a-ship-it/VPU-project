import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config, aiConfigured} from '../server/config.js';
import {assessImage, resolveUniversity} from '../server/providers.js';
import {AppError} from '../server/errors.js';
const input={university_name:'Test',image_url:'https://example.edu/a.jpg',image_context:'source'};
const assessment={category:'campus',is_relevant:true,confidence:0.9,reasoning:'Exact evidence.',duplicate_risk:'unknown',tags:['architecture']};
const reply=(data:unknown,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:JSON.stringify(data)}}]}));
test('Groq routing sends pixels and metadata, validates assessment and uses only selected credentials',async t=>{
 const old={...config}; Object.assign(config,{AI_PROVIDER:'groq',GROQ_API_KEY:'test-secret',GEMINI_API_KEY:''}); t.after(()=>Object.assign(config,old));
 assert(aiConfigured());
 t.mock.method(globalThis,'fetch',async(url: string | URL | Request,init?: RequestInit)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal((init!.headers as Record<string,string>).Authorization,'Bearer test-secret');
  const body=JSON.parse(String(init!.body));
  assert.equal(body.response_format.type,'json_object');
  assert.deepEqual(JSON.parse(body.messages[1].content[0].text),input);
  assert.equal(body.messages[1].content[1].image_url.url,'data:image/jpeg;base64,aW1hZ2U=');
  return reply(assessment);
 });
 assert.deepEqual(await assessImage(input,Buffer.from('image'),new AbortController().signal),assessment);
 config.GROQ_API_KEY='';config.GEMINI_API_KEY='unused';assert.equal(aiConfigured(),false);
});
test('Groq rejects invalid schemas, truncated output, auth failures and quotas without leaking provider body',async t=>{
 const old=config.AI_PROVIDER;config.AI_PROVIDER='groq';t.after(()=>{config.AI_PROVIDER=old;});
 const mock=t.mock.method(globalThis,'fetch',async()=>reply({...assessment,confidence:'high'}));
 const call=()=>assessImage(input,Buffer.from('image'),new AbortController().signal);
 await assert.rejects(call(),(e:unknown)=>e instanceof AppError&&e.code==='AI_INVALID_RESPONSE');
 mock.mock.mockImplementation(async()=>reply(assessment,'length'));
 await assert.rejects(call(),(e:unknown)=>e instanceof AppError&&e.code==='AI_INVALID_RESPONSE');
 for(const [status,code] of [[429,'AI_RATE_LIMITED'],[401,'AI_ACCESS_DENIED'],[404,'AI_MODEL_UNAVAILABLE']] as const){
  mock.mock.mockImplementation(async()=>new Response('secret provider body',{status,headers:{'retry-after':'12'}}));
  await assert.rejects(call(),(e:unknown)=>e instanceof AppError&&e.code===code&&!e.message.includes('secret provider body'));
 }
});
test('Groq resolves university from Serper evidence without image attachment',async t=>{
 const old=config.AI_PROVIDER;config.AI_PROVIDER='groq';t.after(()=>{config.AI_PROVIDER=old;});
 t.mock.method(globalThis,'fetch',async(url: string | URL | Request,init?: RequestInit)=>{
  if(String(url).includes('serper.dev'))return new Response(JSON.stringify({organic:[{title:'Test University',link:'https://example.edu',snippet:'Test City'}]}));
  const body=JSON.parse(String(init!.body));assert.equal(body.messages[1].content.length,1);
  return reply({candidates:[{name:'Test University',location:'Test City',city:'Test City',description:'University',source_indices:[0],official_source_index:0}]});
 });
 const result=await resolveUniversity('Test University',new AbortController().signal);
 assert.equal(result[0].officialDomain,'example.edu');
});
