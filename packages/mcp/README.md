# @clevercon/mcp

Give an AI agent a **bounded, non-custodial Stellar spending account** over the Model
Context Protocol. Any MCP client (Claude Desktop, Cursor, or your own agent) can
discover services, pay and disburse USDC, hire services, set private spending limits,
and read its budget and activity, all with a scoped API key and bounded on-chain by a
vault. The agent can spend, but never overspend, pay outside your rules, or hold funds.

Part of [CleverCon](https://clevercon.xyz). For programmatic use (no MCP client), see
the SDK, [`@clevercon/agent-sdk`](https://www.npmjs.com/package/@clevercon/agent-sdk).

## Install

No install needed, run it on demand:

```bash
npx -y @clevercon/mcp
```

Or install globally to get the `clevercon-mcp` command: `npm install -g @clevercon/mcp`.
Requires Node 18+.

## Prerequisites

1. Open the app at **https://clevercon.xyz** and connect a Stellar wallet (testnet).
2. **Fund your vault** and authorize the agent once, in the app.
3. In the **Developer console**, mint a scoped **API key** (format `cc_<prefix>.<secret>`).
   The key can only spend within the limits you set; it has no authority to move funds
   otherwise.

## Configure your MCP client

Add CleverCon to your client's MCP config. The only required variable is your API key;
the API base defaults to the live CleverCon API.

**Claude Desktop** (`claude_desktop_config.json`) or **Cursor**:

```json
{
  "mcpServers": {
    "clevercon": {
      "command": "npx",
      "args": ["-y", "@clevercon/mcp"],
      "env": {
        "CLEVERCON_API_KEY": "cc_yourprefix.yoursecret"
      }
    }
  }
}
```

Restart the client. Your agent now has the CleverCon tools.

### Environment variables

| Variable | Required | Default |
| --- | --- | --- |
| `CLEVERCON_API_KEY` | yes | — |
| `CLEVERCON_API_URL` | no | the live CleverCon API (set only to self-host) |

## Tools

**Discover**
- `search_services` — browse the service directory (filter by text/category; sort by recent, rating, or price).
- `get_service` — details for one service by id (name, provider, price per call, rating).

**Spend** (bounded by a policy, released from your vault)
- `pay` — pay one address. `{ payee, amount, reason?, policyId? }`
- `disburse` — pay many in one instruction. `{ lines: [{ payee, amount, reason? }], policyId? }`
- `hire_agent` — hire a registered service, paid per step. `{ title, mode, budget, serviceId?, policyId? }`

**Limits** (your private policy)
- `set_limit` — create a reusable limit; returns a `policyId`. `{ perPaymentCeilingUsdc?, rollingCapUsdc?, rollingWindowSecs?, allowlist?, isPrivate? }`
- `list_limits` — list saved limits.

**State**
- `get_budget` — vault position: balance, available, locked.
- `get_activity` — recent jobs and payments, newest first.
- `list_tasks` / `get_task` — task history and detail.
- `dispute_task` — raise a dispute on a task.

If you omit `policyId` on `pay`/`disburse`, a tight limit is derived from the payment
itself (allowlist = the payees, cap = the largest line), so every spend is bounded by
default.

## Example prompts

Once configured, you can ask your agent things like:

- "Pay `G...ABC` 5 USDC for the logo work."
- "Split 30 USDC between these three addresses."
- "Set a limit: max 10 USDC per payment, 100 per day, only to these two addresses, and keep it private."
- "Find a price-oracle service and hire it with a 2 USDC budget."
- "What's my remaining budget?"

## How it works

Every tool call goes through the CleverCon API with your `x-api-key`. Spends are
bounded by a policy (a per-payment cap, a rolling-window cap, and/or an allowlist) and
released from your vault via a proof-gated on-chain path. The API key grants no signing
authority over funds: it can only spend within the limits you set. Fund the vault and
authorize the agent once in the app; after that the agent spends autonomously within
bounds.

## Security model

- **Non-custodial:** the server never holds keys or funds. Spends are released from your
  vault within your policy; the API key cannot move funds outside it.
- **Bounded:** every spend is checked against a policy; the vault caps the total on-chain.
- **Private:** your rules are committed on-chain, not published.
- **Metered:** API-key usage is metered and can carry a daily quota.

## Troubleshooting

- **401 / invalid API key** — check `CLEVERCON_API_KEY` is the full `cc_<prefix>.<secret>`.
- **A spend is rejected** — the amount or payee violates your policy, or the vault's
  available balance is too low. Check `get_budget` and `list_limits`.
- **Self-hosting the API** — set `CLEVERCON_API_URL` to your API base.

## Links

- App and Developer console: https://clevercon.xyz
- Programmatic SDK: [`@clevercon/agent-sdk`](https://www.npmjs.com/package/@clevercon/agent-sdk)
- Source and issues: https://github.com/clevercon-protocol/clevercon

## License

MIT
