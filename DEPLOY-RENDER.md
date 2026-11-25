# راهنمای استقرار GeriaPharm روی Render (فرانت‌اند + بک‌اند + PostgreSQL)

این راهنما نحوه استقرار یکپارچه **GeriaPharm** روی **Render** (همراه با دیتابیس مدیریت‌شده **Render PostgreSQL** و پروکسی **Cloudflare Worker**) را توضیح می‌دهد.

در این معماری، هر سه بخش روی Render اجرا می‌شوند:
- **فرانت‌اند (React + Vite PWA)** به‌صورت استاتیک از پوشه `dist/` توسط همان سرویس Node ارائه می‌شود.
- **بک‌اند (Express API)** روی همان دامنه و پورت (`/api/*`) سرویس می‌دهد.
- **دیتابیس (Render PostgreSQL)** از طریق متغیر محیطی `DATABASE_URL` متصل می‌شود تا با هر دیپلوی یا ری‌استارت جدید روی Render، هیچ داده‌ای (ویرایش داروهای CMS، حساب مدیر، تاریخچه و پاسخ‌های UMARS) پاک نشود.

---

## ۱. استقرار خودکار با Blueprint (`render.yaml`) — پیشنهادی

1. در داشبورد Render به بخش **Blueprints** بروید و **New Blueprint Instance** را بزنید.
2. مخزن `GeriaPharm` را انتخاب کنید. Render به‌طور خودکار فایل `render.yaml` را می‌خواند و هم‌زمان موارد زیر را می‌سازد:
   - دیتابیس مدیریت‌شده **PostgreSQL** با نام `geriapharm-db`
   - وب‌سرویس Node.js با نام `geriapharm` و اتصال خودکار `DATABASE_URL`
3. در مرحله وارد کردن متغیرهای محرمانه (`sync: false`)، این دو مقدار را وارد کنید:
   - `ADMIN_EMAIL`: ایمیل مدیر (مثلاً `admin@arshid.tech`)
   - `ADMIN_PASSWORD`: رمز عبور اولیه (حداقل ۱۲ کاراکتر، بدون `replace-`)
4. دکمه **Apply** را بزنید تا ساخت و استقرار انجام شود.

---

## ۲. استقرار دستی روی Render (اگر سرویس را قبلاً ساخته‌اید)

اگر سرویس Web Service را از قبل روی Render ساخته‌اید، فقط یک **PostgreSQL** جدید در Render بسازید و **Internal Database URL** آن را در بخش **Environment** سرویس وب قرار دهید:

| فیلد / متغیر | مقدار | توضیح |
| :--- | :--- | :--- |
| **Build Command** | `npm ci && npm run build` *(یا `npm install && npm run build`)* | نصب وابستگی‌ها، تایپ‌چک و بیلد فرانت‌اند (`dist/`) و سرور (`dist-server/`) |
| **Start Command** | `npm start` | اجرای هم‌زمان فرانت‌اند و API در حالت تولید (`NODE_ENV=production`) |
| **Health Check Path** | `/api/health` | پاسخ `{"status":"ok","database":"postgres"}` |
| `NODE_VERSION` | `22.16.0` | نسخه Node سازگار با `engines` پروژه |
| `DATABASE_URL` | `postgresql://...` (Internal URL از Render PostgreSQL) | اتصال پایدار به دیتابیس PostgreSQL |
| `APP_ORIGIN` | `https://geriapharm.arshid.tech,https://geriapharm.onrender.com` | دامنه‌های مجاز برای درخواست‌های نوشتنی (ورود ادمین، ویرایش، نظرسنجی) |
| `COOKIE_SECURE` | `true` | الزام HTTPS برای کوکی نشست ادمین |
| `TRUST_PROXY_HOPS` | `1` | اعتماد به پراکسی Render (به‌طور خودکار روی Render فعال است) |
| `ADMIN_EMAIL` | ایمیل مدیر | فقط برای ساخت اولین حساب مدیر |
| `ADMIN_PASSWORD` | رمز قوی (حداقل ۱۲ کاراکتر) | فقط برای راه‌اندازی اولیه (پس از ورود از پنل تغییر دهید) |

> **نکته مهم:** متغیر `NODE_ENV=production` را در بخش **Environment Variables** سرویس Render تنظیم **نکنید**؛ چون Render آن را در مرحله Build هم اعمال می‌کند و باعث می‌شود `npm` پکیج‌های `devDependencies` را نصب نکند. دستور `npm start` خودش `NODE_ENV=production` را در زمان اجرا تنظیم می‌کند.

---

## ۳. هماهنگی با Cloudflare Worker

اگر دامنه خود را با Cloudflare Worker به `geriapharm.onrender.com` پروکسی کرده‌اید:
- ورکر شما `Host` را به `geriapharm.onrender.com` تغییر می‌دهد اما هدر `Origin: https://geriapharm.arshid.tech` مرورگر را حفظ می‌کند؛ با قرار دادن هر دو آدرس در `APP_ORIGIN` ورود از هر دو نشانی بدون خطای `403` انجام می‌شود.
- کوکی نشست (`gp_session`) بدون ویژگی `Domain` تنظیم می‌شود و مستقیماً روی `geriapharm.arshid.tech` ذخیره می‌گردد.
- اسکریپت مقداردهی اولیه تم به فایل جداگانه `/theme-init.js` منتقل شده تا هیچ خطای CSP (`script-src 'self'`) در کنسول مرورگر رخ ندهد.

---

## ۴. بازیابی رمز مدیر روی Render

از طریق **Shell** در داشبورد Render (یا به‌صورت محلی با `DATABASE_URL` خارجی):
1. مقادیر `ADMIN_EMAIL` و رمز جدید `ADMIN_PASSWORD` را در محیط تنظیم کنید.
2. دستور زیر را اجرا کنید:

```sh
npm run admin:reset
```

این دستور رمز حساب مدیر را در PostgreSQL به‌روزرسانی و همه نشست‌های قبلی را باطل می‌کند.

---

## ۵. بررسی سلامت پس از استقرار

```sh
curl -s https://geriapharm.arshid.tech/api/health
# {"status":"ok","database":"postgres"}
```

- اگر `"database":"postgres"` برگردانده شد، اتصال پایدار دیتابیس PostgreSQL برقرار است.
- سپس `https://geriapharm.arshid.tech/#admin` را باز کنید، وارد شوید و رمز اولیه را تغییر دهید.
