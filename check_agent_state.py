import asyncio
import json
from playwright.async_api import async_playwright

async def check_agent_state():
    project_id = "15e493d2-6465-4a3d-956f-a11c18d41e96"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        context = browser.contexts[0]
        page = [pg for pg in context.pages if 'labs.google' in pg.url][0]

        session = await page.evaluate("async () => await (await fetch('/fx/api/auth/session')).json()")
        access_token = session['access_token']

        # Check agentInfo state
        res = await page.evaluate("""async (args) => {
            const r = await fetch('https://aisandbox-pa.googleapis.com/v1/projects/' + args.projectId + '/agentInfo');
            return { status: r.status, json: await r.json() };
        }""", {'token': access_token, 'projectId': project_id})
        print('[+] agentInfo state:', res)

        # Check for agent toggle in UI
        ui_state = await page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim().replace(/\\n/g, ' ')).filter(Boolean);
            const hasAgentBtn = buttons.some(t => t.includes('Tác nhân'));
            const switches = Array.from(document.querySelectorAll('[role="switch"], input[type="checkbox"]')).map(s => ({ role: s.getAttribute('role'), checked: s.checked || s.getAttribute('aria-checked') }));
            return { buttons: buttons.slice(-10), hasAgentBtn, switches };
        }""")
        print('[+] UI state:', json.dumps(ui_state, indent=2, ensure_ascii=False))

asyncio.run(check_agent_state())
