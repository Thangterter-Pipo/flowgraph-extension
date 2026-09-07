import puppeteer from 'puppeteer';
const port = Number(process.argv[2] || 9225);
const browser = await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`, defaultViewport:null});
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('/project/9125da34-52c4-4f38-a8cc-7d6e1bb31483')) || pages.find(p=>p.url().includes('tools/flow'));
if(!page){console.error('TARGET_NOT_FOUND');process.exitCode=2;} else {
  const data = await page.evaluate(async()=>{
    const r=await fetch('https://labs.google/fx/api/auth/session',{credentials:'include'});
    const j=await r.json().catch(()=>null);
    return {url:location.href,title:document.title,body:(document.body?.innerText||'').slice(0,1200),sessionStatus:r.status,hasAccessToken:!!j?.access_token,user:j?.user?{email:j.user.email,name:j.user.name}:null,hasGrecaptcha:!!(window.grecaptcha?.enterprise?.execute),editors:document.querySelectorAll('[contenteditable=true]').length};
  });
  console.log(JSON.stringify(data,null,2));
}
await browser.disconnect();
