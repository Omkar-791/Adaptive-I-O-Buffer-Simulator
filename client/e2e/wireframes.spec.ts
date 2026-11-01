import {test,expect} from '@playwright/test';
import {readdir,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';

test('render nine wireframes for visual inspection',async({page})=>{const root=path.resolve('../docs/design/wireframes');const output=path.resolve('test-results/wireframes');await mkdir(output,{recursive:true});const names=(await readdir(root)).filter(name=>name.endsWith('.svg'));expect(names).toHaveLength(9);for(const name of names){const source=await readFile(path.join(root,name),'utf8');const width=name.includes('mobile')?390:1440;await page.setViewportSize({width,height:900});await page.setContent('<!doctype html><html><body style="margin:0">'+source+'</body></html>');expect(await page.locator('svg').count()).toBe(1);const height=Number(source.match(/height="(\d+)"/)?.[1]||900);await page.setViewportSize({width,height});await page.screenshot({path:path.join(output,name.replace('.svg','.png')),fullPage:true})}});

