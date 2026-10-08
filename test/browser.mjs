import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import bundledChromium from '@sparticuz/chromium';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||await bundledChromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
const alice=await browser.newContext({viewport:{width:1440,height:1000}}),bob=await browser.newContext({viewport:{width:1280,height:900}});
const a=await alice.newPage(),b=await bob.newPage();const errors=[];
for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
try{
 await a.goto('http://localhost:3000');await a.screenshot({path:'artifacts/home-desktop.png',fullPage:true});
 await a.locator('#name').fill('Alice');await a.getByRole('button',{name:'Créer une table'}).click();await a.locator('#table').waitFor();
 const code=new URL(a.url()).searchParams.get('room');assert.ok(code);
 await b.goto('http://localhost:3000/?room='+code);await b.locator('#invite-form').waitFor();await b.locator('#name').fill('Bob');await b.getByRole('button',{name:'Rejoindre la table'}).click();await b.locator('#table').waitFor();
 await a.getByRole('button',{name:'Piocher une carte',exact:true}).click();await a.locator('.hand-card').waitFor();assert.equal(await b.locator('.hand-card').count(),0);
 await a.locator('.hand-card').first().click();await a.getByRole('button',{name:'Poser face cachée',exact:true}).click();await a.locator('.table-card').waitFor();
 await b.waitForFunction(()=>document.querySelectorAll('.table-card').length===1);assert.equal(await b.locator('.table-card').getAttribute('aria-label'),'Carte face cachée');
 const state=await (await b.request.get('http://localhost:3000/api/rooms?code='+code)).json();assert.equal(state.table[0].value,undefined);assert.equal(state.table[0].suit,undefined);assert.equal(state.hand.length,0);
 await b.locator('.table-card').click();await b.getByRole('button',{name:'Retourner',exact:true}).click();await b.waitForFunction(()=>document.querySelector('.table-card')?.getAttribute('aria-label')!=='Carte face cachée');
 await b.locator('.table-card').click();await b.getByRole('button',{name:'Prendre en main',exact:true}).click();await b.locator('.hand-card').waitFor();
 await b.locator('.hand-card').click();await b.getByRole('button',{name:'Donner',exact:true}).click();await b.locator('#give-form').waitFor();await b.locator('#give-form').getByRole('button',{name:'Donner',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('.hand-card').length===1);
 const hand=await a.locator('.hand-card').boundingBox();const table=await a.locator('#table').boundingBox();await a.mouse.move(hand.x+hand.width/2,hand.y+hand.height/2);await a.mouse.down();await a.mouse.move(table.x+table.width*.4,table.y+table.height*.5,{steps:10});await a.mouse.up();await a.locator('.table-card').waitFor();
 const ps=await (await a.request.get('http://localhost:3000/api/rooms?code='+code)).json();assert.ok(Math.abs(ps.table[0].x-40)<2);assert.equal(ps.table[0].faceUp,true);
 await a.getByRole('button',{name:'Cercle',exact:false}).click();await a.locator('#amount').fill('20');await a.getByRole('button',{name:'Confirmer',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('.table-card').length===21);
 await a.screenshot({path:'artifacts/table-desktop.png',fullPage:true});
 await a.getByRole('button',{name:'Remettre à zéro',exact:true}).click();await a.locator('dialog').getByRole('button',{name:'Remettre à zéro',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('.table-card').length===0);
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const m=await mobile.newPage();m.on('pageerror',e=>errors.push(e.message));await m.goto('http://localhost:3000');await m.screenshot({path:'artifacts/home-mobile.png',fullPage:true});assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await m.goto('http://localhost:3000/?room='+code);await m.locator('#name').fill('Mobile');await m.getByRole('button',{name:'Rejoindre la table'}).click();await m.locator('#table').waitFor();await m.getByRole('button',{name:'Piocher une carte',exact:true}).tap();await m.locator('.hand-card').waitFor();await m.locator('.hand-card').tap();await m.getByRole('button',{name:'Poser ↑',exact:true}).tap();await m.locator('.table-card').waitFor();await m.screenshot({path:'artifacts/table-mobile.png',fullPage:true});assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS: multiplayer room, private cards, flip, take, give, drag, circle, reset, mobile touch, no overflow or JS errors.');
}finally{await browser.close();}
