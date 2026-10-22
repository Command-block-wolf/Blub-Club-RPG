# Blub Club signaling server

A tiny program that lets browsers find each other. A host asks for a room,
gets a short code, and friends type the code in. The server passes the
WebRTC handshake messages between them and nothing else. **Game traffic never
goes through it**, so it needs almost no power.

- Rooms live only as long as the host is connected (matches the game: when the
  host leaves, the session ends).
- Guests can only talk to the host, never to each other.
- It limits message size and message rate, caps the number of rooms, and can
  restrict which websites may connect.

## Run it on your PC (for testing)

```
cd signaling-server
npm install
npm start
```

It prints `Signaling server listening on port 9090`. In the game this matches
the local development address `DEV_SIGNALING_URL` in `scripts/network_config.gd`.

Run the self-test any time: `npm test` (it starts its own copy on port 9191).

## Put it online

Follow `DEPLOY_ONLINE_MULTIPLAYER.md` (in the project root). It covers GitHub,
Render and Netlify step by step.

Settings (environment variables, all optional):

- `PORT`: the hosting platform sets this for you
- `ALLOWED_ORIGINS`: the website(s) allowed to use the server, e.g.
  `https://yourgame.netlify.app` (comma-separate several; `*` matches any
  subdomain, e.g. `https://*.itch.zone`). Strongly recommended, so other sites
  can't use your server. If a site is turned away, the server's log says which.
- `MAX_ROOMS`: default 500
