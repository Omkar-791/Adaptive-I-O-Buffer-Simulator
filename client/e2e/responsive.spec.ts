import {test,expect} from '@playwright/test';
test('pages settle without viewport overflow at all required widths',async({page})=>{
 for(const width of [1440,1280,1024,768,390]){
  await page.setViewportSize({width,height:900});
  for(const route of ['/','/simulations/new','/history','/architecture']){
   await page.goto(route);await expect(page.locator('h1')).toBeVisible();
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),{message:`${route} fits ${width}px`}).toBe(true);
  }
 }
});
test('dashboard empty and error states have useful actions',async({page})=>{
 await page.route('**/api/v1/runs?limit=100',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({runs:[]})}));
 await page.goto('/');await expect(page.getByRole('heading',{name:'No active simulation'})).toBeVisible();await expect(page.getByRole('link',{name:'Start Simulation',exact:true})).toHaveAttribute('href','/simulations/new');
 await page.unroute('**/api/v1/runs?limit=100');
 await page.route('**/api/v1/runs?limit=100',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'STOPPING',message:'Backend is stopping.'}})}));
 await page.getByRole('button',{name:'Refresh runs'}).click();await expect(page.getByRole('alert')).toContainText('Backend is stopping.');await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await page.unroute('**/api/v1/runs?limit=100');await page.route('**/api/v1/runs?limit=100',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({runs:[]})}));await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('heading',{name:'No active simulation'})).toBeVisible();
});

test('missing run is explained and mobile navigation works by keyboard',async({page})=>{
 await page.route('**/api/v1/runs/missing-run',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{code:'NOT_FOUND',message:'Run not found or no longer retained.'}})}));
 await page.goto('/runs/missing-run');await expect(page.getByRole('heading',{name:'Run unavailable'})).toBeVisible({timeout:15000});await expect(page.getByText(/Run not found or no longer retained/)).toBeVisible();
 await page.setViewportSize({width:390,height:844});const menu=page.getByRole('button',{name:'Open navigation',exact:true});await menu.focus();await expect(menu).toBeFocused();await menu.press('Enter');await expect(page.getByRole('button',{name:'Close navigation',exact:true}).last()).toBeVisible();
 const link=page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'New Simulation',exact:true});await link.focus();await expect(link).toBeFocused();await link.press('Enter');await expect(page).toHaveURL(/simulations\/new$/);await expect(page.locator('#streams')).toBeVisible();await expect(page.getByRole('button',{name:'Open navigation',exact:true})).toBeVisible();
});
