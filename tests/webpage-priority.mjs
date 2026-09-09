import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:900,height:500}});
 await page.setContent('<style>body{margin:0}p{height:100px;margin:0}</style>'+Array.from({length:60},(_,i)=>`<p>Paragraph number ${i}</p>`).join(''));
 await page.evaluate(()=>{
  window.chrome={runtime:{onMessage:{addListener(){}}}};
  window.requests=[];
  window.BrancyUtils={getSettings:async()=>({}),escapeHtml:t=>t,translationStageLabel:()=>'',translateProgressively(message,{onUpdate,isCurrent}){return new Promise(resolve=>requests.push({texts:message.texts,finish(){if(isCurrent())onUpdate({success:true,data:message.texts.map(()=> '中文')});resolve();}}));}};
  scrollTo(0,2000);
 });
 await page.addScriptTag({path:resolve(import.meta.dirname,'../content/webpage/webpage.js')});
 await page.evaluate(()=>{window.task=BrancyWebpage.translateCurrentPage();});
 await page.waitForFunction(()=>requests.length===1);
 assert.equal(await page.evaluate(()=>requests[0].texts[0]),'Paragraph number 20');
 await page.evaluate(()=>{scrollTo(0,5000);requests[0].finish();});
 await page.waitForFunction(()=>requests.length===2);
 assert.equal(await page.evaluate(()=>requests[1].texts.includes('Paragraph number 50')),true);
 await page.evaluate(()=>BrancyWebpage.restoreOriginalPage(false));
 await page.evaluate(()=>requests[1].finish());
 await page.evaluate(()=>task);
 assert.equal(await page.locator('.brancy-web-trans').count(),0);
 console.log('PASS: viewport text is translated first; scrolling reprioritizes remaining paragraphs; restore cancels safely.');
} finally {await browser.close();}
