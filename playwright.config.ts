import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({ testDir:'tests', workers:1, timeout:45000, use:{baseURL:'http://127.0.0.1:4183',viewport:{width:1280,height:900},launchOptions:existsSync(chrome)?{executablePath:chrome}:{},trace:'retain-on-failure'},webServer:{command:'npm run dev',url:'http://127.0.0.1:4183',reuseExistingServer:true} });
