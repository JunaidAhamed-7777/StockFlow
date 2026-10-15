# Local demonstration catalog

StockFlow includes 40 fictional catalog items, four supplier profiles, and four customer profiles for exploring the local application. Items use `DEMO-` SKUs and clearly identify themselves as fictional in their descriptions. Existing products, orders, account passwords, and stock counts are preserved.

The new suppliers are Northstar Workspace, Circuit & Co., Paper & Form, and Daylight Office Goods. Each company owns ten demo products. The eight new account names include “Demo”, and every new email ends in `@stockflow.example.test`. These addresses must be excluded from notification delivery. There are no additional administrator accounts.

## Run or repeat the setup

Start the isolated local stack using the repository setup instructions. Then run from the repository root:

```powershell
node scripts/seed-demo-catalog.mjs
node scripts/seed-demo-catalog.mjs --apply --local-supplier-profiles
```

The first command previews the counts without writing data. The second creates missing demo rows. It requires the existing local administrator account. `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` can override the documented development administrator credentials. `DEMO_API_URL` can select another loopback API URL; remote APIs are rejected.

Passwords are individually generated from 24 random bytes. They are saved in ignored `.local/demo-accounts.json` before account creation so an interrupted run can resume. This file is for local login and must not be committed, published, or sent to n8n. The script logs counts and the file location, never passwords or tokens. Keep the credentials file if the corresponding database is retained; deleting it prevents the script from authenticating existing demo accounts.

Credential files are replaced atomically rather than truncated in place. Apply
runs are serialized by `.local/demo-seed.lock` before reading retained account
metadata. A concurrent run stops without replacing the owner's lock. If a process
was interrupted, inspect the PID in that private lock and verify no seed process
is still running before removing only the stale lock; retain the account file.
The next run can then resume using the passwords saved before registration.

The supplier bootstrap requires an initialized runtime marker and verifies the
saved Docker container identity, image, volume, loopback binding and credentials
before opening Prisma. HTTP redirects are refused, including redirects from a
loopback URL. Remote response/error bodies are not printed. See the
[repeatability and browser verification report](QA-DEMO-DATA.md).

The API supports user registration and product creation but has no supplier-profile creation endpoint. The optional supplier bootstrap therefore writes only missing supplier records through Prisma against the explicitly marked isolated Docker runtime in `.local/runtime.json`. It rejects any other container name, database, hostname, or port. It verifies each account is the matching fictional supplier and verifies the API administrator identity against that database. It does not change the Prisma schema, server source, authentication, or endpoints.

Existing matching SKUs are skipped, including their quantities and prices. Existing account passwords and roles are never reset. A repeated successful run creates zero additional accounts or products. New products begin with ample stock; seeding does not create orders or trigger email. Opening quantities are supplied through the current product API, which does not create initial stock transaction history.

Customer profiles can sign in immediately. The current customer directory API is limited to customers with orders: new profiles increase the registered customer metric and appear in purchase history rows after a first order. Setup does not fabricate customer purchases.

## Illustrative photographs

The backend has no product image field. The frontend uses `client/src/data/product-images.json`, keyed by the exact SKU, for the 40 demo items and four original development items. Other SKUs receive an honest image placeholder. The UI labels mapped photographs as illustrative, and photo credits link to their source pages. Similar variants share a photograph; images do not establish the item's exact appearance or specification.

The source definitions and SKU mappings are maintained in `scripts/data/demo-catalog.mjs`. Regenerate or verify the frontend manifest with:

```powershell
node scripts/sync-demo-photos.mjs
node scripts/sync-demo-photos.mjs --check
node scripts/sync-demo-photos.mjs --verify --check
```

All 16 direct image URLs returned HTTP 200 with an image content type on October 15, 2026. Photographs load directly from `images.unsplash.com` or `images.pexels.com` at a bounded 800-pixel width. No stock-photo API key or paid image service is used. Source availability can change; failed images fall back to the product placeholder.

[Unsplash's license](https://unsplash.com/license) permits free commercial and noncommercial use of its free photographs. [Pexels' license](https://www.pexels.com/license/) permits free use and editing, including app imagery. Neither source requires attribution, but credits are retained here and in the product UI. Photographs are illustrative content, and no endorsement by depicted brands or photographers is claimed.

Source credits:

- Ergonomic mouse: [Krunal Lakhatariya on Unsplash](https://unsplash.com/photos/a-black-computer-mouse-on-a-white-desk--0Wqx50_W7g).
- Illuminated mouse: [Matheus Bertelli on Pexels](https://www.pexels.com/photo/close-up-of-a-computer-mouse-13870514/).
- Illuminated keyboard: [Christian Lue on Unsplash](https://unsplash.com/photos/black-computer-keyboard-on-black-surface-oj7Z1ucRxcs).
- Wireless desk keyboard: [Lucian Petrean on Pexels](https://www.pexels.com/photo/black-computer-keyboard-on-the-table-7265920/).
- White headphones: [Sound On on Pexels](https://www.pexels.com/photo/white-headphones-3394652/).
- Black studio headphones: [Vladislav Anchuk on Pexels](https://www.pexels.com/photo/black-studio-headphones-on-white-background-30428610/).
- Portable speaker: [Caleb Oquendo on Pexels](https://www.pexels.com/photo/speaker-in-white-background-7772558/).
- USB connector: [Matthias Zomer on Pexels](https://www.pexels.com/photo/close-up-photo-of-white-usb-cable-914915/).
- Charging cable: [Srattha Nualsate on Pexels](https://www.pexels.com/photo/white-usb-cable-in-close-up-photography-12997240/).
- USB hub: [Rann Vijay on Pexels](https://www.pexels.com/photo/a-usb-hub-plugged-into-a-laptop-7742586/).
- Ruled notebook: [Dana Marin on Unsplash](https://unsplash.com/photos/notebook-opened-IThpmszqH7Y).
- Black notebook and pen: [Adrian Regeci on Pexels](https://www.pexels.com/photo/minimalist-black-notebook-and-pen-on-white-background-31480649/).
- Colored pencils: [Jess Bailey on Unsplash](https://unsplash.com/photos/colored-pencil-lined-up-on-top-of-white-surface-l3N9Q27zULw).
- Black pen: [Mike Murray on Pexels](https://www.pexels.com/photo/black-pen-in-close-up-shot-5594344/).
- Ceramic mug: [Irina P on Pexels](https://www.pexels.com/photo/white-ceramic-mug-in-close-up-photography-12122888/).
- Water bottle: [Furknsaglam on Pexels](https://www.pexels.com/photo/bottle-on-top-of-a-desk-7531578/).
