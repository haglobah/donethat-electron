const { BrowserWindow } = require('electron');
const path = require('path');

async function generateAppCheckTokenViaWebview() {
  return new Promise((resolve, reject) => {
    try {
      const http = require('http');
      const tempWindow = new BrowserWindow({
        width: 400,
        height: 300,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          allowRunningInsecureContent: false
        }
      });

      try {
        const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        tempWindow.webContents.setUserAgent(ua);
      } catch (_) {}

      let siteKey = process.env.DT_RECAPTCHA_ENTERPRISE_SITE_KEY;
      if (!siteKey) {
        try { if (tempWindow && !tempWindow.isDestroyed()) tempWindow.close(); } catch (_) {}
        return reject(new Error('Missing reCAPTCHA Enterprise site key'));
      }

      let settled = false;
      let timeoutId = null;

      const htmlContent = `<!doctype html><html><head><meta charset="utf-8"><title>AppCheck</title>
      <script src="https://www.google.com/recaptcha/enterprise.js?render=${siteKey}"></script>
      </head><body><script>(function(){
        function done(v){ try{ document.title=v; }catch(e){} }
        function run(){ try{
          if(!window.grecaptcha||!grecaptcha.enterprise) return false;
          grecaptcha.enterprise.execute('${siteKey}',{action:'ELECTRON_LOGIN'})
            .then(function(t){ done('token:'+t) })
            .catch(function(e){ done('error:'+(e&&e.message||String(e))) });
          return true;
        }catch(e){ done('error:'+(e&&e.message||String(e))); return true; } }
        try{ grecaptcha.enterprise.ready(function(){ run(); }); }catch(e){ done('error:'+(e&&e.message||String(e))); }
        var a=0; var m=20; var it=setInterval(function(){ a++; if(run()||a>=m){ clearInterval(it); } },500);
      })();</script></body></html>`;

      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlContent);
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const url = `http://127.0.0.1:${address.port}/`;

        const titleHandler = (event, title) => {
          try {
            if (settled) return;
            if (typeof title === 'string' && title.startsWith('token:')) {
              settled = true;
              try { if (timeoutId) clearTimeout(timeoutId); } catch(_){ }
              const token = title.slice('token:'.length);
              resolve(token);
              try { if (tempWindow && !tempWindow.isDestroyed()) tempWindow.close(); } catch(_){ }
              try { server.close(); } catch(_){ }
            } else if (typeof title === 'string' && title.startsWith('error:')) {
              settled = true;
              try { if (timeoutId) clearTimeout(timeoutId); } catch(_){ }
              const msg = title.slice('error:'.length);
              reject(new Error(msg));
              try { if (tempWindow && !tempWindow.isDestroyed()) tempWindow.close(); } catch(_){ }
              try { server.close(); } catch(_){ }
            }
          } catch (_) {}
        };
        tempWindow.on('page-title-updated', titleHandler);
        tempWindow.loadURL(url);
        tempWindow.on('closed', () => {
          try { tempWindow.removeListener('page-title-updated', titleHandler); } catch(_){ }
          try { server.close(); } catch(_){ }
        });
      });

      tempWindow.on('closed', () => {
        if (settled) return;
        settled = true;
        try { if (timeoutId) clearTimeout(timeoutId); } catch (_) {}
        resolve(null);
      });

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { if (tempWindow && !tempWindow.isDestroyed()) tempWindow.close(); } catch (_) {}
        reject(new Error('AppCheck token generation timeout'));
      }, 20000);

    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { generateAppCheckTokenViaWebview };


