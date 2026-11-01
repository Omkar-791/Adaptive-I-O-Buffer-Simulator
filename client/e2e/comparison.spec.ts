import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

test('native matched pair, measured charts, resize timeline and complete downloads',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const sourceResponse=await request.post('/api/v1/runs',{data:{strategy:'fixed',config:{num_streams:2,buffer_capacity:2,global_buffer_budget:32,num_requests:200,producer_interval_ms:0,consumer_processing_ms:5,min_payload_bytes:64,max_payload_bytes:128,random_seed:42},metrics:{interval_ms:50,window_ms:100}}});
  expect(sourceResponse.status()).toBe(202);const source=await sourceResponse.json();
  await expect.poll(async()=> (await (await request.get(`/api/v1/runs/${source.id}`)).json()).status,{timeout:25000}).toBe('completed');
  await page.goto('/history');await page.locator('#analysis-source').selectOption(source.id);
  await page.getByRole('button',{name:'Launch matched pair',exact:true}).click();
  await expect(page).toHaveURL(/fixed=.+&adaptive=.+/);const url=new URL(page.url());const fixed=url.searchParams.get('fixed')!,adaptive=url.searchParams.get('adaptive')!;
  await expect(page.getByRole('table',{name:'Comparison measurements'})).toBeVisible({timeout:25000});
  const f=await (await request.get(`/api/v1/runs/${fixed}/result`)).json(),a=await (await request.get(`/api/v1/runs/${adaptive}/result`)).json();
  expect(f.total_consumed).toBe(400);expect(a.total_bytes).toBe(f.total_bytes);
  const analysis=page.getByRole('region',{name:'Experiment analysis'});await expect(analysis.locator('.event-list')).toContainText('Applied');await expect(analysis.locator('.recharts-bar-rectangle').first()).toBeVisible();
  for(const [key,label] of [['throughput_req_per_sec','Throughput'],['avg_latency_ms','Mean latency'],['total_producer_wait_ms','Producer waiting']]){
    const row=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:new RegExp(label)})});
    await expect(row).toContainText(f[key].toFixed(3));await expect(row).toContainText(a[key].toFixed(3));await expect(row).toContainText((a[key]-f[key]).toFixed(3));
  }
  await mkdir('test-results/screenshots',{recursive:true});
  for(const width of [1440,1280,1024,768,390]){
    await page.setViewportSize({width,height:width===390?844:900});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width===1440 || width===390)await analysis.screenshot({path:`test-results/screenshots/analysis-${width===390?'mobile':'desktop'}.png`});
  }
  const dataset:Record<string,unknown>={};
  for(const format of ['JSON','CSV']){
    const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:`Export ${format}`,exact:true}).click();const download=await downloaded;const file=`test-results/comparison.${format.toLowerCase()}`;await download.saveAs(file);
    const contents=await readFile(file,'utf8');expect(contents).toContain(fixed);expect(contents).toContain(adaptive);
    if(format==='JSON'){const data=JSON.parse(contents);expect(data.fixed.result).toEqual(f);expect(data.adaptive.result).toEqual(a);expect(data.comparisonUnavailable).toBeNull();expect(data.metrics).toHaveLength(3);expect(data.adaptive.records.some((e:{record:{type:string;success?:boolean}})=>e.record.type==='buffer_resize'&&e.record.success)).toBe(true);Object.assign(dataset,data)}
  }
  await page.reload();await expect(page.getByRole('table',{name:'Comparison measurements'})).toBeVisible();
  await writeFile('test-results/comparison-evidence.json',JSON.stringify({fixed,adaptive,source:source.id,errors,dataset},null,2));expect(errors).toEqual([]);
});
