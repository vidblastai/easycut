'use client';

import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

/**
 * Use EasyCut from Claude.
 *
 * Two ways in, because there are two kinds of Claude. claude.ai and the
 * desktop app add a "custom connector" by URL and sign in through EasyCut's
 * own login page, so they need nothing but the address. Claude Code takes the
 * address plus a token in a header, which is what the token list is for.
 */

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  source: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function ClaudePanel({ mcpUrl, authEnabled }: { mcpUrl: string; authEnabled: boolean }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!authEnabled) return;
    const response = await fetch('/api/tokens').catch(() => null);
    if (response?.ok) setTokens((await response.json()).tokens ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Claude Code' }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError('Could not create a token. Try again.');
      return;
    }
    setFresh((await response.json()).token.secret);
    void load();
  }

  async function revoke(id: string) {
    await fetch(`/api/tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    void load();
  }

  const codeCommand = `claude mcp add --transport http easycut ${mcpUrl} --header "Authorization: Bearer ${fresh ?? 'YOUR_TOKEN'}"`;

  return (
    <section id="claude" className="mt-8 scroll-mt-20">
      <h2 className="text-[15px] font-bold">Use EasyCut from Claude</h2>
      <p className="mt-1.5 max-w-[66ch] text-[13px] text-muted">
        Edit videos by talking to your own Claude. EasyCut does the transcription, cuts, captions
        and rendering; your Claude writes the animated scenes with EasyCut&rsquo;s styles and
        training — so the AI part runs on your Claude plan, not on your EasyCut minutes&rsquo; AI
        budget.
      </p>

      <div className="mt-4 grid gap-px overflow-hidden rounded-[14px] bg-line-soft">
        <div className="bg-charcoal px-4 py-3.5">
          <b className="text-[13.5px] font-bold">claude.ai or the Claude desktop app</b>
          <p className="mt-1 text-[12.5px] text-muted">
            Settings → Connectors → Add custom connector, paste this address, then sign in to
            EasyCut when Claude asks.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-ink px-2 py-1 text-[12.5px]">{mcpUrl}</code>
            <CopyButton text={mcpUrl} />
          </div>
        </div>

        <div className="bg-charcoal px-4 py-3.5">
          <b className="text-[13.5px] font-bold">Claude Code</b>
          {authEnabled ? (
            <>
              <p className="mt-1 text-[12.5px] text-muted">
                Make a token, then run the command it gives you. The token is shown once.
              </p>
              <button
                type="button"
                onClick={create}
                disabled={busy}
                className="mt-2 rounded-lg bg-violet px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-violet-hover disabled:opacity-60"
              >
                {busy ? 'Making…' : 'Make a token'}
              </button>
              {error ? <p className="mt-2 text-[12px] text-warn">{error}</p> : null}
            </>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted">Sign-in is off on this server, so no token is needed.</p>
          )}
          {fresh || !authEnabled ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="max-w-full overflow-x-auto rounded-md bg-ink px-2 py-1 text-[12px]">
                {authEnabled ? codeCommand : `claude mcp add --transport http easycut ${mcpUrl}`}
              </code>
              <CopyButton text={authEnabled ? codeCommand : `claude mcp add --transport http easycut ${mcpUrl}`} />
            </div>
          ) : null}
        </div>

        {tokens.length ? (
          <div className="bg-charcoal px-4 py-3.5">
            <b className="text-[13.5px] font-bold">Connected</b>
            <ul className="mt-2 grid gap-1.5">
              {tokens.map((token) => (
                <li key={token.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-semibold">{token.name}</span>
                  <code className="text-muted">{token.prefix}…</code>
                  <span className="text-faint">
                    {token.lastUsedAt ? `used ${new Date(token.lastUsedAt).toLocaleDateString()}` : 'never used'}
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(token.id)}
                    className="ml-auto text-[12px] font-semibold text-warn hover:underline"
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
