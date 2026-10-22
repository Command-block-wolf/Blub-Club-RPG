# Web multiplayer: setup

How it fits together:

```
 browser A (host) --\                        /-- browser B (guest)
                     \--> signaling server <--/      (only used to introduce them
                                                      using the room code)
 browser A  <=========== direct WebRTC ===========>  browser B   (the actual game)
```

## 1. Test it on your PC

1. Start the room server:
   ```
   cd signaling-server
   npm install
   npm start
   ```
2. In Godot, use the **Run in Browser** button (top right of the editor).
   Godot opens the game in your browser and shows a web address.
3. Open that same address in a **second browser tab** (or a second browser).
4. Tab 1: **Play -> CREATE ROOM**, pick a class. The room code is shown on the
   class screen, bottom-left in game, and in the Esc menu (with a Copy button).
5. Tab 2: **Play**, type the code, **JOIN**, pick a class.

You can ONLY test the online path in a browser. Running the game with F5
(desktop) still uses the address-and-port lobby, which is fine for quick
two-window tests but cannot connect to browser players.

## 2. Publish it

You need TWO things online: the game (Netlify, static files) and the room
server (a host that keeps WebSocket connections open: Netlify cannot do this).
Changing a URL in the game does not create a server: the server must really be
running at that address.

Follow **DEPLOY_ONLINE_MULTIPLAYER.md** for the full step-by-step.

## 3. TURN servers (read this)

Most home networks connect directly. Some do not (strict firewalls, some
school/work/mobile networks). Those players will see "The connection timed
out". The fix is a TURN server, which relays their traffic. You can rent one
(Metered, Twilio, Cloudflare) or run your own (coturn). Add it to
`ICE_SERVERS` in `network_config.gd`. Until then, expect that a few players
cannot connect.

## 4. Good to know

- Browser players and desktop (F5) players cannot join each other. Desktop
  uses ENet, browsers use WebRTC.
- When a guest closes their tab, the host notices after a few seconds.
- When the host leaves, everyone is sent back to the title screen (as designed).
- New players can join a session already in progress (room limit: 4).
- The online path has not been run in Godot by me: the signaling server is
  tested, the game-side code is not. Expect to fix a bug or two.
