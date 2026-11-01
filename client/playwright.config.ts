import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',fullyParallel:false,workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:5173',viewport:{width:1440,height:900},headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || (process.platform==='win32'?'msedge':'chromium'),launchOptions:{ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface'],args:['--disable-gpu']}},reporter:'list',outputDir:'test-results/artifacts'});



