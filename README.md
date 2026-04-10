# ScriptForge

Automation dashboard de mo Chromium, login Claude.ai va chay pipeline viet kich ban 8 buoc.

## Cai dat

Chay cac lenh sau:

```bash
cd C:\Users\MSI\Desktop\4LUA\scriptforge
npm install
```

```bash
cd C:\Users\MSI\Desktop\4LUA\scriptforge\client
npm install
```

```bash
cd C:\Users\MSI\Desktop\4LUA\scriptforge\server
npm install
npx playwright install chromium
```

## Chay du an

Tu root:

```bash
cd C:\Users\MSI\Desktop\4LUA\scriptforge
npm run dev
```

Server se chay tai `http://localhost:3001`.
Client se chay tai `http://localhost:5173`.

## Luong su dung lan dau

1. Bam `Connect Browser`.
2. Login Claude.ai trong cua so Chromium vua mo.
3. Sau khi login xong, chon project, model, chat name va paste script goc.
4. Bam `Start Pipeline`.
