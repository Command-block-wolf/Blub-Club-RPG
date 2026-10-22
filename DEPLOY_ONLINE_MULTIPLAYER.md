# Deploying online multiplayer (GitHub + Render + Netlify)

Your game needs TWO separate things online:

| Piece | What it is | Where it goes |
|---|---|---|
| The game | Static files from Godot's Web export | **Netlify** (already done) |
| The room server | A Node.js program that must stay running and keep WebSocket connections open | **Render** (steps below) |

Netlify can't run the room server: it only serves files and short-lived
functions, and can't hold a WebSocket open. So the server goes on Render.
Changing the address inside the game does NOT create a server. The server has
to be running first; the game is then pointed at it.

Everything below can be done in a web browser.

---

## Part 1: put the room server on GitHub

You only need two files from the `signaling-server` folder of your project:
`server.js` and `package.json`.

1. Go to **github.com** and sign in. Click **+** (top right) -> **New repository**.
2. Name it `blub-club-rooms`. Choose **Public**. Click **Create repository**.
3. On the empty repository page, click **uploading an existing file**.
4. Drag in **`server.js`** and **`package.json`** (the two files themselves,
   NOT the folder, so they land at the top level of the repository).
   Do NOT upload `node_modules`.
5. Scroll down and click **Commit changes**.

Check: the repository's front page should list `server.js` and `package.json`.

## Part 2: run it on Render

1. Go to **render.com** and sign up with your GitHub account.
2. Click **New +** -> **Web Service**.
3. Choose **Build and deploy from a Git repository** -> **Next**. Pick
   `blub-club-rooms` (Render will ask permission to see your repositories:
   allow it).
4. Fill in the settings (names may differ slightly):

   | Setting | Value |
   |---|---|
   | Name | `blub-club-rooms` |
   | Region | the one nearest your players |
   | Branch | `main` |
   | Runtime / Language | **Node** |
   | Build Command | `npm install` |
   | Start Command | `node server.js` |
   | Instance Type | **Free** (see "Free plan" below) |

5. Open **Advanced** and:
   - **Health Check Path**: `/`
   - **Environment Variables** -> **Add**:
     - Key: `ALLOWED_ORIGINS`
     - Value: your Netlify address, exactly, e.g. `https://my-blubclub.netlify.app`
       (starts with `https://`, no slash at the end, no path). If you also use
       a custom domain, add it after a comma:
       `https://my-blubclub.netlify.app,https://blubclub.com`
     - You do NOT set `PORT`: Render sets it.
6. Click **Create Web Service**. Wait for the log to say the service is **live**
   (a couple of minutes). Its address is at the top, like
   `https://blub-club-rooms.onrender.com`.

### Check the server is really reachable

Open that address in a browser tab. You should see:

> Blub Club signaling server: ok

If you do, the server is up. In Render, the **Logs** tab shows
`Signaling server listening on port ...`. If you don't see "ok", don't go any
further: look at the Logs tab for the error.

### Your WebSocket address

Take the Render address and change `https://` to **`wss://`**:

`https://blub-club-rooms.onrender.com`  ->  `wss://blub-club-rooms.onrender.com`

## Part 3: point the game at it

1. In Godot, open `scripts/network_config.gd`.
2. Change this one line to YOUR address:
   ```gdscript
   const PRODUCTION_SIGNALING_URL: String = "wss://blub-club-rooms.onrender.com"
   ```
   Leave `DEV_SIGNALING_URL` (`ws://localhost:9090`) alone: it is only used when
   you test on your own computer or home Wi-Fi, never on your published site.
3. **Project -> Export -> Web -> Export Project**. Export into a folder, with
   the file name `index.html`.

### How the game chooses an address (so you can trust it)

- A page on **localhost / 127.0.0.1 / a 192.168.x.x address**: uses the local
  development server (`ws://...:9090`). You'll also see a Server box in the lobby.
- **Any other page (your Netlify site)**: uses `PRODUCTION_SIGNALING_URL`.
  No server box is shown to players.
- You can try a different server without re-exporting by adding it to the
  page address: `https://my-blubclub.netlify.app/?server=wss://other.onrender.com`
- If the address still says `YOUR-ROOM-SERVER`, the game refuses to connect
  and tells you to set it, instead of failing mysteriously.

## Part 4: update Netlify

1. Go to **app.netlify.com**, open your site -> **Deploys**.
2. Drag the exported folder (the one containing `index.html`) onto the deploy
   area ("Drag and drop your site output folder here").
   (If your site is connected to a GitHub repository instead, commit the new
   export files there and Netlify redeploys on its own.)
3. Wait for it to say **Published**.

## Part 5: test it

1. On your computer, open your Netlify site. **Play -> CREATE ROOM.**
   - The first connection after the server has been idle can take up to about a
     minute (see "Free plan"). The lobby tells you this.
   - The room code appears on the class screen.
2. On another device (a phone on mobile data is a good test), open the same
   Netlify site, **Play**, type the code, **JOIN**.
3. In Render's **Logs** you should see `room XXXXX created` and
   `guest ... joined`. If those appear, the server side is working.

## If it doesn't work

