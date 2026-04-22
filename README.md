# dst

Encrypted infinite storage over Discord.

See `docs/superpowers/specs/2026-04-22-dst-design.md` for the full design.

## Requirements

- Node.js 20+
- pnpm 9+
- A Discord account

## Dev

```bash
pnpm install
pnpm dev
```

## Package

```bash
pnpm package            # NSIS installer + portable
pnpm package:portable   # portable only
```

## Test

```bash
pnpm test
pnpm typecheck
```

Integration tests against a real Discord server are gated behind `DST_E2E_TOKEN`:

```bash
DST_E2E_TOKEN=your.bot.token DST_E2E_GUILD_ID=123 pnpm test
```

## License

UNLICENSED — personal project, not for distribution.
