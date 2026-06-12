# Pi Web Coms Net

Built-in Pi package for LAN Pi-to-Pi collaboration.

- `extensions/coms-net.ts` registers `coms_net_list`, `coms_net_send`, `coms_net_get`, and `coms_net_await`.
- `extensions/pi-pi.ts` registers `query_experts` for the Pi Pi expert templates in `agents/pi-pi/`.
- Start the shared hub with `npm run coms-net:server`.

## Start a hub

Loopback-only, for testing on one machine:

```bash
npm run coms-net:server
```

LAN mode requires an explicit token:

```bash
PI_COMS_NET_HOST=0.0.0.0 \
PI_COMS_NET_PORT=52965 \
PI_COMS_NET_PUBLIC_URL=http://192.168.1.10:52965 \
PI_COMS_NET_AUTH_TOKEN=change-this-long-random-token \
npm run coms-net:server
```

## Enable the package

Install this package into Pi settings:

```bash
pi install /path/to/pi-web-seeker/pi-packages/pi-coms-net
```

Or use this repository's local Pi CLI:

```bash
./node_modules/.bin/pi install "$PWD/pi-packages/pi-coms-net"
```

New Pi sessions will expose:

- `coms_net_list`
- `coms_net_send`
- `coms_net_get`
- `coms_net_await`
- `query_experts`

For a remote hub, pass flags or environment variables when starting Pi:

```bash
PI_COMS_NET_SERVER_URL=http://192.168.1.10:52965 \
PI_COMS_NET_AUTH_TOKEN=change-this-long-random-token \
pi --cname planner --purpose "planning and code review"
```
