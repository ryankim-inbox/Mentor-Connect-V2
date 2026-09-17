import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { restrictSmokeOrigin } from "../scripts/smoke-classroom.mjs";

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

for (const status of [307, 308]) {
  test(`smoke blocks ${status} UI login and navigation redirects before reaching a foreign origin`, async ({ browser }) => {
    let foreignRequests = 0;
    let credentialBodies = 0;
    let allowedOrigin = "";
    const foreign = createServer(async (req, res) => {
      foreignRequests++;
      let body = "";
      for await (const chunk of req) body += chunk;
      if (body.includes("synthetic-redirect-password")) credentialBodies++;
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": req.headers.origin ?? allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      });
      res.end('{}');
    });
    const foreignOrigin = await listen(foreign);
    let loginPosts = 0;
    const allowed = createServer((req, res) => {
      if (req.url === "/api/auth/login" || req.url === "/navigation") {
        if (req.method === "POST") loginPosts++;
        req.resume();
        res.writeHead(status, { Location: `${foreignOrigin}/credentials` });
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<form><label>School email<input name="email"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form><output></output><script>
        document.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          try { await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: {'Content-Type':'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); } catch {}
          document.querySelector('output').textContent = 'Login attempt complete';
        };
      </script>`);
    });
    allowedOrigin = await listen(allowed);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await restrictSmokeOrigin(page, allowedOrigin);
      await page.goto(`${allowedOrigin}/login`);
      await page.getByLabel("School email").fill("synthetic@example.edu");
      await page.getByLabel("Password").fill("synthetic-redirect-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText("Login attempt complete")).toBeVisible();
      expect(loginPosts).toBe(1);
      expect(credentialBodies, "Foreign server must never receive login credentials").toBe(0);
      expect(foreignRequests, "Foreign server must never receive a redirected login request").toBe(0);
      await expect(page.goto(`${allowedOrigin}/navigation`)).rejects.toThrow();
      expect(foreignRequests, "Foreign server must never receive redirected navigation").toBe(0);
    } finally {
      await context.close();
      await close(allowed);
      await close(foreign);
    }
  });
}
