import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({contentType:'text/html',body:`
    <style>*{box-sizing:border-box}body{font:16px/1.4 sans-serif;margin:20px}h4{margin:0}.row{position:relative;height:64px;margin-bottom:14px}.card{display:flex;height:100%;border:1px solid #ddd;border-radius:8px;color:inherit;text-decoration:none}.icon{width:64px;flex:none;background:#faf5ff}.column{flex:1;overflow:hidden;white-space:nowrap;padding:0 16px}.heading{margin-top:10px;overflow:hidden;line-height:1.375}.title{display:flex;align-items:center;overflow:hidden}.title h4{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.meta{position:absolute;bottom:8px;max-width:100%;overflow:hidden;white-space:nowrap;padding:0 16px 0 80px;font-size:14px}.count{padding:10px}.plain{margin-top:30px}</style>
    ${['The question might be incomplete.','Could you clarify how much time is needed for the evaluation process to be completed?'].map((t,i)=>`<div class="row"><a class="card" href="/datasets/ikala/tmmluplus/discussions/${i+1}"><div class="icon"></div><div class="column"><div class="heading"><div class="title"><h4>${t}</h4></div></div></div><div class="count">1</div></a><div class="meta">#${i+1} opened over 1 year ago by author</div></div>`).join('')}
    <article class="plain"><p>A normal paragraph should retain the default translation layout.</p></article>`}));
  await page.goto('https://huggingface.co/datasets/ikala/tmmluplus/discussions');
  await page.addStyleTag({path:resolve(root,'content/webpage/webpage.css')});
  await page.evaluate(()=>{
    window.chrome={runtime:{onMessage:{addListener(){}}}};
    window.BrancyUtils={getSettings:async()=>({}),escapeHtml:t=>t,translationStageLabel:()=>'',
      async translateProgressively(message,{onUpdate}) {
        await new Promise(resolve=>window.finishTranslation=resolve);
        onUpdate({success:true,data:message.texts.map(()=> '您能否說明完成評估過程需要多長時間？'),stages:message.texts.map(()=> 'google-only')});
      }};
  });
  await page.addScriptTag({path:resolve(root,'content/webpage/webpage.js')});
  for (const width of [1200,390]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>{window.translation=BrancyWebpage.translateCurrentPage();});
    await page.waitForSelector('.brancy-hf-discussion-trans');
    async function check() {
      const geometry=await page.evaluate(()=>Array.from(document.querySelectorAll('.row')).map(row=>{
        const rect=s=>row.querySelector(s).getBoundingClientRect();
        return {sourceBottom:rect('h4').bottom,translationTop:rect('.brancy-web-trans').top,translationBottom:rect('.brancy-web-trans').bottom,metadataTop:rect('.meta').top,rowBottom:row.getBoundingClientRect().bottom,metadataBottom:rect('.meta').bottom};
      }));
      for(const g of geometry){assert.ok(g.sourceBottom<=g.translationTop);assert.ok(g.translationBottom<=g.metadataTop);assert.ok(g.metadataBottom<=g.rowBottom);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await check();
    await page.evaluate(()=>finishTranslation());
    await page.evaluate(()=>translation);
    await check();
    assert.equal(await page.locator('.plain .brancy-hf-discussion-trans').count(),0);
    await page.screenshot({path:resolve(root,`artifacts/huggingface-${width}.png`),fullPage:true});
    await page.evaluate(()=>BrancyWebpage.restoreOriginalPage(false));
    assert.equal(await page.locator('.brancy-hf-discussion-row').count(),0);
    assert.equal(await page.locator('.brancy-web-trans').count(),0);
    assert.deepEqual(await page.locator('.row').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height)),[64,64]);
  }
  console.log('PASS: Hugging Face discussion cards at desktop/mobile widths, loading/completed text, metadata separation, normal paragraphs and exact layout restoration.');
} finally { await browser.close(); }