| Message / symptom | Cause |
|---|---|
| "...address isn't set yet..." | `PRODUCTION_SIGNALING_URL` still has the example text. Edit it and re-export. |
| "Couldn't reach the room server at wss://..." | The server isn't running or the address is wrong. Open the https version in a browser tab: you must see "ok". Check Render's Logs. |
| Page works at `https://...onrender.com` but the game can't connect | `ALLOWED_ORIGINS` doesn't match your Netlify address exactly (typo, trailing slash, `http` vs `https`, or you're on a Netlify preview address). Fix it under Render -> Environment. |
| "...must use wss://..." | The address starts with `ws://`. A secure page needs `wss://`. |
| "The connection timed out" | The room server was reached, but the two browsers can't connect directly. Some networks block this and need a TURN server (see `WEB_MULTIPLAYER_SETUP.md`). |
| Nothing in Render's Logs when you click Create Room | The game isn't reaching Render: wrong address in the exported build, or an old export is still on Netlify. |

## Free plan: what to expect

Render's free web service goes to sleep after about 15 minutes with no
traffic, then takes up to about a minute to wake up when someone connects. The
game waits for this. If you want it always instant, Render's paid plan (a few
dollars a month) keeps it awake. Railway, Fly.io and a small VPS are other
hosts that keep Node programs running; the same two files and settings apply.


---

# If Netlify won't let you deploy

Only the HOSTING of the game files is affected. Your room server on Render is a
separate service and keeps working. You need to publish a new export (it now
contains the correct server address), but you can publish it anywhere.

## First: find out what is actually wrong

In Netlify, open your team's **Usage & billing** page and read the banner.

- **Banner says "running on operational credits - production deploys are paused"
  but your balance shows credits left.** This has been reported by many free
  accounts since Netlify changed to credits in July 2026, and is described as a
  stuck flag on the account. Your already-published site normally stays up; only
  NEW deploys are blocked. Post on the Netlify support forum
  (answers.netlify.com) with your team name and site name, and ask them to reset
  the flag. I can't tell how long they take.
- **Credits really are used up.** Deploys come back when your billing period
  renews (the date is on that page), or when you upgrade the plan.

Don't wait on this if you want to test now. Use one of the options below.

## Option A: test with no hosting at all (same Wi-Fi)

Good for checking that multiplayer works between two real devices.

1. Export the game from Godot into a folder (Project -> Export -> Web).
2. In that folder, open a terminal and run `python -m http.server 8000`
   (use `python3` if needed).
3. Find your computer's address on your home network, e.g. `192.168.1.20`
   (Windows: run `ipconfig`; Mac: System Settings -> Wi-Fi -> Details).
4. In the `signaling-server` folder run `npm start`. If your computer asks to
   allow Node.js through the firewall, allow it.
5. On the computer, open `http://192.168.1.20:8000`. On a phone **on the same
   Wi-Fi**, open the same address.

The game notices that the page is on a home-network address and uses
`ws://192.168.1.20:9090` automatically; you don't edit anything. Leave
`ALLOWED_ORIGINS` unset when running the server this way.

## Option B: itch.io (easiest browser-only alternative)

1. Sign up at itch.io, then **Dashboard -> Create new project**.
2. **Kind of project: HTML.**
3. Put your exported folder's contents into a **.zip** file with `index.html`
   at the TOP level of the zip (not inside a subfolder). Upload it and tick
   **"This file will be played in the browser"**.
4. Set the viewport size to **1152 x 648**. Set visibility to Public (or
   Restricted with a password while testing) and **Save**.
5. Tell the room server about the new site. In Render -> your service ->
   **Environment**, set `ALLOWED_ORIGINS` to include itch.io's game address.
   itch.io runs games from its own subdomains, so use a wildcard:
   `https://*.itch.zone` (keep your other addresses, comma-separated).
   If the game still can't connect, look in Render's **Logs** for a line
   starting "Turned away a connection from ..." and add exactly that address.

If upgrading the server file (`server.js`) is needed for the wildcard, upload
the new `server.js` to your GitHub repository (Add file -> Upload files ->
Commit); Render redeploys by itself.

## Option C: GitHub Pages (free, permanent address)

A warning first: Godot's `index.wasm` file is about 25-35 MB, and GitHub's
website only accepts files up to **25 MB**. Uploading through the browser will
likely fail for that file. Use **GitHub Desktop** (a free app, no commands)
instead, which accepts files up to 100 MB.

1. Create a new public repository on github.com (e.g. `blub-club-game`).
2. Install **GitHub Desktop**, sign in, and clone that repository to your
   computer.
3. Copy the exported files (`index.html`, `index.wasm`, `index.pck`, the `.js`
   files, and so on) into the cloned folder. In GitHub Desktop, write a short
   summary, **Commit to main**, then **Push origin**.
4. On github.com: your repository -> **Settings -> Pages**. Under **Build and
   deployment**, choose **Deploy from a branch**, branch `main`, folder
   `/ (root)`, and **Save**. After a minute the site is at
   `https://YOURNAME.github.io/blub-club-game/`.
5. In Render -> **Environment**, add `https://YOURNAME.github.io` to
   `ALLOWED_ORIGINS` (the address WITHOUT the `/blub-club-game/` part).

## Whichever you choose

- In Godot's Web export preset, keep **Thread Support off** (the default in
  recent versions). If the browser's console says "SharedArrayBuffer is not
  defined", that setting is the cause.
- Re-export after setting `PRODUCTION_SIGNALING_URL` to your wss:// address,
  and deploy that new export. An old export still contains the old address.
- Every new site address must be in Render's `ALLOWED_ORIGINS`, exactly,
  starting with `https://` and with no slash at the end.
